-- Migración …057 — Política de las salidas bajo el mínimo (spec 0045).
--
--   1. business_settings.below_minimum_policy: 'staff_decides' (valor inicial) o 'auto_cancel'.
--      Una sola política para el cobro inmediato y el diferido; la cambia el admin en
--      Configuración.
--   2. resolve_immediate_minimum (solo el worker): mismo cuerpo de …049 con dos cambios después
--      de comprobar que la salida no alcanzó el mínimo:
--        - sin ninguna reserva viva, la salida se cancela sola con cualquier política (salvo que
--          tenga un apartado vivo o una reserva payment_mismatch: se reintenta en la corrida
--          siguiente);
--        - con reservas, solo se cancela sola si la política es 'auto_cancel'. Con
--          'staff_decides' devuelve 'awaiting_staff' y no toca nada: decide una persona desde
--          Salidas, y si nadie decide la salida se hace.
--   3. auto_cancel_departure_minimum (solo el worker): la cancelación automática del motor
--      diferido con la política 'auto_cancel'. Envuelve a resolve_departure_minimum (…055, que
--      no cambia) con las guardas que hacen seguro cancelar sin una persona delante.
--
-- De resolve_immediate_minimum solo cambia el cuerpo: misma firma, así que CREATE OR REPLACE
-- conserva dueño, REVOKE y GRANT de …049. La función nueva trae su propio hardening.
--
-- Orden de despliegue: migración primero y el worker enseguida. Desde que se aplica, las salidas
-- con reservas del cobro inmediato dejan de cancelarse solas (valor inicial 'staff_decides'). El
-- worker viejo tolera los resultados nuevos, pero alerta como error cada salida que espera al
-- staff hasta que se despliega el nuevo.
--
-- Reversión rápida: UPDATE business_settings SET below_minimum_policy = 'auto_cancel' restaura la
-- cancelación automática del cobro inmediato. No es una vuelta exacta: con el worker nuevo
-- también la activa en el motor diferido, y una salida vacía con un apartado vivo espera.
-- Reversión del esquema, en este orden: (1) revertir web y worker, que leen y escriben la
-- columna; (2) recrear el cuerpo de …049 y DROP FUNCTION auto_cancel_departure_minimum;
-- (3) DROP COLUMN (se lleva el CHECK y el grant).

SET lock_timeout = '5s';

ALTER TABLE public.business_settings
  ADD COLUMN below_minimum_policy text NOT NULL DEFAULT 'staff_decides',
  ADD CONSTRAINT business_settings_below_minimum_policy_check
    CHECK (below_minimum_policy IN ('staff_decides', 'auto_cancel'));

GRANT UPDATE (below_minimum_policy) ON public.business_settings TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_immediate_minimum(p_instance_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_instance public.tour_instances;
  v_minimum  integer;
  v_policy   text;
  v_result   text;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  SELECT * INTO v_instance FROM public.tour_instances WHERE id = p_instance_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSTANCE_NOT_FOUND';
  END IF;

  IF v_instance.status = 'cancelled' OR v_instance.minimum_resolved_at IS NOT NULL THEN
    RETURN 'already_resolved';
  END IF;

  -- Ventana de 24 h 10 min a 25 h: el margen es para que el aviso salga antes del límite.
  IF v_instance.starts_at <= now() + interval '24 hours 10 minutes'
     OR v_instance.starts_at > now() + interval '25 hours' THEN
    RETURN 'not_due';
  END IF;

  -- Una salida con reservas del cobro diferido la resuelve el motor del spec 0033.
  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE tour_instance_id = p_instance_id
      AND payment_method_id IS NOT NULL
      AND status IN ('pending_minimum', 'pending_payment', 'confirmed')
  ) THEN
    RETURN 'deferred_flow';
  END IF;

  SELECT t.min_participants INTO v_minimum
    FROM public.tours t WHERE t.id = v_instance.tour_id;

  IF v_minimum <= 1 OR v_instance.capacity_reserved >= v_minimum THEN
    -- `reached` exige disparo y foto (…043/…047).
    UPDATE public.tour_instances
      SET minimum_charge_triggered_at = now(),
          min_participants_at_trigger = v_minimum,
          seats_at_trigger            = v_instance.capacity_reserved,
          minimum_resolved_at         = now(),
          minimum_resolution          = 'reached'
      WHERE id = p_instance_id;

    INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
    VALUES (
      'system', 'departure.minimum_resolved', 'tour_instance', p_instance_id,
      jsonb_build_object(
        'resolution', 'reached',
        'minimum', v_minimum,
        'seats', v_instance.capacity_reserved
      )
    );
    RETURN 'reached';
  END IF;

  -- Salida sin ninguna reserva viva (spec 0045): se cancela sola con cualquier política. Acá
  -- solo quedan reservas del cobro inmediato: las diferidas vivas ya devolvieron 'deferred_flow'.
  IF NOT EXISTS (
    SELECT 1 FROM public.bookings
    WHERE tour_instance_id = p_instance_id
      AND status IN ('confirmed', 'pending_minimum', 'pending_payment')
  ) THEN
    -- Alguien está pagando (mismo criterio de apartado vivo que create_hold_atomic) o pagó un
    -- monto que no coincide: no se cancela en esta corrida. La siguiente, a los 5 minutos,
    -- vuelve a evaluar dentro de la misma ventana.
    IF EXISTS (
         SELECT 1 FROM public.tour_holds h
         WHERE h.tour_instance_id = p_instance_id
           AND ((h.status = 'active' AND h.expires_at > now()) OR h.status = 'paying')
       )
       OR EXISTS (
         SELECT 1 FROM public.bookings
         WHERE tour_instance_id = p_instance_id AND status = 'payment_mismatch'
       ) THEN
      RETURN 'checkout_in_progress';
    END IF;

    RETURN public.cancel_departure(p_instance_id, 'minimum', NULL);
  END IF;

  -- Con reservas y bajo el mínimo: manda la política. Sin la fila de configuración rige
  -- 'staff_decides': un dato faltante no cancela reservas.
  SELECT s.below_minimum_policy INTO v_policy
    FROM public.business_settings s WHERE s.id = 1;

  IF COALESCE(v_policy, 'staff_decides') <> 'auto_cancel' THEN
    RETURN 'awaiting_staff';
  END IF;

  v_result := public.cancel_departure(p_instance_id, 'minimum', NULL);
  RETURN v_result;
END;
$$;

-- ================================================================
-- auto_cancel_departure_minimum: la cancelación automática del motor diferido
-- ================================================================

-- El worker la llama al vencer el plazo de cobro, después de soltar las retenciones. Todas las
-- guardas se evalúan acá, bajo el lock de la salida, y no en el worker: entre que el worker mira
-- y cancela puede entrar un pago. Solo cancela una salida cuyas reservas vivas están todas en
-- pending_minimum y sin ningún cobro abierto. Con cualquier otra cosa devuelve 'needs_staff' y
-- decide una persona:
--   - una reserva pending_payment: un turista del cobro inmediato pagando en el widget, o un
--     cobro diferido o manual en curso (resolve_departure_minimum las cancelaría sin distinguir);
--   - una reserva confirmed o payment_mismatch: hay plata cobrada;
--   - un pago pending en una reserva viva: un intent que todavía puede liquidar;
--   - menos de 24 h 10 min: el aviso prometido no llega (el correo sale al minuto siguiente);
--   - la política ya no es 'auto_cancel'.
CREATE FUNCTION public.auto_cancel_departure_minimum(p_instance_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_instance public.tour_instances;
  v_policy   text;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  SELECT * INTO v_instance FROM public.tour_instances WHERE id = p_instance_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSTANCE_NOT_FOUND';
  END IF;

  IF v_instance.status = 'cancelled' OR v_instance.minimum_resolved_at IS NOT NULL THEN
    RETURN 'already_resolved';
  END IF;

  SELECT s.below_minimum_policy INTO v_policy
    FROM public.business_settings s WHERE s.id = 1;

  IF COALESCE(v_policy, 'staff_decides') <> 'auto_cancel'
     OR v_instance.starts_at <= now() + interval '24 hours 10 minutes'
     OR EXISTS (
       SELECT 1 FROM public.bookings b
       WHERE b.tour_instance_id = p_instance_id
         AND b.status IN ('pending_payment', 'confirmed', 'payment_mismatch')
     )
     OR EXISTS (
       SELECT 1 FROM public.payments p
       JOIN public.bookings b ON b.id = p.booking_id
       WHERE b.tour_instance_id = p_instance_id
         AND b.status = 'pending_minimum'
         AND p.status = 'pending'
     ) THEN
    RETURN 'needs_staff';
  END IF;

  -- Mismo lock, misma transacción: devuelve 'resolved' o el motivo por el que no aplicó.
  RETURN public.resolve_departure_minimum(p_instance_id, 'auto_cancelled', NULL);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.auto_cancel_departure_minimum(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_cancel_departure_minimum(uuid) TO service_role;
