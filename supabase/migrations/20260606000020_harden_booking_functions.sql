-- 0011 (fix, Checkpoint 6): endurecimiento de las funciones SECURITY DEFINER
-- y corrección del monto del reembolso.
--
-- (#4) confirm_booking y cancel_booking son SECURITY DEFINER pero no fijaban
-- search_path, contradiciendo el hardening que el proyecto ya aplicó en
-- 20260523000008. Un actor con permiso de crear objetos en otro schema del
-- search_path podría hacer que una función privilegiada (que mueve dinero y
-- cupo) resuelva versiones maliciosas de objetos no calificados. Ambas ya
-- califican todo con `public.`, así que `SET search_path = ''` es seguro.
--
-- (#5) cancel_booking insertaba el refund con el TOTAL de la reserva
-- (p_refund_amount_cents, derivado de bookings.total_amount_cents) en vez de lo
-- efectivamente cobrado (payments.amount_cents). Para la política binaria
-- "100% de lo pagado" lo correcto es reembolsar el monto y la moneda del pago.
-- Si total y pago difirieran (conversión de moneda, ajustes), se reembolsaba un
-- monto equivocado. Ahora p_refund_amount_cents solo decide elegibilidad (>0) y
-- el monto/moneda del refund salen del pago exitoso.
--
-- Reversibilidad: forward-only (patrón del repo). Las definiciones previas
-- quedan en 20260527000012 (confirm_booking) y 20260602000018 (cancel_booking).

-- ----------------------------------------------------------------
-- confirm_booking: idéntica a la versión vigente (20260530000013, que encola
-- la confirmación y el recordatorio 24h), solo agrega search_path.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_booking(
  p_booking_id          uuid,
  p_external_payment_id text,
  p_total_seats         integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking public.bookings;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  IF v_booking.status = 'confirmed' THEN
    RETURN; -- ya confirmado, idempotente
  END IF;

  UPDATE public.bookings SET status = 'confirmed' WHERE id = p_booking_id;

  UPDATE public.payments SET status = 'succeeded'
    WHERE booking_id = p_booking_id AND external_payment_id = p_external_payment_id;

  UPDATE public.tour_instances
    SET capacity_reserved = capacity_reserved + p_total_seats
    WHERE id = v_booking.tour_instance_id;

  IF v_booking.hold_id IS NOT NULL THEN
    UPDATE public.tour_holds SET status = 'converted' WHERE id = v_booking.hold_id;
  END IF;

  -- Encolar confirmación inmediata.
  INSERT INTO public.notifications (
    booking_id, kind, recipient_email, locale, scheduled_for
  )
  VALUES (
    p_booking_id, 'booking_confirmation',
    v_booking.customer_email, v_booking.locale, NOW()
  )
  ON CONFLICT (booking_id, kind) DO NOTHING;

  -- Encolar recordatorio 24h antes del inicio del tour. Si starts_at - 24h ya
  -- pasó (reserva con <24h de antelación), igual se inserta y el worker lo
  -- despacha en el siguiente ciclo (scheduled_for <= NOW()).
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
END;
$$;

REVOKE EXECUTE ON FUNCTION public.confirm_booking(uuid, text, integer) FROM PUBLIC;

-- ----------------------------------------------------------------
-- cancel_booking: agrega search_path y refunda el monto del PAGO, no el total.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_booking(
  p_booking_id          uuid,
  p_actor_type          text,
  p_refund_amount_cents integer,
  p_actor_id            uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking public.bookings;
  v_seats   integer;
  v_payment public.payments;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  -- Idempotente: solo se cancela una reserva confirmada.
  IF v_booking.status <> 'confirmed' THEN
    RETURN;
  END IF;

  v_seats := v_booking.tickets_adult + v_booking.tickets_child + v_booking.tickets_student;

  -- Cancelar la reserva y liberar el cupo (reverso exacto de confirm_booking).
  UPDATE public.bookings SET status = 'cancelled' WHERE id = p_booking_id;

  UPDATE public.tour_instances
    SET capacity_reserved = capacity_reserved - v_seats
    WHERE id = v_booking.tour_instance_id;

  -- Cancelar el recordatorio 24h si sigue pendiente.
  UPDATE public.notifications
    SET status = 'cancelled', cancelled_reason = 'booking_cancelled'
    WHERE booking_id = p_booking_id
      AND kind = 'reminder_24h'
      AND status = 'pending';

  -- Encolar el email de confirmación de cancelación.
  INSERT INTO public.notifications (
    booking_id, kind, recipient_email, locale, scheduled_for
  )
  VALUES (
    p_booking_id, 'cancellation_confirmation',
    v_booking.customer_email, v_booking.locale, NOW()
  )
  ON CONFLICT (booking_id, kind) DO NOTHING;

  -- Bitácora de la cancelación (refund_amount_cents = decisión de política).
  INSERT INTO public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_actor_type, p_actor_id, 'booking.cancelled', 'booking', p_booking_id,
    jsonb_build_object('refund_amount_cents', p_refund_amount_cents, 'seats', v_seats)
  );

  -- Encolar el reembolso si la política lo concede. Requiere un pago exitoso;
  -- el monto y la moneda salen del PAGO (lo efectivamente cobrado), no del total.
  IF p_refund_amount_cents > 0 THEN
    SELECT * INTO v_payment
      FROM public.payments
      WHERE booking_id = p_booking_id AND status = 'succeeded'
      ORDER BY created_at DESC
      LIMIT 1;

    IF FOUND THEN
      INSERT INTO public.refunds (booking_id, payment_id, amount_cents, currency, reason)
      VALUES (
        p_booking_id, v_payment.id, v_payment.amount_cents, v_payment.currency,
        'requested_by_customer'
      )
      ON CONFLICT (booking_id) WHERE status <> 'failed' DO NOTHING;

      INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
      VALUES (
        'system', 'refund.requested', 'booking', p_booking_id,
        jsonb_build_object('amount_cents', v_payment.amount_cents, 'currency', v_payment.currency)
      );
    ELSE
      -- Anomalía: se concedió reembolso pero no hay pago exitoso. Se cancela
      -- igual, sin refund, y se audita para investigar.
      INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
      VALUES (
        'system', 'refund.skipped_no_payment', 'booking', p_booking_id, '{}'
      );
    END IF;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_booking(uuid, text, integer, uuid) FROM PUBLIC;
