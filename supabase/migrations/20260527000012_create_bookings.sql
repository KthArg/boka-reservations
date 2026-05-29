-- Migration: bookings, payments, processed_webhook_events
-- Spec: 0006-flujo-reserva-pago

-- ----------------------------------------------------------------
-- bookings
-- ----------------------------------------------------------------
CREATE TABLE public.bookings (
  id                    uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tour_instance_id      uuid        NOT NULL REFERENCES public.tour_instances(id),
  hold_id               uuid        REFERENCES public.tour_holds(id),
  customer_name         text        NOT NULL,
  customer_email        text        NOT NULL,
  tickets_adult         integer     NOT NULL DEFAULT 0 CHECK (tickets_adult >= 0),
  tickets_child         integer     NOT NULL DEFAULT 0 CHECK (tickets_child >= 0),
  tickets_student       integer     NOT NULL DEFAULT 0 CHECK (tickets_student >= 0),
  total_amount_cents    integer     NOT NULL CHECK (total_amount_cents > 0),
  currency              text        NOT NULL DEFAULT 'USD',
  status                text        NOT NULL DEFAULT 'pending_payment'
                                    CHECK (status IN ('pending_payment','confirmed','cancelled','refunded')),
  created_at            timestamptz NOT NULL DEFAULT NOW(),
  updated_at            timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT bookings_has_tickets CHECK (tickets_adult + tickets_child + tickets_student > 0)
);

CREATE INDEX bookings_instance_idx  ON public.bookings (tour_instance_id);
CREATE INDEX bookings_email_idx     ON public.bookings (customer_email);
CREATE INDEX bookings_status_idx    ON public.bookings (status);

CREATE TRIGGER set_bookings_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
-- Solo service_role accede (no hay políticas para anon/authenticated en MVP)

-- ----------------------------------------------------------------
-- payments
-- ----------------------------------------------------------------
CREATE TABLE public.payments (
  id                    uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id            uuid        NOT NULL REFERENCES public.bookings(id),
  external_provider     text        NOT NULL DEFAULT 'onvopay',
  external_payment_id   text        NOT NULL,
  amount_cents          integer     NOT NULL CHECK (amount_cents > 0),
  currency              text        NOT NULL DEFAULT 'USD',
  status                text        NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending','succeeded','failed','refunded')),
  created_at            timestamptz NOT NULL DEFAULT NOW(),
  updated_at            timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (external_provider, external_payment_id)
);

CREATE INDEX payments_booking_idx ON public.payments (booking_id);

CREATE TRIGGER set_payments_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------
-- processed_webhook_events (idempotencia)
-- ----------------------------------------------------------------
CREATE TABLE public.processed_webhook_events (
  id            text        NOT NULL PRIMARY KEY,
  processed_at  timestamptz NOT NULL DEFAULT NOW()
);

ALTER TABLE public.processed_webhook_events ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------
-- Función atómica de confirmación de booking
-- Confirma booking, payment, capacity_reserved y hold en una sola transacción.
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

  -- Confirmar booking
  UPDATE public.bookings SET status = 'confirmed' WHERE id = p_booking_id;

  -- Confirmar payment
  UPDATE public.payments SET status = 'succeeded'
    WHERE booking_id = p_booking_id AND external_payment_id = p_external_payment_id;

  -- Incrementar capacity_reserved en la instancia
  UPDATE public.tour_instances
    SET capacity_reserved = capacity_reserved + p_total_seats
    WHERE id = v_booking.tour_instance_id;

  -- Marcar hold como converted
  IF v_booking.hold_id IS NOT NULL THEN
    UPDATE public.tour_holds SET status = 'converted' WHERE id = v_booking.hold_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.confirm_booking(uuid, text, integer) FROM PUBLIC;
