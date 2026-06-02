-- Migration: refunds, audit_logs, booking_access_tokens, cancel_booking
-- Spec: 0011-cancelaciones-refund-automatico
--
-- Cancelación de reservas (turista/staff) con refund automático contra
-- OnvoPay, bitácora de auditoría (diferida desde 0008), y token de acceso
-- hasheado a la reserva (resuelve el 404 del link "ver mi reserva" de 0007).

-- ----------------------------------------------------------------
-- refunds
-- Un reembolso encolado contra OnvoPay. El handler de cancelación NO llama
-- a OnvoPay: inserta la fila en 'pending' y el worker (job process-refunds)
-- la procesa por polling, porque OnvoPay no emite webhook de refund. La fila
-- es el ancla de idempotencia y de retry manual.
--
-- status:
--   pending    -> encolado, aún no se llamó a OnvoPay
--   processing -> POST /v1/refunds hecho, esperando resultado (OnvoPay pending)
--   succeeded  -> reembolso acreditado (terminal)
--   failed     -> OnvoPay rechazó o se agotaron los reintentos (retry manual)
-- ----------------------------------------------------------------
CREATE TABLE public.refunds (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id          uuid        NOT NULL REFERENCES public.bookings(id),
  payment_id          uuid        NOT NULL REFERENCES public.payments(id),
  external_refund_id  text        UNIQUE,
  amount_cents        integer     NOT NULL CHECK (amount_cents > 0),
  currency            text        NOT NULL DEFAULT 'USD',
  status              text        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','processing','succeeded','failed')),
  reason              text,
  failure_reason      text,
  attempts            integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at          timestamptz NOT NULL DEFAULT NOW(),
  updated_at          timestamptz NOT NULL DEFAULT NOW()
);

-- El job toma las filas activas; índice parcial para no inflar con terminales.
CREATE INDEX refunds_active_idx
  ON public.refunds (status)
  WHERE status IN ('pending','processing');

CREATE INDEX refunds_booking_idx ON public.refunds (booking_id);

-- A lo sumo un reembolso vigente (no fallido) por reserva: idempotencia ante
-- doble cancelación. Un reembolso fallido no cuenta, así que el retry puede
-- reactivarlo sin chocar con este índice.
CREATE UNIQUE INDEX refunds_one_active_per_booking
  ON public.refunds (booking_id)
  WHERE status <> 'failed';

CREATE TRIGGER set_refunds_updated_at
  BEFORE UPDATE ON public.refunds
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
-- Solo service_role accede (igual patrón que payments).

-- ----------------------------------------------------------------
-- audit_logs
-- Bitácora append-only de eventos sensibles. Se crea acá (diferida desde
-- 0008): por ahora la escriben cancelaciones y movimientos de refund. La
-- escritura es best-effort: nunca revierte la operación principal.
-- ----------------------------------------------------------------
CREATE TABLE public.audit_logs (
  id           uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_type   text        NOT NULL CHECK (actor_type IN ('tourist','staff','admin','system')),
  actor_id     uuid        REFERENCES public.users(id),
  action       text        NOT NULL,
  entity_type  text        NOT NULL,
  entity_id    uuid        NOT NULL,
  metadata     jsonb       NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX audit_logs_entity_idx  ON public.audit_logs (entity_type, entity_id);
CREATE INDEX audit_logs_created_idx ON public.audit_logs (created_at);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Lectura para el panel (admin/staff). Writes solo service_role.
CREATE POLICY audit_logs_select_panel
  ON public.audit_logs
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.jwt() ->> 'user_role') IN ('admin', 'staff'));

-- ----------------------------------------------------------------
-- booking_access_tokens
-- Token propio (NO Supabase Auth) para el magic link de "ver/gestionar mi
-- reserva". Se guarda solo el hash SHA-256; el texto plano viaja solo en el
-- email. Lo emite el worker al despachar cada email de reserva: cada email
-- inserta su propia fila, así ambos links (confirmación y recordatorio)
-- quedan válidos. Espejo de guide_access_tokens (0009).
-- ----------------------------------------------------------------
CREATE TABLE public.booking_access_tokens (
  id           uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id   uuid        NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  token_hash   text        NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT NOW(),
  last_used_at timestamptz
);

CREATE INDEX booking_access_tokens_booking_idx
  ON public.booking_access_tokens (booking_id, expires_at);

ALTER TABLE public.booking_access_tokens ENABLE ROW LEVEL SECURITY;
-- Sin políticas: solo service_role. Nunca se expone a clientes.

-- ----------------------------------------------------------------
-- notifications: extender kinds con los dos nuevos emails de esta feature.
-- El constraint notifications_target_coherence ya exige booking_id NOT NULL
-- para todo kind <> 'guide_assignment', así que cubre los nuevos sin cambios.
-- ----------------------------------------------------------------
ALTER TABLE public.notifications
  DROP CONSTRAINT notifications_kind_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN (
    'booking_confirmation',
    'reminder_24h',
    'guide_assignment',
    'cancellation_confirmation',
    'refund_confirmation'
  ));

-- ----------------------------------------------------------------
-- Función atómica de cancelación de booking.
-- Espejo de confirm_booking: en una sola transacción cancela la reserva,
-- libera el cupo, cancela el recordatorio pendiente, encola el email de
-- cancelación y, si corresponde reembolso, inserta la fila refunds.
--
-- La elegibilidad/monto del reembolso se calculan en la capa de aplicación
-- (regla de política) y se pasan acá: p_refund_amount_cents > 0 encola un
-- refund; 0 no. Idempotente: si la reserva no está 'confirmed', no hace nada.
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

  -- Bitácora de la cancelación.
  INSERT INTO public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_actor_type, p_actor_id, 'booking.cancelled', 'booking', p_booking_id,
    jsonb_build_object('refund_amount_cents', p_refund_amount_cents, 'seats', v_seats)
  );

  -- Encolar el reembolso si corresponde. Requiere un pago exitoso.
  IF p_refund_amount_cents > 0 THEN
    SELECT * INTO v_payment
      FROM public.payments
      WHERE booking_id = p_booking_id AND status = 'succeeded'
      ORDER BY created_at DESC
      LIMIT 1;

    IF FOUND THEN
      INSERT INTO public.refunds (booking_id, payment_id, amount_cents, currency, reason)
      VALUES (
        p_booking_id, v_payment.id, p_refund_amount_cents, v_booking.currency,
        'requested_by_customer'
      )
      ON CONFLICT (booking_id) WHERE status <> 'failed' DO NOTHING;

      INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
      VALUES (
        'system', 'refund.requested', 'booking', p_booking_id,
        jsonb_build_object('amount_cents', p_refund_amount_cents)
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
