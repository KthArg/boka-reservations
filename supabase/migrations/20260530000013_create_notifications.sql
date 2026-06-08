-- Migration: notifications + bookings.locale + update confirm_booking
-- Spec: 0007-notificaciones-email

-- ----------------------------------------------------------------
-- bookings.locale
-- Idioma del cliente al momento del checkout. Determina el idioma
-- de los emails de confirmación y recordatorio. Default 'es' porque
-- es el idioma primario del portal en Costa Rica.
-- ----------------------------------------------------------------
ALTER TABLE public.bookings
  ADD COLUMN locale text NOT NULL DEFAULT 'es'
  CHECK (locale IN ('es','en'));

-- ----------------------------------------------------------------
-- notifications
-- Cola persistente de emails transaccionales. El worker hace polling
-- cada 60s, dispara el envío vía Resend (staging/prod) o Mailpit (dev),
-- y actualiza el estado.
-- ----------------------------------------------------------------
CREATE TABLE public.notifications (
  id                    uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id            uuid        NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  kind                  text        NOT NULL
                                    CHECK (kind IN ('booking_confirmation','reminder_24h')),
  channel               text        NOT NULL DEFAULT 'email'
                                    CHECK (channel IN ('email')),
  recipient_email       text        NOT NULL,
  locale                text        NOT NULL
                                    CHECK (locale IN ('es','en')),
  status                text        NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending','sent','failed','cancelled')),
  scheduled_for         timestamptz NOT NULL,
  attempts              integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  provider              text,
  provider_message_id   text,
  last_error            text,
  sent_at               timestamptz,
  cancelled_reason      text,
  created_at            timestamptz NOT NULL DEFAULT NOW(),
  updated_at            timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (booking_id, kind)
);

-- El job del worker filtra por (status='pending' AND scheduled_for <= NOW())
-- ordenado por scheduled_for. Index parcial: cubre el caso caliente sin
-- inflar el índice con filas ya despachadas.
CREATE INDEX notifications_pending_idx
  ON public.notifications (scheduled_for)
  WHERE status = 'pending';

CREATE INDEX notifications_booking_idx
  ON public.notifications (booking_id);

CREATE TRIGGER set_notifications_updated_at
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
-- Solo service_role accede (igual patrón que bookings/payments).

-- ----------------------------------------------------------------
-- Actualización de confirm_booking
-- Encola las dos notificaciones dentro de la misma transacción que
-- confirma la reserva. ON CONFLICT DO NOTHING garantiza idempotencia
-- ante reintentos del webhook (la función ya retornaba temprano si
-- status='confirmed', pero el ON CONFLICT cubre el caso atípico donde
-- el INSERT corre dos veces antes del UPDATE).
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_booking(
  p_booking_id          uuid,
  p_external_payment_id text,
  p_total_seats         integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
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

  -- Encolar confirmación inmediata
  INSERT INTO public.notifications (
    booking_id, kind, recipient_email, locale, scheduled_for
  )
  VALUES (
    p_booking_id, 'booking_confirmation',
    v_booking.customer_email, v_booking.locale, NOW()
  )
  ON CONFLICT (booking_id, kind) DO NOTHING;

  -- Encolar recordatorio 24h antes del inicio del tour.
  -- Si starts_at - 24h queda en el pasado (reserva con <24h de antelación),
  -- igual se inserta: el worker la despacha en el siguiente ciclo porque
  -- scheduled_for <= NOW().
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
