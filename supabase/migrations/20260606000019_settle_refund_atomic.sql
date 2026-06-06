-- 0011 (fix): cierre atómico del reembolso acreditado.
--
-- El worker cerraba un refund exitoso (markSucceeded) con varios UPDATE +
-- insert de notificación + audit como round-trips sueltos, sin transacción.
-- Si el proceso caía a mitad, el refund quedaba 'succeeded' con el booking aún
-- 'cancelled' y, como el job solo reprocesa 'pending'/'processing', la reserva
-- nunca se reconciliaba (quedaba en limbo, fuera del alcance del retry manual).
--
-- Esta función espeja a cancel_booking: en UNA transacción marca
-- refund/payment/booking, encola el email de reembolso y audita. Idempotente:
-- solo actúa sobre un refund en 'processing' (una segunda llamada no hace nada).
--
-- Reversibilidad: forward-only (patrón del repo). Para revertir manualmente:
-- DROP FUNCTION public.settle_refund(uuid);

CREATE OR REPLACE FUNCTION public.settle_refund(p_refund_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_refund  public.refunds;
  v_booking public.bookings;
BEGIN
  SELECT * INTO v_refund FROM public.refunds WHERE id = p_refund_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REFUND_NOT_FOUND';
  END IF;

  -- Idempotente: solo se acredita un refund que está en proceso.
  IF v_refund.status <> 'processing' THEN
    RETURN;
  END IF;

  UPDATE public.refunds  SET status = 'succeeded' WHERE id = p_refund_id;
  UPDATE public.payments SET status = 'refunded'  WHERE id = v_refund.payment_id;
  UPDATE public.bookings SET status = 'refunded'  WHERE id = v_refund.booking_id;

  SELECT * INTO v_booking FROM public.bookings WHERE id = v_refund.booking_id;

  -- Encolar el email de confirmación de reembolso (idempotente vía UNIQUE).
  INSERT INTO public.notifications (booking_id, kind, recipient_email, locale, scheduled_for)
  VALUES (
    v_refund.booking_id, 'refund_confirmation',
    v_booking.customer_email, v_booking.locale, NOW()
  )
  ON CONFLICT (booking_id, kind) DO NOTHING;

  -- Bitácora del movimiento de dinero (incluye el id de OnvoPay y la moneda
  -- para poder reconciliar sin cruzar tablas).
  INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
  VALUES (
    'system', 'refund.succeeded', 'booking', v_refund.booking_id,
    jsonb_build_object(
      'amount_cents', v_refund.amount_cents,
      'currency', v_refund.currency,
      'external_refund_id', v_refund.external_refund_id
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_refund(uuid) FROM PUBLIC;
