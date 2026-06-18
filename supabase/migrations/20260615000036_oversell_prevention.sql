-- Migration: prevención de sobreventa (spec 0025).
--
-- Pasa de DETECTAR sobrecupo (0023: confirmaba igual + audit `booking.overbooked`) a
-- PREVENIRLO con dos capas:
--   Capa 1 — el hold pasa a estado `paying` al crear el payment intent y NO lo libera el
--     job release-expired-holds (que solo toca `active`); el cupo queda reservado durante
--     todo el ciclo de pago. `create_hold_atomic` ahora cuenta los holds `paying` como
--     ocupados. La ventana efectiva la define el umbral del reconciliador (worker, 30 min).
--   Capa 2 — `confirm_booking` deja de confirmar en sobrecupo: si confirmar superaría
--     capacity_total, la reserva pasa al terminal `overbooked_refunded`, NO incrementa
--     capacity_reserved, marca el pago succeeded y encola un refund TOTAL (lo procesa
--     `process-refunds`), libera el hold, audita `booking.overbooked_refunded` y notifica
--     al turista. Garantiza la invariante capacity_reserved <= capacity_total para reservas
--     confirmadas, bajo concurrencia (lock FOR UPDATE sobre tour_instances).
--
-- Funciones tocadas (CREATE OR REPLACE preserva el ACL; igual se re-REVOKE por consistencia
-- con el patrón del repo):
--   - confirm_booking        : guard de capacidad + overbooked_refunded + idempotencia ampliada.
--   - create_hold_atomic     : cuenta holds `paying` como ocupados.
--   - cancel_stale_pending_booking : libera también holds `paying` al cancelar pending.
--   - settle_refund          : preserva el terminal `overbooked_refunded` (no lo pisa con `refunded`).
--   - report_refunds_summary : trata `overbooked_refunded` análogo a `refunded`.
--
-- Reversibilidad: para revertir, restaurar los cuerpos de …035 (confirm_booking),
-- …028 (create_hold_atomic), …023 (cancel_stale_pending_booking), …029 (settle_refund),
-- …022 (report_refunds_summary) y los CHECK previos (requiere que no existan filas con los
-- valores nuevos `overbooked_refunded` / `paying`).

-- ----------------------------------------------------------------
-- 1. CHECK constraints: estados/valores nuevos.
-- ----------------------------------------------------------------
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN (
    'pending_payment', 'confirmed', 'cancelled', 'refunded', 'payment_mismatch',
    'overbooked_refunded'
  ));

ALTER TABLE public.tour_holds DROP CONSTRAINT IF EXISTS tour_holds_status_check;
ALTER TABLE public.tour_holds ADD CONSTRAINT tour_holds_status_check
  CHECK (status IN ('active', 'released', 'expired', 'converted', 'paying'));

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN (
    'booking_confirmation',
    'reminder_24h',
    'guide_assignment',
    'cancellation_confirmation',
    'refund_confirmation',
    'overbooked_refunded'
  ));

-- ----------------------------------------------------------------
-- 2. confirm_booking: guard de capacidad + auto-refund de respaldo.
--    Cuerpo vigente (…035/…029) reescrito: idempotencia ampliada a ambos terminales del
--    pago, lock de la instancia ANTES de decidir, y el camino overbooked_refunded.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_booking(
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
  v_booking           public.bookings;
  v_capacity_total    integer;
  v_capacity_reserved integer;
  v_payment           public.payments;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  IF p_event_id IS NOT NULL THEN
    INSERT INTO public.processed_webhook_events (id)
      VALUES (p_event_id)
      ON CONFLICT (id) DO NOTHING;
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  -- Idempotencia ampliada (spec 0025): cubre ambos terminales del pago. Crítico porque el
  -- reconciliador llama confirm_booking SIN p_event_id (la idempotencia por
  -- processed_webhook_events no aplica): este guard por estado es la única defensa contra
  -- un segundo refund en una reserva ya marcada overbooked_refunded.
  IF v_booking.status IN ('confirmed', 'overbooked_refunded') THEN
    RETURN;
  END IF;

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

  -- Capa 2 — sobreventa: confirmar superaría capacity_total. NO se confirma; reserva
  -- terminal overbooked_refunded + refund total. No se incrementa capacity_reserved.
  IF v_capacity_reserved + p_total_seats > v_capacity_total THEN
    UPDATE public.bookings SET status = 'overbooked_refunded' WHERE id = p_booking_id;

    IF v_booking.hold_id IS NOT NULL THEN
      UPDATE public.tour_holds SET status = 'released' WHERE id = v_booking.hold_id;
    END IF;

    -- Encolar el refund total (patrón de cancel_booking …029): a lo sumo un refund activo
    -- por reserva (índice refunds_one_active_per_booking). Lo procesa process-refunds.
    -- IF FOUND es defensivo: el pago se acaba de marcar succeeded por (booking_id,
    -- external_payment_id), así que normalmente existe; si faltara, la reserva igual queda
    -- overbooked_refunded (preserva la invariante) y el audit deja refund_amount_cents=0.
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
        'seats', p_total_seats,
        'refund_amount_cents', COALESCE(v_payment.amount_cents, 0),
        'currency', COALESCE(v_payment.currency, v_booking.currency)
      )
    );

    -- Notificar al turista: cupo agotado + reembolso en curso.
    INSERT INTO public.notifications (booking_id, kind, recipient_email, locale, scheduled_for)
    VALUES (
      p_booking_id, 'overbooked_refunded',
      v_booking.customer_email, v_booking.locale, NOW()
    )
    ON CONFLICT (booking_id, kind) DO NOTHING;

    RETURN;
  END IF;

  -- Camino feliz: hay cupo. Confirmar e incrementar capacity_reserved.
  UPDATE public.bookings SET status = 'confirmed' WHERE id = p_booking_id;

  UPDATE public.tour_instances
    SET capacity_reserved = capacity_reserved + p_total_seats
    WHERE id = v_booking.tour_instance_id;

  IF v_booking.hold_id IS NOT NULL THEN
    UPDATE public.tour_holds SET status = 'converted' WHERE id = v_booking.hold_id;
  END IF;

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
END;
$$;

REVOKE EXECUTE ON FUNCTION public.confirm_booking(uuid, text, integer, text)
  FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------
-- 3. create_hold_atomic: contar holds `paying` como ocupados (Capa 1). Cuerpo de …028
--    (search_path = '' incluido) con el único cambio en el cálculo de disponibilidad.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_hold_atomic(
  p_instance_id  uuid,
  p_seats        integer,
  p_session      text
)
RETURNS public.tour_holds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_instance   public.tour_instances;
  v_held       integer;
  v_available  integer;
  v_hold       public.tour_holds;
BEGIN
  SELECT * INTO v_instance
    FROM public.tour_instances
    WHERE id = p_instance_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'HOLD_INSTANCE_NOT_FOUND';
  END IF;

  IF v_instance.status <> 'available' THEN
    RAISE EXCEPTION 'HOLD_INSTANCE_UNAVAILABLE';
  END IF;

  IF v_instance.starts_at <= NOW() THEN
    RAISE EXCEPTION 'HOLD_INSTANCE_PAST';
  END IF;

  -- Hold activo previo del mismo session_token: devolverlo (no se reusa uno `paying`).
  SELECT * INTO v_hold
    FROM public.tour_holds
    WHERE tour_instance_id = p_instance_id
      AND session_token    = p_session
      AND status           = 'active'
      AND expires_at       > NOW();

  IF FOUND THEN
    RETURN v_hold;
  END IF;

  -- Cupos ocupados: holds `active` no expirados MÁS holds `paying` (estos cuentan mientras
  -- el pago esté vivo, sin mirar expires_at — es la garantía de cupo del spec 0025).
  SELECT COALESCE(SUM(held_seats), 0) INTO v_held
    FROM public.tour_holds
    WHERE tour_instance_id = p_instance_id
      AND (
        (status = 'active' AND expires_at > NOW())
        OR status = 'paying'
      );

  v_available := v_instance.capacity_total - v_instance.capacity_reserved - v_held;

  IF v_available < p_seats THEN
    RAISE EXCEPTION 'HOLD_NO_CAPACITY';
  END IF;

  INSERT INTO public.tour_holds (tour_instance_id, session_token, held_seats)
    VALUES (p_instance_id, p_session, p_seats)
    RETURNING * INTO v_hold;

  RETURN v_hold;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_hold_atomic(uuid, integer, text)
  FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------
-- 4. cancel_stale_pending_booking: al cancelar una pending abandonada, liberar también el
--    hold `paying` (la Capa 1 lo deja en ese estado). Cuerpo de …023 con el WHERE ampliado.
-- ----------------------------------------------------------------
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

  IF v_booking.status <> 'pending_payment' THEN
    RETURN false;
  END IF;

  UPDATE public.bookings SET status = 'cancelled' WHERE id = p_booking_id;

  UPDATE public.payments
    SET status = 'failed'
    WHERE booking_id = p_booking_id AND status = 'pending';

  -- El hold queda `active` (abandono temprano) o `paying` (abandono tras crear el intent):
  -- ambos se liberan. NO se decrementa capacity_reserved (una pending nunca lo incrementó).
  IF v_booking.hold_id IS NOT NULL THEN
    UPDATE public.tour_holds
      SET status = 'expired'
      WHERE id = v_booking.hold_id AND status IN ('active', 'paying');
  END IF;

  INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
  VALUES (
    'system', 'booking.expired_pending', 'booking', p_booking_id,
    jsonb_build_object('reason', p_reason)
  );

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_stale_pending_booking(uuid, text)
  FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------
-- 5. settle_refund: preservar el terminal `overbooked_refunded`. Cuerpo de …029 con el
--    único cambio en el UPDATE de bookings: una reserva overbooked_refunded NO se pisa con
--    `refunded` (sigue siendo un terminal distinto, visible en el panel y medible). El
--    camino de cancelación (booking `cancelled`) sí pasa a `refunded` como antes.
-- ----------------------------------------------------------------
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
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  SELECT * INTO v_refund FROM public.refunds WHERE id = p_refund_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REFUND_NOT_FOUND';
  END IF;

  IF v_refund.status <> 'processing' THEN
    RETURN;
  END IF;

  UPDATE public.refunds  SET status = 'succeeded' WHERE id = p_refund_id;
  UPDATE public.payments SET status = 'refunded'  WHERE id = v_refund.payment_id;
  UPDATE public.bookings SET status = 'refunded'
    WHERE id = v_refund.booking_id AND status <> 'overbooked_refunded';

  SELECT * INTO v_booking FROM public.bookings WHERE id = v_refund.booking_id;

  INSERT INTO public.notifications (booking_id, kind, recipient_email, locale, scheduled_for)
  VALUES (
    v_refund.booking_id, 'refund_confirmation',
    v_booking.customer_email, v_booking.locale, NOW()
  )
  ON CONFLICT (booking_id, kind) DO NOTHING;

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

REVOKE EXECUTE ON FUNCTION public.settle_refund(uuid)
  FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------
-- 6. report_refunds_summary: tratar `overbooked_refunded` análogo a `refunded` (reserva
--    cerrada con pago reembolsado). Cuenta en cancelaciones y en la base de reservas
--    válidas. Cuerpo de …022 con las dos listas de status ampliadas.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_refunds_summary(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (
  refunds_count        bigint,
  refunds_amount_cents bigint,
  cancelled_count      bigint,
  valid_bookings_count bigint,
  currency             text
)
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = ''
AS $$
  WITH r AS (
    SELECT
      COUNT(*)::bigint                  AS refunds_count,
      COALESCE(SUM(amount_cents), 0)::bigint AS refunds_amount_cents,
      MAX(currency)                     AS currency
    FROM public.refunds
    WHERE status = 'succeeded'
      AND created_at >= p_from AND created_at < p_to
  ),
  bk AS (
    SELECT
      COUNT(*) FILTER (
        WHERE b.status IN ('cancelled', 'refunded', 'overbooked_refunded')
      )::bigint AS cancelled_count,
      COUNT(*) FILTER (
        WHERE b.status IN ('confirmed', 'cancelled', 'refunded', 'overbooked_refunded')
      )::bigint AS valid_bookings_count
    FROM public.bookings b
    JOIN public.tour_instances ti ON ti.id = b.tour_instance_id
    WHERE ti.starts_at >= p_from AND ti.starts_at < p_to
  )
  SELECT r.refunds_count, r.refunds_amount_cents,
         bk.cancelled_count, bk.valid_bookings_count,
         COALESCE(r.currency, 'USD')
  FROM r, bk;
$$;

REVOKE EXECUTE ON FUNCTION public.report_refunds_summary(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_refunds_summary(timestamptz, timestamptz) TO authenticated;
