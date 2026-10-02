-- Migración …055 — Salidas bajo el mínimo: decide el staff, con el aviso de 24 horas (specs 0033
-- y 0035).
--
-- Los términos (cláusula del mínimo de participantes, versión 2026-09-27) prometen avisar la
-- cancelación de una salida por mínimo al menos 24 horas antes de su inicio. El motor del cobro
-- diferido resolvía con un margen de 3 horas: en la prueba en producción del 2026-10-01 canceló a
-- las 13:00 una salida de las 16:00. Decisión del usuario (2026-10-02): si una salida se cancela
-- o se hace lo decide una persona, nunca el motor. Esta migración deja la base acorde:
--
--   1. open_departure_charge: el plazo del ciclo (staff_decision_required_at) pasa de
--      "inicio − 3 h" a "inicio − 30 h". Al vencer, una salida bajo el mínimo suelta sus
--      retenciones y pasa a la bandeja de Salidas: el staff tiene 6 horas para cancelarla por
--      mínimo con el aviso prometido, y después puede confirmarla o cancelarla por otra causa.
--      Rige para un ciclo que abre entre 78 h y 30 h 30 min antes de la salida; uno que abre
--      antes vence a las 48 horas, y uno que abre más tarde (worker caído) vence a los 30
--      minutos.
--   2. departure_charge_due: el plazo de cobro efectivo tiene un piso de 32 horas, sea cual sea
--      tours.charge_lead_hours o el valor global: deja 2 horas de ventana para autorizar y, si
--      una tarjeta falla, el reintento de la hora. El CHECK de las columnas (1 a 720) no
--      cambia: la aplicación valida 32 a 720 desde ahora y el piso de acá cubre valores viejos.
--   3. resolve_departure_minimum: nuevo resultado 'minimum_too_late'. Ninguna resolución
--      cancelatoria (auto_cancelled ni staff_cancelled) se aplica con menos de 24 horas para la
--      salida. Es la misma regla que cancel_departure (…049) ya tenía para el cobro inmediato:
--      el staff que igual quiera cancelar elige otra causa, con reembolso del 100 %.
--
-- Solo cambian los cuerpos: mismas firmas, así que CREATE OR REPLACE conserva dueño, REVOKE y
-- GRANT de …047. No hay cambios de esquema ni de datos. Un ciclo ya abierto conserva el plazo con
-- el que se abrió; al aplicar en producción no hay ninguno abierto (verificado antes de aplicar).
--
-- Orden de despliegue: migración primero, worker inmediatamente después. Hasta desplegar el
-- worker nuevo sigue activa su red terminal de 3 horas, que la guarda del punto 3 ya frena.
--
-- Reversión: recrear los tres cuerpos de …047 (margen '3 hours', sin GREATEST en el plazo y sin
-- la guarda de 'minimum_too_late'). Revertir el worker sin revertir esta migración es seguro.

SET LOCAL lock_timeout = '5s';

-- ================================================================
-- 1. departure_charge_due: piso de 32 horas en el plazo de cobro
-- ================================================================

-- MINIMUM_CHARGE_LEAD_FLOOR_HOURS = 32: el plazo del ciclo vence 30 horas antes de la salida,
-- así que 32 horas dejan 2 horas de ventana: el primer intento y, si la tarjeta falla, el
-- reintento de la hora.
CREATE OR REPLACE FUNCTION public.departure_charge_due(p_instance_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_instance public.tour_instances;
  v_timing   text;
  v_lead     integer;
  v_counts   jsonb;
BEGIN
  SELECT * INTO v_instance FROM public.tour_instances WHERE id = p_instance_id;
  IF NOT FOUND OR v_instance.status = 'cancelled' OR v_instance.starts_at <= now() THEN
    RETURN false;
  END IF;

  IF v_instance.minimum_charge_closed_at IS NOT NULL
     AND now() < v_instance.starts_at - interval '72 hours' THEN
    RETURN false;
  END IF;

  SELECT t.charge_timing, COALESCE(t.charge_lead_hours, s.default_charge_lead_hours)
    INTO v_timing, v_lead
    FROM public.tours t
    CROSS JOIN public.business_settings s
    WHERE t.id = v_instance.tour_id AND s.id = 1;

  -- Sin la fila de configuracion los dos quedan NULL, el IF de abajo evalua NULL y TODO tour
  -- pasaria a comportarse como on_minimum. Un error explicito lo vuelve visible.
  IF v_timing IS NULL OR v_lead IS NULL THEN
    RAISE EXCEPTION 'SETTINGS_MISSING'
      USING HINT = 'Falta business_settings.id = 1 o el tour de la salida';
  END IF;

  IF now() >= v_instance.starts_at - make_interval(hours => GREATEST(v_lead, 32)) THEN
    RETURN true;
  END IF;

  IF v_timing <> 'on_minimum' THEN
    RETURN false;
  END IF;

  v_counts := public.departure_seat_counts(p_instance_id);
  RETURN (v_counts->>'sold')::integer >= (v_counts->>'minimum')::integer;
END;
$$;

-- ================================================================
-- 2. open_departure_charge: el plazo vence 30 horas antes
-- ================================================================

-- MINIMUM_RESOLUTION_WINDOW_HOURS = 48 (cubre los reintentos 1/6/24 h y mantiene la autorización
-- dentro del rango confiable), MINIMUM_DECISION_LEAD_HOURS = 30 (las 24 horas de aviso que
-- prometen los términos más 6 horas para que el staff decida; MINIMUM_DECISION_LEAD_MS en el
-- worker) y MINIMUM_RESOLUTION_FLOOR_MINUTES = 30 (un ciclo que abre tarde igual tiene un
-- intento de cobro antes de vencer).
CREATE OR REPLACE FUNCTION public.open_departure_charge(p_instance_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_instance public.tour_instances;
  v_counts   jsonb;
  v_deadline timestamptz;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  SELECT * INTO v_instance FROM public.tour_instances WHERE id = p_instance_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSTANCE_NOT_FOUND';
  END IF;

  IF v_instance.minimum_resolved_at IS NOT NULL OR v_instance.status = 'cancelled' THEN
    RETURN 'not_chargeable';
  END IF;

  IF v_instance.minimum_charge_triggered_at IS NOT NULL THEN
    RETURN 'already_open';
  END IF;

  IF NOT public.departure_charge_due(p_instance_id) THEN
    RETURN 'not_due';
  END IF;

  v_counts := public.departure_seat_counts(p_instance_id);

  v_deadline := LEAST(
    GREATEST(
      LEAST(now() + interval '48 hours', v_instance.starts_at - interval '30 hours'),
      now() + interval '30 minutes'
    ),
    v_instance.starts_at
  );

  UPDATE public.tour_instances
    SET minimum_charge_triggered_at = now(),
        min_participants_at_trigger = (v_counts->>'minimum')::integer,
        seats_at_trigger            = (v_counts->>'sold')::integer,
        staff_decision_required_at  = v_deadline,
        minimum_charge_closed_at    = NULL
    WHERE id = p_instance_id;

  INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
  VALUES (
    'system', 'departure.charge_opened', 'tour_instance', p_instance_id,
    jsonb_build_object(
      'minimum', (v_counts->>'minimum')::integer,
      'seats', (v_counts->>'sold')::integer,
      'deadline', v_deadline
    )
  );

  RETURN 'opened';
END;
$$;

-- ================================================================
-- 3. resolve_departure_minimum: no se cancela por mínimo con menos de 24 horas
-- ================================================================

-- Mismo cuerpo de …047 con una guarda nueva después de `already_resolved`.
CREATE OR REPLACE FUNCTION public.resolve_departure_minimum(
  p_instance_id uuid,
  p_resolution  text,
  p_actor_id    uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_instance public.tour_instances;
  v_booking  public.bookings;
  v_actor    text;
  v_counts   jsonb;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  IF p_resolution NOT IN ('reached', 'auto_cancelled', 'staff_confirmed', 'staff_cancelled') THEN
    RETURN 'invalid_resolution';
  END IF;

  IF p_resolution IN ('staff_confirmed', 'staff_cancelled') AND p_actor_id IS NULL THEN
    RETURN 'invalid_resolution';
  END IF;

  IF p_resolution IN ('reached', 'auto_cancelled') AND p_actor_id IS NOT NULL THEN
    RETURN 'invalid_resolution';
  END IF;

  SELECT * INTO v_instance FROM public.tour_instances WHERE id = p_instance_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSTANCE_NOT_FOUND';
  END IF;

  IF v_instance.minimum_resolved_at IS NOT NULL THEN
    RETURN 'already_resolved';
  END IF;

  -- Los términos prometen avisar la cancelación por mínimo con 24 horas o más. Con menos, ni el
  -- worker ni el staff cancelan por mínimo: el staff que igual quiera cancelar usa
  -- cancel_departure con otra causa (reembolso del 100 %), como en el cobro inmediato (…049).
  IF p_resolution IN ('auto_cancelled', 'staff_cancelled')
     AND v_instance.starts_at <= now() + interval '24 hours' THEN
    RETURN 'minimum_too_late';
  END IF;

  IF p_resolution IN ('reached', 'staff_confirmed')
     AND v_instance.minimum_charge_triggered_at IS NULL THEN
    RETURN 'invalid_resolution';
  END IF;

  -- La foto se toma ANTES de cancelar: despues de cancelar todas las reservas, los cupos dan
  -- cero y el audit perderia justo la evidencia de por que se cancelo la salida.
  v_counts := public.departure_seat_counts(p_instance_id);

  IF p_resolution IN ('auto_cancelled', 'staff_cancelled') THEN
    -- Con una captura en curso no se resuelve: el job esta hablando con la pasarela por esa
    -- reserva y cancelarla ahora dejaria plata cobrada sin reserva ni reembolso. La marca vence
    -- a los 15 minutos, igual que en claim_authorization_cancel.
    IF EXISTS (
      SELECT 1 FROM public.bookings
      WHERE tour_instance_id = p_instance_id
        AND status = 'pending_payment'
        AND capture_started_at > now() - interval '15 minutes'
    ) THEN
      RETURN 'capture_in_progress';
    END IF;

    v_actor := public.audit_actor_type(p_actor_id, 'system');

    -- Cobradas: reembolso total. La cancelación es del operador, así que no se descuenta nada.
    FOR v_booking IN
      SELECT * FROM public.bookings
        WHERE tour_instance_id = p_instance_id AND status = 'confirmed'
        ORDER BY created_at
    LOOP
      PERFORM public.cancel_booking(
        v_booking.id,
        v_actor,
        v_booking.total_amount_cents,
        'operator_decision',
        0,
        p_actor_id
      );
    END LOOP;

    -- Sin cobro: se cancelan con el aviso de salida cancelada, no con el de cancelación normal.
    FOR v_booking IN
      SELECT * FROM public.bookings
        WHERE tour_instance_id = p_instance_id
          AND status IN ('pending_minimum', 'pending_payment')
        ORDER BY created_at
    LOOP
      PERFORM public.cancel_booking_for_departure(v_booking.id, p_resolution);
    END LOOP;

    UPDATE public.tour_instances SET status = 'cancelled' WHERE id = p_instance_id;
  END IF;

  UPDATE public.tour_instances
    SET minimum_resolved_at = now(),
        minimum_resolution  = p_resolution,
        minimum_resolved_by = p_actor_id
    WHERE id = p_instance_id;

  INSERT INTO public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    public.audit_actor_type(p_actor_id, 'system'), p_actor_id,
    'departure.minimum_resolved', 'tour_instance', p_instance_id,
    jsonb_build_object('resolution', p_resolution, 'counts', v_counts)
  );

  RETURN 'resolved';
END;
$$;
