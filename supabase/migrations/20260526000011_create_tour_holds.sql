-- Migration: create tour_holds + create_hold_atomic function
-- Spec: 0005-motor-disponibilidad-holds

-- ----------------------------------------------------------------
-- Tabla tour_holds
-- ----------------------------------------------------------------
CREATE TABLE public.tour_holds (
  id                uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tour_instance_id  uuid        NOT NULL REFERENCES public.tour_instances(id) ON DELETE CASCADE,
  session_token     text        NOT NULL,
  held_seats        integer     NOT NULL CHECK (held_seats > 0),
  status            text        NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'released', 'expired', 'converted')),
  expires_at        timestamptz NOT NULL DEFAULT (NOW() + INTERVAL '15 minutes'),
  created_at        timestamptz NOT NULL DEFAULT NOW()
);

-- Índice para el cálculo de disponibilidad
CREATE INDEX tour_holds_instance_active_idx
  ON public.tour_holds (tour_instance_id, status, expires_at);

-- Índice para el job de expiración
CREATE INDEX tour_holds_expiry_idx
  ON public.tour_holds (expires_at)
  WHERE status = 'active';

-- RLS (service_role bypasses por defecto; no se necesitan políticas para otros roles)
ALTER TABLE public.tour_holds ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------
-- Función atómica de creación de hold con lock FOR UPDATE
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_hold_atomic(
  p_instance_id  uuid,
  p_seats        integer,
  p_session      text
)
RETURNS public.tour_holds
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_instance   public.tour_instances;
  v_held       integer;
  v_available  integer;
  v_hold       public.tour_holds;
BEGIN
  -- Bloquear la fila de la instancia para serializar requests concurrentes
  SELECT * INTO v_instance
    FROM public.tour_instances
    WHERE id = p_instance_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'HOLD_INSTANCE_NOT_FOUND';
  END IF;

  IF v_instance.status <> 'available' THEN
    RAISE EXCEPTION 'HOLD_INSTANCE_UNAVAILABLE';
  END IF;

  IF v_instance.starts_at <= NOW() THEN
    RAISE EXCEPTION 'HOLD_INSTANCE_PAST';
  END IF;

  -- Si ya existe un hold activo para este session_token + instancia, devolverlo
  SELECT * INTO v_hold
    FROM public.tour_holds
    WHERE tour_instance_id = p_instance_id
      AND session_token    = p_session
      AND status           = 'active'
      AND expires_at       > NOW();

  IF FOUND THEN
    RETURN v_hold;
  END IF;

  -- Calcular cupos ocupados por holds activos no expirados
  SELECT COALESCE(SUM(held_seats), 0) INTO v_held
    FROM public.tour_holds
    WHERE tour_instance_id = p_instance_id
      AND status           = 'active'
      AND expires_at       > NOW();

  v_available := v_instance.capacity_total - v_instance.capacity_reserved - v_held;

  IF v_available < p_seats THEN
    RAISE EXCEPTION 'HOLD_NO_CAPACITY';
  END IF;

  -- Crear el hold
  INSERT INTO public.tour_holds (tour_instance_id, session_token, held_seats)
    VALUES (p_instance_id, p_session, p_seats)
    RETURNING * INTO v_hold;

  RETURN v_hold;
END;
$$;

-- Solo service_role puede ejecutar la función (llamada desde server actions)
REVOKE EXECUTE ON FUNCTION public.create_hold_atomic(uuid, integer, text) FROM PUBLIC;
