-- Migration: confirm_booking con outcome explícito + refund automático de pago tardío
-- Spec: 0028 (workstream A, ítem A2). Cierra dos hallazgos del code review integral
-- 2026-07-06: (crítico) un pago que llega para una reserva ya cancelada por staleness
-- quedaba cobrado sin reserva, sin refund y sin alerta (RETURN silencioso); (alto) la
-- función confiaba en p_total_seats del caller, y el webhook podía mandarlo en 0 ante un
-- fallo transitorio de lectura (confirmaba sin ocupar cupo).
--
-- Cambios sobre el cuerpo vigente (…037):
--   1. RETURNS void -> RETURNS text con outcome explícito: 'confirmed' |
--      'already_processed' | 'late_payment_refunded' | 'overbooked_refunded' |
--      'payment_mismatch' | 'ignored'. Los callers (webhook web, reconciliador worker)
--      alertan según el outcome en vez de re-leer el estado. Backward-compatible: los
--      callers desplegados destructuran solo `error` e ignoran `data`.
--   2. El gate de idempotencia por evento GATEA de verdad: el INSERT en
--      processed_webhook_events verifica filas insertadas (antes era solo registro) y
--      0 filas -> 'already_processed' sin tocar nada. Dos entregas concurrentes del mismo
--      evento serializan en el INSERT (la segunda espera el commit de la primera).
--      Caveat: el reconciliador llama SIN p_event_id; para ese caller la defensa del
--      camino late es el índice único de refund activo por reserva.
--   3. Camino nuevo 'late_payment_refunded' (booking `cancelled`): marca el pago
--      succeeded (espejo del camino overbooked: el refund necesita un pago succeeded que
--      reembolsar), encola refund total (reason 'late_payment', respeta
--      refunds_one_active_per_booking) y audita booking.late_payment_refunded. La reserva
--      queda `cancelled`; al acreditarse el refund, settle_refund la lleva a `refunded`
--      (semántica 0011). Guard de mismatch también en este camino: no se reembolsa un
--      monto que no coincide con lo esperado ('ignored'; el caller alerta).
--   4. Asientos autoritativos: v_total_seats se deriva de la propia reserva
--      (tickets_adult + tickets_child + tickets_student). p_total_seats queda DEPRECATED
--      (DEFAULT NULL, se acepta y se ignora; se elimina en una migración futura cuando
--      ningún caller desplegado lo envíe).
--   5. El camino payment_mismatch libera el hold `paying`/`active` (antes quedaba
--      filtrado para siempre: ni release-expired-holds ni cancel_stale lo tocaban).
--      Mismo fix en flag_payment_mismatch (abajo).
--   6. El camino feliz escribe en audit_logs (booking.confirmed) — antes el evento de
--      dinero más importante no dejaba traza forense.
--
-- Cambiar el tipo de retorno exige DROP + CREATE (CREATE OR REPLACE no puede cambiarlo),
-- por lo que se re-aplican REVOKE (specs 0018/0019) y se agrega GRANT explícito a
-- service_role (filosofía de grants explícitos de 0027). El guard is_public_request se
-- preserva en el cuerpo. Las funciones de auditoría de regresión (029/031/038) cubren
-- cualquier retroceso.
--
-- Reversibilidad: DROP de esta firma y re-CREATE del cuerpo de …037 (RETURNS void) para
-- confirm_booking, y re-CREATE del cuerpo de …029 para flag_payment_mismatch. Requiere
-- revertir también el código que consume el outcome (webhook web + recover del worker).
--
-- Nota de locks: el camino late toma bookings FOR UPDATE y luego toca payments, mientras
-- settle_refund toma refunds FOR UPDATE y luego payments/bookings. Con un refund
-- 'processing' de una reserva 'cancelled' y una llamada late concurrente hay una ventana
-- teórica de deadlock (Postgres aborta una transacción y el caller reintenta; no es un
-- hang). Ventana ínfima y auto-recuperable; homogeneizar el orden de settle_refund queda
-- para una migración futura si alguna vez se observa.

DROP FUNCTION IF EXISTS public.confirm_booking(uuid, text, integer, text, integer, text);

CREATE FUNCTION public.confirm_booking(
  p_booking_id          uuid,
  p_external_payment_id text,
  -- DEPRECATED (spec 0028): se ignora; los asientos se derivan de la reserva.
  p_total_seats         integer DEFAULT NULL,
  p_event_id            text DEFAULT NULL,
  p_paid_amount_cents   integer DEFAULT NULL,
  p_paid_currency       text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking           public.bookings;
  v_total_seats       integer;
  v_capacity_total    integer;
  v_capacity_reserved integer;
  v_payment           public.payments;
  v_expected          public.payments;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  -- Gate por evento (spec 0028): si el evento ya fue procesado, no-op ANTES de tocar
  -- nada. FOUND es true solo si el INSERT insertó una fila; en conflicto (evento
  -- repetido) es false. La fila vive en esta transacción: un rollback la deshace y el
  -- retry del proveedor reprocesa limpio (diseño de 0024, ahora gateando).
  IF p_event_id IS NOT NULL THEN
    INSERT INTO public.processed_webhook_events (id)
      VALUES (p_event_id)
      ON CONFLICT (id) DO NOTHING;
    IF NOT FOUND THEN
      RETURN 'already_processed';
    END IF;
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  -- Estados ya resueltos: no-op idempotente. Crítico porque el reconciliador llama SIN
  -- p_event_id: este gate por estado es su única idempotencia (espeja …036/…037).
  IF v_booking.status IN ('confirmed', 'refunded', 'overbooked_refunded') THEN
    RETURN 'already_processed';
  END IF;

  -- Mismatch pendiente de resolución manual: no tocar nada; el caller alerta.
  -- OJO: el gate por evento ya consumió p_event_id, así que un reenvío del MISMO
  -- evento devolverá 'already_processed' sin re-alertar. Es deliberado: la
  -- resolución del mismatch es manual (no llega por webhook); no lo "arregles"
  -- moviendo el gate después de este chequeo.
  IF v_booking.status = 'payment_mismatch' THEN
    RETURN 'ignored';
  END IF;

  -- Pago tardío (spec 0028, cierre del hallazgo crítico #2): la reserva ya fue cancelada
  -- (p. ej. staleness del reconciliador a los 30 min) pero el cobro ocurrió después. El
  -- dinero NO puede quedar huérfano: refund total automático + audit; el caller alerta.
  IF v_booking.status = 'cancelled' THEN
    -- Guard de mismatch también acá: jamás encolar un refund por un monto que no
    -- coincide con lo esperado ('ignored'; el pago queda como esté, revisión manual).
    IF p_paid_amount_cents IS NOT NULL AND p_paid_currency IS NOT NULL THEN
      SELECT * INTO v_expected
        FROM public.payments
        WHERE booking_id = p_booking_id AND external_payment_id = p_external_payment_id;
      IF FOUND AND (
        p_paid_amount_cents <> v_expected.amount_cents
        OR UPPER(p_paid_currency) <> UPPER(v_expected.currency)
      ) THEN
        RETURN 'ignored';
      END IF;
    END IF;

    -- Elegibilidad (fix del db-schema-guardian, review pre-PR): SOLO califica como
    -- "pago tardío" un pago que estaba 'pending' (webhook nunca llegó) o 'failed'
    -- (cancel_stale lo marcó al cancelar por staleness). Un pago ya 'succeeded'
    -- pertenece a una reserva que fue CONFIRMADA y luego cancelada por la vía normal:
    -- reembolsar acá violaría la política (<24h sin refund) o duplicaría un refund
    -- 'failed' en retry manual. Esos casos -> 'ignored' (el caller alerta).
    -- El turista pagó de verdad: el pago queda succeeded (espejo del camino overbooked;
    -- el refund necesita un pago succeeded que reembolsar y los reportes no deben ver
    -- un pago "refunded que nunca fue succeeded").
    UPDATE public.payments SET status = 'succeeded'
      WHERE booking_id = p_booking_id
        AND external_payment_id = p_external_payment_id
        AND status IN ('pending', 'failed')
      RETURNING * INTO v_payment;

    -- Sin fila elegible (no existe, o ya estaba succeeded/refunded): nada que
    -- reembolsar automáticamente; revisión manual (el caller alerta con el outcome).
    IF NOT FOUND THEN
      RETURN 'ignored';
    END IF;

    -- Refund total encolado en la MISMA transacción (patrón cancel_booking/…036). El
    -- índice único parcial refunds_one_active_per_booking garantiza a lo sumo un refund
    -- activo por reserva: reenvíos o carreras no duplican. Se registra en el audit si
    -- el refund realmente se encoló (traza forense veraz).
    INSERT INTO public.refunds (booking_id, payment_id, amount_cents, currency, reason)
    VALUES (
      p_booking_id, v_payment.id, v_payment.amount_cents, v_payment.currency,
      'late_payment'
    )
    ON CONFLICT (booking_id) WHERE status <> 'failed' DO NOTHING;

    INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
    VALUES (
      'system', 'booking.late_payment_refunded', 'booking', p_booking_id,
      jsonb_build_object(
        'refund_amount_cents', v_payment.amount_cents,
        'currency', v_payment.currency,
        'external_payment_id', p_external_payment_id,
        'event_id', p_event_id,
        'refund_enqueued', FOUND
      )
    );

    RETURN 'late_payment_refunded';
  END IF;

  -- Desde acá v_booking.status = 'pending_payment' (el CHECK de bookings agota los
  -- estados posibles).

  -- Guard de mismatch (spec 0026): solo corre si el caller pasó monto/moneda pagados.
  IF p_paid_amount_cents IS NOT NULL AND p_paid_currency IS NOT NULL THEN
    SELECT * INTO v_expected
      FROM public.payments
      WHERE booking_id = p_booking_id AND external_payment_id = p_external_payment_id;

    IF FOUND AND (
      p_paid_amount_cents <> v_expected.amount_cents
      OR UPPER(p_paid_currency) <> UPPER(v_expected.currency)
    ) THEN
      UPDATE public.bookings SET status = 'payment_mismatch' WHERE id = p_booking_id;

      -- 0028: liberar el hold. Un mismatch retiene la fila `paying` para siempre si no
      -- se libera acá (ni release-expired-holds ni cancel_stale la tocan): cupo
      -- bloqueado hasta UPDATE manual. El cupo no está confirmado en mismatch.
      IF v_booking.hold_id IS NOT NULL THEN
        UPDATE public.tour_holds SET status = 'released'
          WHERE id = v_booking.hold_id AND status IN ('active', 'paying');
      END IF;

      INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
      VALUES (
        'system', 'booking.payment_mismatch', 'booking', p_booking_id,
        jsonb_build_object(
          'expected_amount_cents', v_expected.amount_cents,
          'expected_currency', v_expected.currency,
          'paid_amount_cents', p_paid_amount_cents,
          'paid_currency', p_paid_currency,
          'source', 'confirm_booking'
        )
      );

      RETURN 'payment_mismatch';
    END IF;
  END IF;

  -- Asientos autoritativos (spec 0028): derivados de la propia reserva bajo lock.
  -- p_total_seats del caller se IGNORA: un caller con una lectura fallida (seats=0) ya
  -- no puede confirmar sin ocupar cupo ni dejar capacity_reserved inconsistente.
  v_total_seats := COALESCE(v_booking.tickets_adult, 0)
                 + COALESCE(v_booking.tickets_child, 0)
                 + COALESCE(v_booking.tickets_student, 0);

  -- Lock + lectura de la instancia para comparar el cupo de forma consistente ante
  -- confirmaciones concurrentes (dos pagos por el último asiento serializan acá).
  SELECT capacity_total, capacity_reserved
    INTO v_capacity_total, v_capacity_reserved
    FROM public.tour_instances
    WHERE id = v_booking.tour_instance_id
    FOR UPDATE;

  -- El turista pagó: en ambos caminos el pago queda succeeded (en el de sobreventa, para
  -- que el refund tenga un pago succeeded que reembolsar). DEBE quedar antes del branch y
  -- dentro del lock de la instancia: no mover después del RETURN del camino de sobreventa.
  UPDATE public.payments SET status = 'succeeded'
    WHERE booking_id = p_booking_id AND external_payment_id = p_external_payment_id;

  -- Capa 2 — sobreventa (spec 0025): confirmar superaría capacity_total. NO se confirma;
  -- reserva terminal overbooked_refunded + refund total. No se incrementa capacity_reserved.
  IF v_capacity_reserved + v_total_seats > v_capacity_total THEN
    UPDATE public.bookings SET status = 'overbooked_refunded' WHERE id = p_booking_id;

    IF v_booking.hold_id IS NOT NULL THEN
      UPDATE public.tour_holds SET status = 'released' WHERE id = v_booking.hold_id;
    END IF;

    SELECT * INTO v_payment
      FROM public.payments
      WHERE booking_id = p_booking_id AND external_payment_id = p_external_payment_id;

    IF FOUND THEN
      INSERT INTO public.refunds (booking_id, payment_id, amount_cents, currency, reason)
      VALUES (
        p_booking_id, v_payment.id, v_payment.amount_cents, v_payment.currency,
        'overbooked_refunded'
      )
      ON CONFLICT (booking_id) WHERE status <> 'failed' DO NOTHING;
    END IF;

    INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
    VALUES (
      'system', 'booking.overbooked_refunded', 'booking', p_booking_id,
      jsonb_build_object(
        'capacity_total', v_capacity_total,
        'capacity_reserved', v_capacity_reserved,
        'seats', v_total_seats,
        'refund_amount_cents', COALESCE(v_payment.amount_cents, 0),
        'currency', COALESCE(v_payment.currency, v_booking.currency)
      )
    );

    INSERT INTO public.notifications (booking_id, kind, recipient_email, locale, scheduled_for)
    VALUES (
      p_booking_id, 'overbooked_refunded',
      v_booking.customer_email, v_booking.locale, NOW()
    )
    ON CONFLICT (booking_id, kind) DO NOTHING;

    RETURN 'overbooked_refunded';
  END IF;

  -- Camino feliz: hay cupo. Confirmar e incrementar capacity_reserved.
  UPDATE public.bookings SET status = 'confirmed' WHERE id = p_booking_id;

  UPDATE public.tour_instances
    SET capacity_reserved = capacity_reserved + v_total_seats
    WHERE id = v_booking.tour_instance_id;

  IF v_booking.hold_id IS NOT NULL THEN
    UPDATE public.tour_holds SET status = 'converted' WHERE id = v_booking.hold_id;
  END IF;

  -- 0028: el evento de dinero más importante deja traza forense.
  INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
  VALUES (
    'system', 'booking.confirmed', 'booking', p_booking_id,
    jsonb_build_object(
      'seats', v_total_seats,
      'external_payment_id', p_external_payment_id,
      'event_id', p_event_id
    )
  );

  INSERT INTO public.notifications (
    booking_id, kind, recipient_email, locale, scheduled_for
  )
  VALUES (
    p_booking_id, 'booking_confirmation',
    v_booking.customer_email, v_booking.locale, NOW()
  )
  ON CONFLICT (booking_id, kind) DO NOTHING;

  INSERT INTO public.notifications (
    booking_id, kind, recipient_email, locale, scheduled_for
  )
  SELECT
    p_booking_id, 'reminder_24h',
    v_booking.customer_email, v_booking.locale,
    ti.starts_at - INTERVAL '24 hours'
  FROM public.tour_instances ti
  WHERE ti.id = v_booking.tour_instance_id
  ON CONFLICT (booking_id, kind) DO NOTHING;

  RETURN 'confirmed';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.confirm_booking(uuid, text, integer, text, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_booking(uuid, text, integer, text, integer, text)
  TO service_role;

-- ----------------------------------------------------------------
-- flag_payment_mismatch: cuerpo vigente (…029) + liberación del hold (spec 0028, mismo
-- fix que el camino mismatch de confirm_booking: sin esto el hold `paying` queda
-- reteniendo cupo para siempre).
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.flag_payment_mismatch(
  p_booking_id        uuid,
  p_paid_amount_cents integer,
  p_paid_currency     text,
  p_source            text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking public.bookings;
  v_payment public.payments;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  IF v_booking.status <> 'pending_payment' THEN
    RETURN false;
  END IF;

  SELECT * INTO v_payment
    FROM public.payments
    WHERE booking_id = p_booking_id
    ORDER BY created_at DESC
    LIMIT 1;

  UPDATE public.bookings SET status = 'payment_mismatch' WHERE id = p_booking_id;

  -- 0028: liberar el hold (`active` o `paying`); el cupo no está confirmado en mismatch.
  IF v_booking.hold_id IS NOT NULL THEN
    UPDATE public.tour_holds SET status = 'released'
      WHERE id = v_booking.hold_id AND status IN ('active', 'paying');
  END IF;

  INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
  VALUES (
    'system', 'booking.payment_mismatch', 'booking', p_booking_id,
    jsonb_build_object(
      'expected_amount_cents', v_payment.amount_cents,
      'expected_currency', v_payment.currency,
      'paid_amount_cents', p_paid_amount_cents,
      'paid_currency', p_paid_currency,
      'source', p_source
    )
  );

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.flag_payment_mismatch(uuid, integer, text, text)
  FROM PUBLIC, anon, authenticated;
