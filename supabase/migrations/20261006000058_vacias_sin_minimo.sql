-- Migración …058 — Las salidas vacías se cancelan solas también en los tours sin mínimo (spec 0045).
--
-- Decisión del operador (2026-10-06): una salida sin ninguna reserva viva se cancela sola entre
-- 25 horas y 24 horas 10 minutos antes de su inicio, tenga o no mínimo el tour. En …057 los tours
-- con min_participants <= 1 quedaban afuera (su salida vacía se marcaba 'reached').
--
-- resolve_immediate_minimum: mismo cuerpo de …057 con la rama de "sin reservas" antes de la de
-- "mínimo alcanzado". El motivo de la cancelación sigue siendo 'minimum' y la resolución
-- 'auto_cancelled', que es lo que acepta cancel_departure sin actor. Misma firma: CREATE OR
-- REPLACE conserva dueño, REVOKE y GRANT de …049.
--
-- Efecto: una salida vacía deja de venderse 24 horas antes, sea cual sea la anticipación mínima
-- para reservar (business_settings.booking_cutoff_hours).
--
-- Reversión: recrear el cuerpo de …057.

SET lock_timeout = '5s';

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

  -- Salida sin ninguna reserva viva (spec 0045): se cancela sola con cualquier política y con
  -- cualquier mínimo, también en los tours sin mínimo (decisión del operador, 2026-10-06). Va
  -- antes de la rama de "alcanzado": un tour con mínimo 1 y cero reservas no alcanzó nada. Acá
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
