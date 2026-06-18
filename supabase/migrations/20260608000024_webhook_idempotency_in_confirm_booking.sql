-- Migration: idempotencia del webhook DENTRO de confirm_booking
-- Spec/Deuda: pre-production-checklist (Pagos/Webhooks) + tech-decisions
--
-- Problema: el handler del webhook (web/app/api/webhooks/onvopay/route.ts)
-- insertaba el registro de idempotencia en processed_webhook_events ANTES de
-- llamar a confirm_booking y, ante un fallo de la RPC, devolvía 500 SIN borrarlo.
-- Resultado: cualquier fallo transitorio de confirm_booking marcaba el evento
-- como procesado para siempre; el retry de OnvoPay veía el registro, respondía
-- 200, y la reserva quedaba sin confirmar (turista pagó y no recibió nada).
--
-- Solución: mover el INSERT en processed_webhook_events DENTRO de confirm_booking,
-- en la MISMA transacción. Si la confirmación falla y hace rollback, el registro
-- de idempotencia se deshace también, así que el retry reprocesa limpio. El
-- handler deja de manejar idempotencia.
--
-- confirm_booking gana un 4º parámetro p_event_id (DEFAULT NULL). Cuando viene
-- (camino del webhook), se registra la idempotencia in-tx. Cuando es NULL (p. ej.
-- el job de reconciliación del spec 0013, que NO es un webhook), se omite. Hay
-- que DROPear la firma vieja de 3 args primero: agregar un parámetro crea una
-- función distinta, y una llamada de 3 args quedaría ambigua entre ambas.
--
-- Cuerpo basado en la definición VIGENTE (20260606000020, que encola
-- confirmación + recordatorio 24h y fija search_path), no en la original.
--
-- Reversibilidad: forward-only. Una reversión completa requiere DOS cosas: (1)
-- recrear la firma de 3 args de 20260606000020 y DROPear esta de 4 args, y (2)
-- revertir el handler (route.ts), que ya pasa p_event_id — si no, llamaría con
-- un argumento inexistente.

DROP FUNCTION IF EXISTS public.confirm_booking(uuid, text, integer);

CREATE FUNCTION public.confirm_booking(
  p_booking_id          uuid,
  p_external_payment_id text,
  p_total_seats         integer,
  p_event_id            text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking public.bookings;
BEGIN
  -- Idempotencia del webhook en la MISMA transacción: si la confirmación falla
  -- (rollback), este registro se deshace y el retry de OnvoPay reprocesa. El
  -- ON CONFLICT cubre la entrega duplicada del mismo evento; la idempotencia a
  -- nivel reserva la cubre el guard de status más abajo.
  IF p_event_id IS NOT NULL THEN
    INSERT INTO public.processed_webhook_events (id)
      VALUES (p_event_id)
      ON CONFLICT (id) DO NOTHING;
  END IF;

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

REVOKE EXECUTE ON FUNCTION public.confirm_booking(uuid, text, integer, text) FROM PUBLIC;
