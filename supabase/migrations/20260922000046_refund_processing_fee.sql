-- Migration: reembolso sin la comisión de procesamiento (spec 0032).
--
--   1. refunds.processing_fee_cents: la comisión de OnvoPay descontada del reembolso cuando el
--      turista cancela por decisión propia. Default 0: filas existentes, reembolsos del sistema
--      (sobreventa, pago tardío) y cancelaciones del operador no descuentan nada.
--   2. cancel_booking, sobrecarga nueva de 6 parámetros: recibe el motivo (p_reason) y la
--      comisión (p_fee_cents), los audita, guarda la comisión en el refund y devuelve si canceló
--      ('cancelled') o si la reserva ya no estaba confirmada ('already_cancelled'). Garantiza en la
--      base que la decisión del operador reembolsa el total y que monto + comisión no superan el
--      total. La firma de 4 parámetros de …042 NO se borra: el código viejo la sigue usando y se
--      elimina en una migración de limpieza posterior (DROP con la firma explícita).
--   3. report_revenue: el bruto cuenta también los pagos 'refunded'. settle_refund pasa el pago a
--      'refunded' al acreditar el reembolso (aunque sea parcial), y el bruto solo contaba
--      'succeeded': cada reembolso restaba dos veces (con uno total, el neto daba -total en vez
--      de 0). Con los reembolsos parciales de este spec el error crecía.
--
-- Orden de despliegue: esta migración va ANTES del código nuevo. Es compatible hacia atrás (el
-- código viejo sigue funcionando con ella), pero el código nuevo llama a la firma nueva y lee la
-- columna nueva.
--
-- Reversibilidad, en este orden:
--   (1) Revertir el código de la web y del worker (la web llama a la firma nueva; el worker lee
--       refunds.processing_fee_cents en los emails).
--   (2) DROP FUNCTION public.cancel_booking(uuid, text, integer, text, integer, uuid).
--   (3) ALTER TABLE public.refunds DROP COLUMN processing_fee_cents. Borra el registro de las
--       comisiones descontadas: no revertir con reembolsos parciales ya hechos.
--   (4) report_revenue: re-CREATE OR REPLACE del cuerpo de …022 (vuelve el doble descuento).

SET LOCAL lock_timeout = '5s';

-- ================================================================
-- 1. Comisión descontada en el reembolso
-- ================================================================

ALTER TABLE public.refunds
  ADD COLUMN processing_fee_cents integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT refunds_processing_fee_cents_check CHECK (processing_fee_cents >= 0);

-- ================================================================
-- 2. cancel_booking con motivo y comisión
-- ================================================================

-- Mismo cuerpo que la de …042, más: validación de motivo, comisión y montos; motivo y comisión
-- en el audit booking.cancelled (y la comisión en refund.requested); la comisión en la fila de
-- refunds; y un resultado que distingue la cancelación efectiva de la reserva que ya no estaba
-- confirmada.
CREATE FUNCTION public.cancel_booking(
  p_booking_id          uuid,
  p_actor_type          text,
  p_refund_amount_cents integer,
  p_reason              text,
  p_fee_cents           integer,
  p_actor_id            uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking public.bookings;
  v_seats   integer;
  v_payment public.payments;
  v_refund_cents integer;
  v_fee_cents integer;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  IF p_reason IS NULL OR p_reason NOT IN ('customer_request', 'operator_decision') THEN
    RAISE EXCEPTION 'INVALID_REASON';
  END IF;

  -- La decisión del operador reembolsa el total: nunca descuenta comisión.
  IF p_fee_cents IS NULL OR p_fee_cents < 0
     OR (p_reason = 'operator_decision' AND p_fee_cents <> 0) THEN
    RAISE EXCEPTION 'INVALID_FEE';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  -- Ya cancelada o nunca confirmada: el llamador lo informa en vez de mostrar un monto que no se
  -- aplicó (dos cancelaciones concurrentes).
  IF v_booking.status <> 'confirmed' THEN
    RETURN 'already_cancelled';
  END IF;

  -- Invariantes de monto (después del chequeo de estado: una segunda cancelación sigue
  -- devolviendo 'already_cancelled'). La decisión del operador reembolsa el total, y el monto más
  -- la comisión nunca superan el total de la reserva.
  IF p_reason = 'operator_decision'
     AND p_refund_amount_cents <> v_booking.total_amount_cents THEN
    RAISE EXCEPTION 'INVALID_REFUND_AMOUNT';
  END IF;

  IF p_refund_amount_cents < 0
     OR p_refund_amount_cents + p_fee_cents > v_booking.total_amount_cents THEN
    RAISE EXCEPTION 'INVALID_REFUND_AMOUNT';
  END IF;

  v_seats := v_booking.tickets_adult + v_booking.tickets_child + v_booking.tickets_student;

  UPDATE public.bookings SET status = 'cancelled' WHERE id = p_booking_id;

  UPDATE public.tour_instances
    SET capacity_reserved = capacity_reserved - v_seats
    WHERE id = v_booking.tour_instance_id;

  UPDATE public.notifications
    SET status = 'cancelled', cancelled_reason = 'booking_cancelled'
    WHERE booking_id = p_booking_id
      AND kind = 'reminder_24h'
      AND status = 'pending';

  INSERT INTO public.notifications (
    booking_id, kind, recipient_email, locale, scheduled_for
  )
  VALUES (
    p_booking_id, 'cancellation_confirmation',
    v_booking.customer_email, v_booking.locale, NOW()
  )
  ON CONFLICT (booking_id, kind) DO NOTHING;

  INSERT INTO public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_actor_type, p_actor_id, 'booking.cancelled', 'booking', p_booking_id,
    jsonb_build_object(
      'refund_amount_cents', p_refund_amount_cents,
      'seats', v_seats,
      'reason', p_reason,
      'fee_cents', p_fee_cents
    )
  );

  IF p_refund_amount_cents > 0 THEN
    SELECT * INTO v_payment
      FROM public.payments
      WHERE booking_id = p_booking_id AND status = 'succeeded'
      ORDER BY created_at DESC
      LIMIT 1;

    IF FOUND THEN
      -- Se encola el monto que dictó la política, capado a lo efectivamente cobrado (…042). Si
      -- el tope recorta el monto, la comisión guardada se recorta también, para que reembolso +
      -- comisión nunca superen lo cobrado.
      v_refund_cents := LEAST(p_refund_amount_cents, v_payment.amount_cents);
      v_fee_cents := LEAST(p_fee_cents, v_payment.amount_cents - v_refund_cents);

      INSERT INTO public.refunds (
        booking_id, payment_id, amount_cents, currency, reason, processing_fee_cents
      )
      VALUES (
        p_booking_id, v_payment.id, v_refund_cents, v_payment.currency,
        'requested_by_customer', v_fee_cents
      )
      ON CONFLICT (booking_id) WHERE status <> 'failed' DO NOTHING;

      INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
      VALUES (
        'system', 'refund.requested', 'booking', p_booking_id,
        jsonb_build_object(
          'amount_cents', v_refund_cents,
          'currency', v_payment.currency,
          'fee_cents', v_fee_cents
        )
      );
    ELSE
      INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
      VALUES (
        'system', 'refund.skipped_no_payment', 'booking', p_booking_id, '{}'
      );
    END IF;
  END IF;

  RETURN 'cancelled';
END;
$$;

-- Crear una función le da EXECUTE a PUBLIC, y en Supabase anon/authenticated lo heredan por los
-- default privileges: sin este REVOKE, anon podría reembolsar montos arbitrarios (spec 0018).
REVOKE EXECUTE ON FUNCTION public.cancel_booking(uuid, text, integer, text, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_booking(uuid, text, integer, text, integer, uuid)
  TO service_role;

-- ================================================================
-- 3. report_revenue: el bruto incluye los pagos reembolsados
-- ================================================================

-- Mismo cuerpo que …022 salvo el filtro del bruto. CREATE OR REPLACE conserva sus permisos
-- (EXECUTE para authenticated, sin anon: …022 y …028).
CREATE OR REPLACE FUNCTION public.report_revenue(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (
  tour_id        uuid,
  name_es        text,
  name_en        text,
  gross_cents    bigint,
  refunded_cents bigint,
  net_cents      bigint,
  currency       text
)
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = ''
AS $$
  WITH gross AS (
    SELECT ti.tour_id,
           SUM(p.amount_cents)::bigint AS gross_cents,
           MAX(p.currency)             AS currency
    FROM public.payments p
    JOIN public.bookings b        ON b.id = p.booking_id
    JOIN public.tour_instances ti ON ti.id = b.tour_instance_id
    -- 'refunded': el cobro existió; el reembolso se resta aparte (spec 0032).
    WHERE p.status IN ('succeeded', 'refunded')
      AND p.created_at >= p_from AND p.created_at < p_to
    GROUP BY ti.tour_id
  ),
  refunded AS (
    SELECT ti.tour_id,
           SUM(r.amount_cents)::bigint AS refunded_cents,
           MAX(r.currency)             AS currency
    FROM public.refunds r
    JOIN public.bookings b        ON b.id = r.booking_id
    JOIN public.tour_instances ti ON ti.id = b.tour_instance_id
    WHERE r.status = 'succeeded'
      AND r.created_at >= p_from AND r.created_at < p_to
    GROUP BY ti.tour_id
  )
  SELECT
    t.id,
    t.name_es,
    t.name_en,
    COALESCE(g.gross_cents, 0),
    COALESCE(rf.refunded_cents, 0),
    COALESCE(g.gross_cents, 0) - COALESCE(rf.refunded_cents, 0),
    COALESCE(g.currency, rf.currency, 'USD')
  FROM public.tours t
  JOIN (
    SELECT tour_id FROM gross
    UNION
    SELECT tour_id FROM refunded
  ) tt ON tt.tour_id = t.id
  LEFT JOIN gross g     ON g.tour_id = t.id
  LEFT JOIN refunded rf ON rf.tour_id = t.id
  ORDER BY 6 DESC;
$$;
