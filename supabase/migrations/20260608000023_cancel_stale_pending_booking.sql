-- Migration: cancel_stale_pending_booking
-- Spec: 0013-reconciliacion-pagos-pendientes
--
-- Función atómica para cancelar una reserva ABANDONADA en pending_payment, que
-- usa el job de reconciliación del worker. NO es cancel_booking (0011): aquella
-- opera sobre reservas 'confirmed', libera cupo y encola refund + email. Esta
-- opera sobre reservas NO confirmadas: no hay cupo que liberar (una reserva
-- pending_payment nunca incrementó capacity_reserved; solo confirm_booking lo
-- hace), no hay refund, y no se notifica a nadie (el turista abandonó).

CREATE OR REPLACE FUNCTION public.cancel_stale_pending_booking(
  p_booking_id uuid,
  p_reason     text
)
RETURNS boolean
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

  -- Idempotente y seguro ante la race con el webhook: solo se cancela si la
  -- reserva SIGUE en pending_payment. Si el webhook la confirmó en paralelo (o
  -- ya fue cancelada), no se toca y se devuelve false.
  IF v_booking.status <> 'pending_payment' THEN
    RETURN false;
  END IF;

  UPDATE public.bookings SET status = 'cancelled' WHERE id = p_booking_id;

  -- Cierra el pago abandonado/rechazado: deja de ser ambiguo en futuras corridas.
  UPDATE public.payments
    SET status = 'failed'
    WHERE booking_id = p_booking_id AND status = 'pending';

  -- Defensivo: el hold ya suele estar expirado (15 min, spec 0005).
  IF v_booking.hold_id IS NOT NULL THEN
    UPDATE public.tour_holds
      SET status = 'expired'
      WHERE id = v_booking.hold_id AND status = 'active';
  END IF;

  -- NO se decrementa capacity_reserved (ver cabecera): es la diferencia clave
  -- con cancel_booking.

  INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
  VALUES (
    'system', 'booking.expired_pending', 'booking', p_booking_id,
    jsonb_build_object('reason', p_reason)
  );

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_stale_pending_booking(uuid, text) FROM PUBLIC;
