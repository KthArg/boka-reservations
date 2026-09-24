-- Migration: cobro automático del mínimo, con autorización previa (spec 0033).
--
--   1. tours.charge_timing / charge_lead_hours: cada tour decide si se cobra al cumplirse el
--      mínimo o a X horas de la salida. business_settings.default_charge_lead_hours es el valor
--      por defecto; minimum_decision_window_hours NO se toca (sigue siendo el plazo de
--      recuperación del cobro manual: mezclarlos haría que cambiar uno moviera el otro).
--   2. bookings.authorized_at / cancel_claimed_at / capture_started_at: el estado de una
--      autorización con captura manual y las dos marcas que excluyen cancelar y capturar a la vez.
--   3. tour_instances.minimum_charge_closed_at: un ciclo cerrado sin resolver (salida lejana),
--      para que departure_charge_due no lo reabra cada minuto.
--   4. tour_instances_minimum_trigger_check pasa de equivalencia a implicación: sin ese cambio,
--      estampar el disparo antes de resolver es imposible y el estado "en cobro" no existe.
--   5. Diez funciones del ciclo: evaluar, abrir, autorizar, soltar, cerrar, resolver y cancelar.
--   6. cancel_charge_in_flight y charge_attempt_failed de …044 se reemplazan para que limpien
--      las marcas de la autorización: la red terminal de watch-charges cancela por ahí las
--      reservas autorizadas, y un rechazo de captura devuelve la reserva a pending_minimum.
--
-- Hardening (patrón …044): SECURITY DEFINER + search_path = '' + guard is_public_request() +
-- REVOKE de PUBLIC, anon, authenticated + GRANT a service_role. Las dos lecturas
-- (departure_seat_counts y departure_charge_due) quedan SECURITY INVOKER a propósito: no mutan
-- nada y las llaman las DEFINER de esta misma migración; igual se les revoca EXECUTE.
--
-- Orden de despliegue: esta migración va ANTES del código. El motor vive detrás de
-- DEFERRED_CHARGE_ENABLED, que en producción está apagado.
--
-- Reversibilidad, en este orden:
--   (1) revertir el código de la web y del worker;
--   (2) DROP de las diez funciones nuevas y re-CREATE de los cuerpos de cancel_charge_in_flight
--       y charge_attempt_failed de …044;
--   (3) restaurar tour_instances_minimum_trigger_check con la equivalencia de …043 (solo posible
--       si ninguna salida quedó con disparo sin resolución `reached`/`staff_confirmed`);
--   (4) REVOKE UPDATE (default_charge_lead_hours) ON public.business_settings FROM
--       authenticated, y DROP de las columnas nuevas.

SET LOCAL lock_timeout = '5s';

-- ================================================================
-- 1. Configuración por tour y global
-- ================================================================

ALTER TABLE public.tours
  ADD COLUMN charge_timing text NOT NULL DEFAULT 'before_departure',
  ADD COLUMN charge_lead_hours integer NULL,
  ADD CONSTRAINT tours_charge_timing_check
    CHECK (charge_timing IN ('on_minimum', 'before_departure')),
  ADD CONSTRAINT tours_charge_lead_hours_check
    CHECK (charge_lead_hours IS NULL OR charge_lead_hours BETWEEN 1 AND 720);

ALTER TABLE public.business_settings
  ADD COLUMN default_charge_lead_hours integer NOT NULL DEFAULT 48,
  ADD CONSTRAINT business_settings_default_charge_lead_hours_check
    CHECK (default_charge_lead_hours BETWEEN 1 AND 720);

GRANT UPDATE (default_charge_lead_hours) ON public.business_settings TO authenticated;

-- ================================================================
-- 2. Estado de la autorización en la reserva
-- ================================================================

-- Las tres solo tienen sentido con un cobro en curso o ya cobrado. authorized_at NO se limpia al
-- capturar: el estado se deriva de bookings.status y payments.status, y limpiarla abriría una
-- ventana donde la reserva no cuenta ni como autorizada ni como confirmada.
ALTER TABLE public.bookings
  ADD COLUMN authorized_at     timestamptz NULL,
  ADD COLUMN cancel_claimed_at timestamptz NULL,
  ADD COLUMN capture_started_at timestamptz NULL,
  ADD CONSTRAINT bookings_authorization_state_check
    CHECK (
      (authorized_at IS NULL AND cancel_claimed_at IS NULL AND capture_started_at IS NULL)
      OR (
        -- payment_mismatch y overbooked_refunded son finales legitimos de una reserva que estuvo
        -- autorizada: los escriben flag_payment_mismatch y confirm_booking DESPUES de capturar, y
        -- ninguno limpia las marcas. Sin ellos en la lista, la captura que detecta un monto
        -- distinto o una sobreventa abortaria con la plata ya cobrada en la pasarela.
        status IN (
          'pending_payment', 'confirmed', 'cancelled', 'refunded',
          'payment_mismatch', 'overbooked_refunded'
        )
        -- Reclamar o capturar sin autorizacion no es un estado que ninguna funcion produzca.
        AND (authorized_at IS NOT NULL OR (cancel_claimed_at IS NULL AND capture_started_at IS NULL))
      )
    );

-- ================================================================
-- 3. Ciclo cerrado sin resolver
-- ================================================================

ALTER TABLE public.tour_instances
  ADD COLUMN minimum_charge_closed_at timestamptz NULL,
  -- Cerrar limpia el disparo y reabrir limpia el cierre: las dos columnas son excluyentes. Es el
  -- reemplazo declarado de la invariante que pierde el CHECK de abajo al pasar a implicacion.
  ADD CONSTRAINT tour_instances_minimum_cycle_check
    CHECK (minimum_charge_closed_at IS NULL OR minimum_charge_triggered_at IS NULL);

-- El disparo pasa a ser evidencia de que hubo un ciclo, no autorización para cobrar: lo que
-- autoriza a capturar es la evaluación del mínimo. La equivalencia de …043 impedía estampar el
-- disparo mientras el ciclo estaba abierto, que es justamente el estado que este spec necesita.
ALTER TABLE public.tour_instances DROP CONSTRAINT tour_instances_minimum_trigger_check;
ALTER TABLE public.tour_instances ADD CONSTRAINT tour_instances_minimum_trigger_check
  CHECK (
    minimum_resolution IS NULL
    OR minimum_resolution NOT IN ('reached', 'staff_confirmed')
    OR minimum_charge_triggered_at IS NOT NULL
  );

-- ================================================================
-- 4. departure_seat_counts: las tres cohortes, en participantes
-- ================================================================

-- Participantes, no reservas: min_participants cuenta gente. capacity_reserved solo lo incrementa
-- confirm_booking, así que equivale a los cupos ya cobrados de la salida.
CREATE FUNCTION public.departure_seat_counts(p_instance_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'sold', ti.capacity_reserved + COALESCE(live.seats, 0),
    'authorized', ti.capacity_reserved + COALESCE(auth.seats, 0),
    'captured', ti.capacity_reserved,
    'minimum', COALESCE(ti.min_participants_at_trigger, t.min_participants)
  )
  FROM public.tour_instances ti
  JOIN public.tours t ON t.id = ti.tour_id
  LEFT JOIN LATERAL (
    SELECT SUM(b.tickets_adult + b.tickets_child + b.tickets_student)::integer AS seats
    FROM public.bookings b
    WHERE b.tour_instance_id = ti.id
      AND b.status IN ('pending_minimum', 'pending_payment')
  ) live ON true
  LEFT JOIN LATERAL (
    SELECT SUM(b.tickets_adult + b.tickets_child + b.tickets_student)::integer AS seats
    FROM public.bookings b
    WHERE b.tour_instance_id = ti.id
      AND b.status = 'pending_payment'
      AND b.authorized_at IS NOT NULL
      AND b.cancel_claimed_at IS NULL
  ) auth ON true
  WHERE ti.id = p_instance_id;
$$;

REVOKE EXECUTE ON FUNCTION public.departure_seat_counts(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.departure_seat_counts(uuid) TO service_role;

-- ================================================================
-- 5. departure_charge_due: la única fuente de la regla del disparo
-- ================================================================

-- EARLY_CANCEL_FLOOR_HOURS = 72: un ciclo cerrado por lejanía no se reabre hasta estar cerca de
-- la salida. Sin esa cláusula, cerrar y reabrir se repetiría cada minuto, reteniendo plata en las
-- tarjetas de los turistas una y otra vez.
CREATE FUNCTION public.departure_charge_due(p_instance_id uuid)
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

  IF now() >= v_instance.starts_at - make_interval(hours => v_lead) THEN
    RETURN true;
  END IF;

  IF v_timing <> 'on_minimum' THEN
    RETURN false;
  END IF;

  v_counts := public.departure_seat_counts(p_instance_id);
  RETURN (v_counts->>'sold')::integer >= (v_counts->>'minimum')::integer;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.departure_charge_due(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.departure_charge_due(uuid) TO service_role;

-- ================================================================
-- 6. open_departure_charge: abre (o reabre) el ciclo
-- ================================================================

-- MINIMUM_RESOLUTION_WINDOW_HOURS = 48 (cubre los reintentos 1/6/24 h y mantiene la autorización
-- dentro del rango confiable), MINIMUM_RESOLUTION_MARGIN_HOURS = 3 (no resolver con la salida
-- encima) y MINIMUM_RESOLUTION_FLOOR_MINUTES = 30 (con charge_lead_hours de 1 h el plazo nacería
-- vencido y la salida se cancelaría sin un solo intento de cobro).
CREATE FUNCTION public.open_departure_charge(p_instance_id uuid)
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
      LEAST(now() + interval '48 hours', v_instance.starts_at - interval '3 hours'),
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

REVOKE EXECUTE ON FUNCTION public.open_departure_charge(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_departure_charge(uuid) TO service_role;

-- ================================================================
-- 7. close_departure_charge: cierra sin resolver (salida lejana)
-- ================================================================

CREATE FUNCTION public.close_departure_charge(p_instance_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_instance public.tour_instances;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  SELECT * INTO v_instance FROM public.tour_instances WHERE id = p_instance_id FOR UPDATE;

  IF NOT FOUND OR v_instance.minimum_charge_triggered_at IS NULL
     OR v_instance.minimum_resolved_at IS NOT NULL THEN
    RETURN false;
  END IF;

  -- Se limpian disparo, foto y plazo: la reapertura los vuelve a estampar con valores nuevos.
  UPDATE public.tour_instances
    SET minimum_charge_triggered_at = NULL,
        min_participants_at_trigger = NULL,
        seats_at_trigger            = NULL,
        staff_decision_required_at  = NULL,
        minimum_charge_closed_at    = now()
    WHERE id = p_instance_id;

  INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
  VALUES (
    'system', 'departure.charge_closed', 'tour_instance', p_instance_id,
    jsonb_build_object('starts_at', v_instance.starts_at)
  );

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.close_departure_charge(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_departure_charge(uuid) TO service_role;

-- ================================================================
-- 8. record_authorization / release_departure_authorization
-- ================================================================

-- Contrato: el caller confirmó el intent con captura manual y lo vio en requires_capture.
-- Idempotente: adoptar una autorización huérfana (el worker murió antes de registrarla) vuelve a
-- llamar acá con el mismo intent.
CREATE FUNCTION public.record_authorization(
  p_booking_id          uuid,
  p_external_payment_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking public.bookings;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;

  IF NOT FOUND OR v_booking.status <> 'pending_payment' THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.payments
    WHERE booking_id = p_booking_id
      AND external_payment_id = p_external_payment_id
      AND status = 'pending'
  ) THEN
    RETURN false;
  END IF;

  IF v_booking.authorized_at IS NOT NULL THEN
    RETURN true;
  END IF;

  UPDATE public.bookings SET authorized_at = now() WHERE id = p_booking_id;

  INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
  VALUES (
    'system', 'charge.authorized', 'booking', p_booking_id,
    jsonb_build_object('external_payment_id', p_external_payment_id)
  );

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_authorization(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_authorization(uuid, text) TO service_role;

-- Contrato: el caller ya canceló la autorización en OnvoPay. Cierra el pago (sin eso,
-- charge_booking_start devolvería intent_mismatch para siempre) y limpia todas las marcas del
-- intento, incluido charge_started_at, para que el reintento no choque con la separación mínima.
CREATE FUNCTION public.release_departure_authorization(
  p_booking_id          uuid,
  p_external_payment_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking public.bookings;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;

  IF NOT FOUND OR v_booking.status <> 'pending_payment' THEN
    RETURN false;
  END IF;

  UPDATE public.payments
    SET status = 'failed', failed_at = now(), provider_closed_at = now()
    WHERE booking_id = p_booking_id
      AND external_payment_id = p_external_payment_id
      AND status = 'pending';

  UPDATE public.bookings
    SET status               = 'pending_minimum',
        authorized_at        = NULL,
        cancel_claimed_at    = NULL,
        capture_started_at   = NULL,
        charge_started_at    = NULL,
        awaiting_action_until = NULL,
        recovery_deadline    = NULL
    WHERE id = p_booking_id;

  INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
  VALUES (
    'system', 'charge.authorization_released', 'booking', p_booking_id,
    jsonb_build_object('external_payment_id', p_external_payment_id)
  );

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.release_departure_authorization(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_departure_authorization(uuid, text) TO service_role;

-- ================================================================
-- 9. Claim de cancelación y captura: exclusión sin sostener locks sobre HTTP
-- ================================================================

-- Ni cancelar ni capturar pueden sostener un lock de fila mientras hablan con OnvoPay. Las dos
-- marcas resuelven la carrera: quien llega primero deja la suya y el otro se abstiene.
CREATE FUNCTION public.claim_authorization_cancel(
  p_booking_id uuid,
  p_actor_id   uuid,
  p_reason     text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking public.bookings;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  IF p_reason NOT IN ('customer_request', 'staff_request') THEN
    RAISE EXCEPTION 'INVALID_CANCEL_REASON';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  IF v_booking.status <> 'pending_payment' OR v_booking.authorized_at IS NULL THEN
    RETURN 'not_authorized';
  END IF;

  -- Marca de captura vigente (15 min): el job está hablando con OnvoPay por esta reserva.
  IF v_booking.capture_started_at IS NOT NULL
     AND v_booking.capture_started_at > now() - interval '15 minutes' THEN
    RETURN 'capture_in_progress';
  END IF;

  UPDATE public.bookings SET cancel_claimed_at = now() WHERE id = p_booking_id;

  -- El reclamo se audita aunque la cancelacion todavia no este hecha: si el POST /cancel de la
  -- pasarela falla, esta fila es la unica evidencia de que alguien intento cancelar.
  INSERT INTO public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    public.audit_actor_type(p_actor_id, 'tourist'),
    p_actor_id, 'charge.cancel_claimed', 'booking', p_booking_id,
    jsonb_build_object('reason', p_reason)
  );

  RETURN 'claimed';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_authorization_cancel(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_authorization_cancel(uuid, uuid, text) TO service_role;

-- Contrato: el caller reclamó la reserva y ya canceló la autorización en OnvoPay.
CREATE FUNCTION public.cancel_authorized_booking(
  p_booking_id uuid,
  p_actor_id   uuid,
  p_reason     text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking public.bookings;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  IF p_reason NOT IN ('customer_request', 'staff_request') THEN
    RAISE EXCEPTION 'INVALID_CANCEL_REASON';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  IF v_booking.cancel_claimed_at IS NULL OR v_booking.status <> 'pending_payment' THEN
    RETURN 'not_claimed';
  END IF;

  UPDATE public.payments
    SET status = 'failed', failed_at = now(), provider_closed_at = now()
    WHERE booking_id = p_booking_id AND status = 'pending';

  UPDATE public.bookings
    SET status                = 'cancelled',
        charge_next_attempt_at = NULL,
        authorized_at         = NULL,
        cancel_claimed_at     = NULL,
        capture_started_at    = NULL,
        awaiting_action_until = NULL
    WHERE id = p_booking_id;

  IF v_booking.hold_id IS NOT NULL THEN
    UPDATE public.tour_holds SET status = 'released'
      WHERE id = v_booking.hold_id AND status IN ('active', 'paying');
  END IF;

  PERFORM public.cancel_pending_charge_notifications(p_booking_id, 'booking_cancelled');

  INSERT INTO public.notifications (booking_id, kind, recipient_email, locale, scheduled_for)
  VALUES (
    p_booking_id, 'cancellation_confirmation',
    v_booking.customer_email, v_booking.locale, now()
  )
  ON CONFLICT (booking_id, kind) DO NOTHING;

  INSERT INTO public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    -- audit_actor_type resuelve el rol real cuando hay actor; el fallback es para el turista,
    -- que cancela sin usuario interno.
    public.audit_actor_type(p_actor_id, 'tourist'),
    p_actor_id, 'booking.cancelled', 'booking', p_booking_id,
    jsonb_build_object('reason', p_reason, 'authorized', true, 'refund_amount_cents', 0)
  );

  RETURN 'cancelled';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_authorized_booking(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_authorized_booking(uuid, uuid, text) TO service_role;

-- ================================================================
-- 10. cancel_booking_for_departure: cancelar sin avisar por separado
-- ================================================================

-- Para las reservas SIN cobro de una salida que se cancela por mínimo. No usa
-- cancel_unpaid_booking porque esa encola `cancellation_confirmation`, y el turista ya recibe
-- `departure_cancelled_minimum`: serían dos correos por la misma cancelación.
CREATE FUNCTION public.cancel_booking_for_departure(
  p_booking_id uuid,
  p_resolution text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking public.bookings;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  IF p_resolution NOT IN ('auto_cancelled', 'staff_cancelled') THEN
    RAISE EXCEPTION 'INVALID_RESOLUTION';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  IF v_booking.status NOT IN ('pending_minimum', 'pending_payment') THEN
    RETURN 'not_cancellable';
  END IF;

  -- provider_closed_at queda en NULL a proposito: esta funcion no habla con la pasarela, y
  -- afirmar el cierre sacaria al intent de la cola de close-payment-intents, que es justo quien
  -- tiene que cancelarlo alla. Marcarlo cerrado dejaria la retencion viva hasta que expire sola.
  UPDATE public.payments
    SET status = 'failed', failed_at = now()
    WHERE booking_id = p_booking_id AND status = 'pending';

  UPDATE public.bookings
    SET status                = 'cancelled',
        charge_next_attempt_at = NULL,
        authorized_at         = NULL,
        cancel_claimed_at     = NULL,
        capture_started_at    = NULL,
        awaiting_action_until = NULL
    WHERE id = p_booking_id;

  IF v_booking.hold_id IS NOT NULL THEN
    UPDATE public.tour_holds SET status = 'released'
      WHERE id = v_booking.hold_id AND status IN ('active', 'paying');
  END IF;

  PERFORM public.cancel_pending_charge_notifications(p_booking_id, 'departure_cancelled');

  INSERT INTO public.notifications (booking_id, kind, recipient_email, locale, scheduled_for)
  VALUES (
    p_booking_id, 'departure_cancelled_minimum',
    v_booking.customer_email, v_booking.locale, now()
  )
  ON CONFLICT (booking_id, kind) DO NOTHING;

  INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
  VALUES (
    'system', 'booking.cancelled', 'booking', p_booking_id,
    jsonb_build_object('reason', p_resolution, 'refund_amount_cents', 0)
  );

  RETURN 'cancelled';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_booking_for_departure(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_booking_for_departure(uuid, text) TO service_role;

-- ================================================================
-- 11. resolve_departure_minimum: cierra el ciclo
-- ================================================================

-- Las resoluciones cancelatorias dejan la salida en `cancelled` (si no, seguiría reservable y una
-- reserva nueva caería en el limbo) y reembolsan el 100 % a las reservas ya cobradas, con el
-- contrato exacto que exige cancel_booking de 6 parámetros (…046): operator_decision, comisión 0
-- y monto igual al total. cancel_booking ya libera cupos y encola su propio aviso.
CREATE FUNCTION public.resolve_departure_minimum(
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

REVOKE EXECUTE ON FUNCTION public.resolve_departure_minimum(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_departure_minimum(uuid, text, uuid) TO service_role;

-- ================================================================
-- 12. cancel_charge_in_flight: limpia también las marcas de la autorización
-- ================================================================

-- Mismo cuerpo de …044 con un solo cambio: al cancelar deja en NULL authorized_at,
-- cancel_claimed_at y capture_started_at. La red terminal de watch-charges cancela por ahí las
-- reservas autorizadas de una salida que ya empezó (cancel_unpaid_booking solo acepta
-- pending_minimum), y sin esa limpieza una reserva cancelada quedaría figurando como autorizada.
CREATE OR REPLACE FUNCTION public.cancel_charge_in_flight(p_booking_id uuid, p_reason text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking   public.bookings;
  v_starts_at timestamptz;
  v_due       boolean;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  IF p_reason NOT IN ('action_expired', 'recovery_expired', 'departure_started') THEN
    RAISE EXCEPTION 'INVALID_CANCEL_REASON';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  IF v_booking.status <> 'pending_payment' OR v_booking.charge_started_at IS NULL THEN
    RETURN false;
  END IF;

  SELECT starts_at INTO v_starts_at
    FROM public.tour_instances WHERE id = v_booking.tour_instance_id;

  v_due := CASE p_reason
    WHEN 'action_expired' THEN v_booking.awaiting_action_until <= now()
    WHEN 'recovery_expired' THEN v_booking.recovery_deadline <= now()
    ELSE v_starts_at <= now()
  END;

  IF v_due IS NOT TRUE THEN
    RETURN false;
  END IF;

  UPDATE public.bookings
    SET status                 = 'cancelled',
        charge_next_attempt_at = NULL,
        authorized_at          = NULL,
        cancel_claimed_at      = NULL,
        capture_started_at     = NULL
    WHERE id = p_booking_id;

  UPDATE public.payments
    SET status = 'failed', failed_at = now()
    WHERE booking_id = p_booking_id AND status = 'pending';

  IF v_booking.hold_id IS NOT NULL THEN
    UPDATE public.tour_holds SET status = 'released'
      WHERE id = v_booking.hold_id AND status IN ('active', 'paying');
  END IF;

  PERFORM public.cancel_pending_charge_notifications(p_booking_id, 'booking_cancelled');

  INSERT INTO public.notifications (booking_id, kind, recipient_email, locale, scheduled_for)
  VALUES (
    p_booking_id, 'cancellation_confirmation',
    v_booking.customer_email, v_booking.locale, now()
  )
  ON CONFLICT (booking_id, kind) DO NOTHING;

  INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
  VALUES (
    'system', 'booking.charge_cancelled', 'booking', p_booking_id,
    jsonb_build_object(
      'reason', p_reason,
      'charge_attempts', v_booking.charge_attempts,
      'authorized', v_booking.authorized_at IS NOT NULL
    )
  );

  RETURN true;
END;
$$;


-- ================================================================
-- 13. charge_attempt_failed: limpia las marcas al volver a pending_minimum
-- ================================================================

-- Mismo cuerpo de …044 con un solo cambio: al devolver la reserva a pending_minimum deja en NULL
-- authorized_at, cancel_claimed_at y capture_started_at. Es el camino de "la captura fallo" y de
-- "la autorizacion vencio antes de capturar" (§5.4): sin la limpieza, el CHECK nuevo aborta la
-- transaccion y el rechazo no se registra nunca.
CREATE OR REPLACE FUNCTION public.charge_attempt_failed(
  p_booking_id          uuid,
  p_external_payment_id text,
  p_error_code          text,
  p_intent_terminal     boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking  public.bookings;
  v_pending  public.payments;
  v_attempts integer;
  v_deadline timestamptz;
  v_next     timestamptz;
  v_kind     text;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  IF v_booking.status <> 'pending_payment' OR v_booking.charge_started_at IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_pending
    FROM public.payments
    WHERE booking_id = p_booking_id
      AND external_payment_id = p_external_payment_id
      AND status = 'pending'
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_attempts := v_booking.charge_attempts + 1;
  v_deadline := COALESCE(
    v_booking.recovery_deadline,
    public.compute_recovery_deadline(v_booking.tour_instance_id)
  );

  IF v_deadline IS NULL THEN
    RAISE EXCEPTION 'RECOVERY_DEADLINE_UNAVAILABLE';
  END IF;

  -- Con margen (≥ 2 h hasta el plazo) se agenda el reintento de este fallo; sin margen, o tras
  -- el tercer fallo, no hay reintento automático (una tarjeta rechazada no se re-confirma sin
  -- pausa: las marcas lo penalizan).
  v_next := NULL;
  IF v_deadline - now() >= interval '2 hours' THEN
    v_next := CASE v_attempts
      WHEN 1 THEN now() + interval '1 hour'
      WHEN 2 THEN now() + interval '6 hours'
      WHEN 3 THEN now() + interval '24 hours'
      ELSE NULL
    END;
    IF v_next IS NOT NULL THEN
      v_next := LEAST(v_next, v_deadline);
    END IF;
  END IF;

  -- Vuelve a pending_minimum: la autorizacion ya no existe, asi que las tres marcas del spec
  -- 0033 se limpian. Sin esto, bookings_authorization_state_check aborta la transaccion y el
  -- rechazo de una captura queda sin registrar.
  UPDATE public.bookings
    SET status = 'pending_minimum',
        charge_attempts = v_attempts,
        charge_last_error = p_error_code,
        recovery_deadline = v_deadline,
        charge_next_attempt_at = v_next,
        awaiting_action_until = NULL,
        authorized_at = NULL,
        cancel_claimed_at = NULL,
        capture_started_at = NULL
    WHERE id = p_booking_id;

  IF p_intent_terminal THEN
    UPDATE public.payments
      SET status = 'failed', failed_at = now(), provider_closed_at = now()
      WHERE id = v_pending.id;
  END IF;

  -- Aviso con enlace (Q7: todo cobro fallido se notifica). Desde el cuarto fallo se reutiliza el
  -- kind `_3`: se reemplaza la fila ya procesada por una nueva, así el envío lleva un id nuevo
  -- (clave de idempotencia del proveedor de email) y la unicidad (booking_id, kind) no cambia.
  v_kind := 'charge_failed_action_required_' || LEAST(v_attempts, 3);
  IF v_attempts > 3 THEN
    DELETE FROM public.notifications
      WHERE booking_id = p_booking_id AND kind = v_kind AND status <> 'pending';
  END IF;

  INSERT INTO public.notifications (booking_id, kind, recipient_email, locale, scheduled_for)
  VALUES (p_booking_id, v_kind, v_booking.customer_email, v_booking.locale, now())
  ON CONFLICT (booking_id, kind) DO NOTHING;

  INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
  VALUES (
    'system', 'charge.failed', 'booking', p_booking_id,
    jsonb_build_object(
      'attempt', v_attempts,
      'external_payment_id', p_external_payment_id,
      'error_code', p_error_code,
      'intent_terminal', p_intent_terminal,
      'recovery_deadline', v_deadline,
      'next_attempt_at', v_next
    )
  );

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.charge_attempt_failed(uuid, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.charge_attempt_failed(uuid, text, text, boolean) TO service_role;
