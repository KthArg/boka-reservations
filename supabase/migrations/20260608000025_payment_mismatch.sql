-- Migration: estado payment_mismatch + flag_payment_mismatch
-- Spec: 0014-validacion-monto-webhook
--
-- Cuando el monto/moneda que OnvoPay reporta como pagado NO coincide con lo que
-- esperábamos cobrar (payments.amount_cents/currency), la reserva NO se confirma:
-- pasa a 'payment_mismatch' (fuera de pending_payment, así el reconciliador del
-- 0013 no la levanta ni reintenta en loop) y se audita para revisión manual.
--
-- Reversibilidad: forward-only. Para revertir: restaurar el CHECK de 4 valores de
-- 20260527000012 (requiere que no haya filas en 'payment_mismatch') y
-- DROP FUNCTION public.flag_payment_mismatch(uuid, integer, text, text).

-- Ampliar el CHECK de bookings.status con el estado nuevo.
ALTER TABLE public.bookings DROP CONSTRAINT bookings_status_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('pending_payment', 'confirmed', 'cancelled', 'refunded', 'payment_mismatch'));

-- Marca una reserva como pago no coincidente. Atómica e idempotente (FOR UPDATE +
-- guard de estado), espejo de cancel_stale_pending_booking (0013). NO confirma, NO
-- toca payments (queda 'pending' → no cuenta como ingreso) ni capacity_reserved.
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
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  -- Solo se marca una reserva aún en pending_payment. Si el webhook ya la confirmó,
  -- o el otro camino ya la marcó, no se hace nada (idempotente, race-safe).
  IF v_booking.status <> 'pending_payment' THEN
    RETURN false;
  END IF;

  -- Pago esperado, para la bitácora (una reserva tiene a lo sumo una fila de pago).
  SELECT * INTO v_payment
    FROM public.payments
    WHERE booking_id = p_booking_id
    ORDER BY created_at DESC
    LIMIT 1;

  UPDATE public.bookings SET status = 'payment_mismatch' WHERE id = p_booking_id;

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

REVOKE EXECUTE ON FUNCTION public.flag_payment_mismatch(uuid, integer, text, text) FROM PUBLIC;
