-- Migración …054 — Anticipación mínima para reservar (spec 0041).
--
--   1. business_settings.booking_cutoff_hours (0 a 72, por defecto 3): hasta cuántas horas antes
--      de la salida se puede reservar en línea. La edita el admin desde Configuración.
--   2. create_hold_atomic rechaza con HOLD_BOOKING_CLOSED una salida que empieza dentro de ese
--      plazo. Todo el código de checkout (inmediato y diferido) pasa por acá. Orden:
--      HOLD_INSTANCE_NOT_FOUND → HOLD_INSTANCE_UNAVAILABLE → HOLD_INSTANCE_PAST →
--      HOLD_BOOKING_CLOSED. Sin fila de configuración: SETTINGS_MISSING (falla cerrada, como …047).
--      El control es al crear el apartado: quien ya lo tiene puede terminar de pagar.
--
-- Hardening: la función conserva SECURITY DEFINER + search_path = '' y el REVOKE de …028; GRANT
-- explícito a service_role (…039).
--
-- Reversión: primero revertir la web (lee booking_cutoff_hours); después recrear el cuerpo de
-- create_hold_atomic de …036 con el REVOKE de …028 y el GRANT a service_role de …039, y DROP
-- COLUMN booking_cutoff_hours.

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.business_settings
  ADD COLUMN booking_cutoff_hours integer NOT NULL DEFAULT 3
    CONSTRAINT business_settings_booking_cutoff_hours_check
      CHECK (booking_cutoff_hours BETWEEN 0 AND 72);

-- La escribe el admin con su sesión (RLS de …043), como las otras horas de Configuración.
GRANT UPDATE (booking_cutoff_hours) ON public.business_settings TO authenticated;

CREATE OR REPLACE FUNCTION public.create_hold_atomic(
  p_instance_id  uuid,
  p_seats        integer,
  p_session      text
)
RETURNS public.tour_holds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_instance   public.tour_instances;
  v_cutoff     integer;
  v_held       integer;
  v_available  integer;
  v_hold       public.tour_holds;
BEGIN
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

  -- Spec 0041: la venta en línea cierra booking_cutoff_hours antes de la salida.
  SELECT booking_cutoff_hours INTO v_cutoff FROM public.business_settings WHERE id = 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SETTINGS_MISSING'
      USING HINT = 'Falta business_settings.id = 1 (fila única de configuración)';
  END IF;
  IF v_instance.starts_at <= NOW() + make_interval(hours => v_cutoff) THEN
    RAISE EXCEPTION 'HOLD_BOOKING_CLOSED';
  END IF;

  -- Hold activo previo del mismo session_token: devolverlo (no se reusa uno `paying`).
  SELECT * INTO v_hold
    FROM public.tour_holds
    WHERE tour_instance_id = p_instance_id
      AND session_token    = p_session
      AND status           = 'active'
      AND expires_at       > NOW();

  IF FOUND THEN
    RETURN v_hold;
  END IF;

  -- Cupos ocupados: holds `active` no expirados MÁS holds `paying` (estos cuentan mientras
  -- el pago esté vivo, sin mirar expires_at — es la garantía de cupo del spec 0025).
  SELECT COALESCE(SUM(held_seats), 0) INTO v_held
    FROM public.tour_holds
    WHERE tour_instance_id = p_instance_id
      AND (
        (status = 'active' AND expires_at > NOW())
        OR status = 'paying'
      );

  v_available := v_instance.capacity_total - v_instance.capacity_reserved - v_held;

  IF v_available < p_seats THEN
    RAISE EXCEPTION 'HOLD_NO_CAPACITY';
  END IF;

  INSERT INTO public.tour_holds (tour_instance_id, session_token, held_seats)
    VALUES (p_instance_id, p_session, p_seats)
    RETURNING * INTO v_hold;

  RETURN v_hold;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_hold_atomic(uuid, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_hold_atomic(uuid, integer, text) TO service_role;
