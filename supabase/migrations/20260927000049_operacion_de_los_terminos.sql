-- Migración …049 — Operación prometida en los términos (spec 0035).
--
-- Los términos del spec 0034 prometen, para el cobro inmediato:
--   1. Cierre por mínimo con 24 h de aviso y reembolso del 100 % (resolve_immediate_minimum).
--   2. Cancelación de una salida entera por el operador (cancel_departure): por mínimo u otra
--      causa, reembolso del 100 %; por clima o seguridad, cada reserva queda en revisión y el
--      equipo decide (refund_reviewed_booking, close_reviewed_booking_without_refund o
--      reschedule_booking).
--   3. Mantener una salida bajo el mínimo (keep_departure).
--   4. Cambio de fecha a otra salida del mismo tour, sin cobro ni reembolso (reschedule_booking).
--   5. Punto de encuentro fijo para quien ya reservó (trigger tours_meeting_point_lock).
--   6. Devolución por transferencia o SINPE Móvil cuando la tarjeta no la acepta
--      (request_refund_transfer, settle_refund_transfer).
--
-- Hardening (patrón …044): SECURITY DEFINER + search_path = '' + guard is_public_request() +
-- REVOKE de PUBLIC, anon, authenticated + GRANT a service_role. El panel llama con el service
-- client después de verificar el rol; cada función vuelve a validar que el actor sea admin o
-- staff activo.
--
-- Orden de locks: siempre la instancia antes que la reserva (cancel_departure, reschedule_booking
-- y las decisiones de revisión). Dos instancias, en orden de id.
--
-- Reversión: DROP de las funciones y del trigger; restaurar refunds_status_check y
-- notifications_kind_check de …018/…043 (solo si no quedan filas con los valores nuevos); DROP de
-- las columnas nuevas. operator_review_required_at y los datos de transferencia son evidencia de
-- decisiones con plata: no revertirlos si ya hay filas.

SET LOCAL lock_timeout = '5s';

-- ================================================================
-- 1. Columnas y constraints
-- ================================================================
ALTER TABLE public.tour_instances
  ADD COLUMN cancellation_reason text NULL
    CONSTRAINT tour_instances_cancellation_reason_check
    CHECK (cancellation_reason IN ('minimum', 'weather', 'safety', 'other'));

ALTER TABLE public.bookings
  ADD COLUMN operator_review_required_at timestamptz NULL;

-- Una reserva en revisión sigue cobrada y viva: cancelarla o reembolsarla exige decidir primero,
-- y eso lo hacen solo las funciones de decisión, que limpian la marca.
ALTER TABLE public.bookings ADD CONSTRAINT bookings_operator_review_check
  CHECK (operator_review_required_at IS NULL OR status = 'confirmed');

CREATE INDEX bookings_operator_review_idx
  ON public.bookings (operator_review_required_at)
  WHERE operator_review_required_at IS NOT NULL;

ALTER TABLE public.refunds DROP CONSTRAINT IF EXISTS refunds_status_check;
ALTER TABLE public.refunds ADD CONSTRAINT refunds_status_check
  CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'awaiting_transfer'));

ALTER TABLE public.refunds
  ADD COLUMN method text NOT NULL DEFAULT 'card'
    CONSTRAINT refunds_method_check CHECK (method IN ('card', 'transfer')),
  ADD COLUMN transfer_channel text NULL
    CONSTRAINT refunds_transfer_channel_check
    CHECK (transfer_channel IN ('sinpe_movil', 'bank_transfer')),
  ADD COLUMN transfer_reference    text        NULL,
  ADD COLUMN transfer_requested_at timestamptz NULL,
  ADD COLUMN transfer_paid_at      timestamptz NULL;

-- Una transferencia pedida es de método transferencia y tiene fecha de pedido; una pagada tiene
-- canal, comprobante y fecha. Ninguna tarjeta lleva datos de transferencia.
ALTER TABLE public.refunds ADD CONSTRAINT refunds_transfer_coherence_check
  CHECK (
    (method = 'card'
      AND transfer_channel IS NULL AND transfer_reference IS NULL
      AND transfer_requested_at IS NULL AND transfer_paid_at IS NULL
      AND status <> 'awaiting_transfer')
    OR (method = 'transfer'
      AND transfer_requested_at IS NOT NULL
      AND status IN ('awaiting_transfer', 'succeeded')
      AND (status = 'awaiting_transfer' OR (
        transfer_channel IS NOT NULL
        AND transfer_reference IS NOT NULL AND btrim(transfer_reference) <> ''
        AND transfer_paid_at IS NOT NULL
      )))
  );

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN (
    'booking_confirmation',
    'reminder_24h',
    'guide_assignment',
    'cancellation_confirmation',
    'refund_confirmation',
    'overbooked_refunded',
    'booking_reserved',
    'departure_cancelled_minimum',
    'charge_failed_action_required_1',
    'charge_failed_action_required_2',
    'charge_failed_action_required_3',
    'charge_requires_action',
    'departure_cancelled',
    'booking_rescheduled',
    'refund_transfer_request'
  ));

-- ================================================================
-- 2. Helpers internos (sin EXECUTE para nadie: solo los llaman las funciones de abajo)
-- ================================================================

-- Admin o staff activo. Las decisiones con plata no aceptan un actor cualquiera.
CREATE FUNCTION public.is_panel_actor(p_actor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_actor_id AND u.role IN ('admin', 'staff') AND u.active
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_panel_actor(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Encola un aviso de la reserva. Si ya existía uno del mismo kind (una segunda cancelación de
-- salida tras un cambio de fecha, un segundo cambio de fecha), lo vuelve a pendiente: el turista
-- tiene que enterarse de cada cambio. Una reserva sin correo (anonimizada) no recibe aviso.
CREATE FUNCTION public.enqueue_booking_notice(p_booking public.bookings, p_kind text)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF p_booking.customer_email IS NULL OR btrim(p_booking.customer_email) = '' THEN
    RETURN;
  END IF;

  INSERT INTO public.notifications (booking_id, kind, recipient_email, locale, scheduled_for)
  VALUES (p_booking.id, p_kind, p_booking.customer_email, p_booking.locale, now())
  ON CONFLICT (booking_id, kind) DO UPDATE
    SET status = 'pending',
        scheduled_for = now(),
        attempts = 0,
        last_error = NULL,
        sent_at = NULL,
        cancelled_reason = NULL,
        recipient_email = EXCLUDED.recipient_email;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.enqueue_booking_notice(public.bookings, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- ================================================================
-- 3. cancel_departure
-- ================================================================
CREATE FUNCTION public.cancel_departure(
  p_instance_id uuid,
  p_reason      text,
  p_actor_id    uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_instance public.tour_instances;
  v_booking  public.bookings;
  v_actor    text;
  v_counts   jsonb;
  v_refunded integer := 0;
  v_review   integer := 0;
  v_unpaid   integer := 0;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  IF p_reason IS NULL OR p_reason NOT IN ('minimum', 'weather', 'safety', 'other') THEN
    RAISE EXCEPTION 'INVALID_REASON';
  END IF;

  -- Solo el proceso automático del mínimo cancela sin actor.
  IF p_actor_id IS NULL AND p_reason <> 'minimum' THEN
    RAISE EXCEPTION 'ACTOR_REQUIRED';
  END IF;

  IF p_actor_id IS NOT NULL AND NOT public.is_panel_actor(p_actor_id) THEN
    RAISE EXCEPTION 'INVALID_ACTOR';
  END IF;

  SELECT * INTO v_instance FROM public.tour_instances WHERE id = p_instance_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSTANCE_NOT_FOUND';
  END IF;

  IF v_instance.status = 'cancelled' THEN
    RETURN 'already_cancelled';
  END IF;

  IF v_instance.starts_at <= now() THEN
    RETURN 'already_started';
  END IF;

  -- Los términos prometen 24 h de aviso para cancelar por mínimo. Con menos, la salida se hace
  -- (o el staff la cancela por otra causa, con reembolso del 100 %).
  IF p_reason = 'minimum' THEN
    IF v_instance.starts_at <= now() + interval '24 hours' THEN
      RETURN 'minimum_too_late';
    END IF;
    IF v_instance.minimum_resolved_at IS NOT NULL THEN
      RETURN 'already_resolved';
    END IF;
  END IF;

  -- Captura del motor diferido en curso (…047): cancelar ahora dejaría plata cobrada sin reserva.
  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE tour_instance_id = p_instance_id
      AND status = 'pending_payment'
      AND capture_started_at > now() - interval '15 minutes'
  ) THEN
    RETURN 'capture_in_progress';
  END IF;

  -- La foto antes de cancelar: después los cupos dan cero y el audit perdería la evidencia.
  v_counts := public.departure_seat_counts(p_instance_id);
  v_actor := public.audit_actor_type(p_actor_id, 'system');

  -- Cobradas.
  FOR v_booking IN
    SELECT * FROM public.bookings
      WHERE tour_instance_id = p_instance_id AND status = 'confirmed'
      ORDER BY created_at
  LOOP
    IF p_reason IN ('minimum', 'other') THEN
      PERFORM public.cancel_booking(
        v_booking.id, v_actor, v_booking.total_amount_cents, 'operator_decision', 0, p_actor_id
      );
      -- Un solo aviso: el de salida cancelada, que ya dice el monto devuelto.
      UPDATE public.notifications
        SET status = 'cancelled', cancelled_reason = 'departure_cancelled'
        WHERE booking_id = v_booking.id
          AND kind = 'cancellation_confirmation'
          AND status = 'pending';
      v_refunded := v_refunded + 1;
    ELSE
      -- Clima o seguridad: el turista reservó bajo su propio riesgo. Sin reembolso automático;
      -- el equipo decide cada reserva desde el panel.
      UPDATE public.bookings
        SET operator_review_required_at = now()
        WHERE id = v_booking.id;
      UPDATE public.notifications
        SET status = 'cancelled', cancelled_reason = 'departure_cancelled'
        WHERE booking_id = v_booking.id AND kind = 'reminder_24h' AND status = 'pending';
      v_review := v_review + 1;
    END IF;
    PERFORM public.enqueue_booking_notice(v_booking, 'departure_cancelled');
  END LOOP;

  -- Pago en curso del cobro inmediato (el turista está en el widget). Si igual termina de pagar,
  -- entra por el camino de pago tardío de …040, que reembolsa solo. provider_closed_at queda en
  -- NULL: esta función no habla con la pasarela.
  FOR v_booking IN
    SELECT * FROM public.bookings
      WHERE tour_instance_id = p_instance_id
        AND status = 'pending_payment'
        AND payment_method_id IS NULL
      ORDER BY created_at
  LOOP
    UPDATE public.payments
      SET status = 'failed', failed_at = now()
      WHERE booking_id = v_booking.id AND status = 'pending';
    UPDATE public.bookings SET status = 'cancelled' WHERE id = v_booking.id;
    IF v_booking.hold_id IS NOT NULL THEN
      UPDATE public.tour_holds SET status = 'released'
        WHERE id = v_booking.hold_id AND status IN ('active', 'paying');
    END IF;
    INSERT INTO public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
    VALUES (
      v_actor, p_actor_id, 'booking.cancelled', 'booking', v_booking.id,
      jsonb_build_object('reason', 'departure_cancelled', 'refund_amount_cents', 0)
    );
    PERFORM public.enqueue_booking_notice(v_booking, 'departure_cancelled');
    v_unpaid := v_unpaid + 1;
  END LOOP;

  -- Flujo diferido (spec 0033): se cancelan como siempre, pero el aviso es el de salida
  -- cancelada, que nombra el motivo real.
  FOR v_booking IN
    SELECT * FROM public.bookings
      WHERE tour_instance_id = p_instance_id
        AND status IN ('pending_minimum', 'pending_payment')
        AND payment_method_id IS NOT NULL
      ORDER BY created_at
  LOOP
    PERFORM public.cancel_booking_for_departure(
      v_booking.id,
      CASE WHEN p_actor_id IS NULL THEN 'auto_cancelled' ELSE 'staff_cancelled' END
    );
    UPDATE public.notifications
      SET status = 'cancelled', cancelled_reason = 'departure_cancelled'
      WHERE booking_id = v_booking.id
        AND kind = 'departure_cancelled_minimum'
        AND status = 'pending';
    PERFORM public.enqueue_booking_notice(v_booking, 'departure_cancelled');
    v_unpaid := v_unpaid + 1;
  END LOOP;

  UPDATE public.tour_instances
    SET status = 'cancelled',
        cancellation_reason = p_reason
    WHERE id = p_instance_id;

  IF p_reason = 'minimum' THEN
    UPDATE public.tour_instances
      SET minimum_resolved_at = now(),
          minimum_resolution  = CASE WHEN p_actor_id IS NULL
                                     THEN 'auto_cancelled' ELSE 'staff_cancelled' END,
          minimum_resolved_by = p_actor_id
      WHERE id = p_instance_id;
  END IF;

  INSERT INTO public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_actor, p_actor_id, 'departure.cancelled', 'tour_instance', p_instance_id,
    jsonb_build_object(
      'reason', p_reason,
      'counts', v_counts,
      'refunded_bookings', v_refunded,
      'review_bookings', v_review,
      'unpaid_bookings', v_unpaid
    )
  );

  RETURN 'cancelled';
END;
$$;

-- ================================================================
-- 4. resolve_immediate_minimum (solo el worker) y keep_departure (staff)
-- ================================================================
CREATE FUNCTION public.resolve_immediate_minimum(p_instance_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_instance public.tour_instances;
  v_minimum  integer;
  v_result   text;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  SELECT * INTO v_instance FROM public.tour_instances WHERE id = p_instance_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSTANCE_NOT_FOUND';
  END IF;

  IF v_instance.status = 'cancelled' OR v_instance.minimum_resolved_at IS NOT NULL THEN
    RETURN 'already_resolved';
  END IF;

  -- Ventana de 24 a 25 horas: la hora extra es margen para que el aviso salga antes del límite.
  IF v_instance.starts_at <= now() + interval '24 hours'
     OR v_instance.starts_at > now() + interval '25 hours' THEN
    RETURN 'not_due';
  END IF;

  -- Una salida con reservas del cobro diferido la resuelve el motor del spec 0033.
  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE tour_instance_id = p_instance_id
      AND payment_method_id IS NOT NULL
      AND status IN ('pending_minimum', 'pending_payment', 'confirmed')
  ) THEN
    RETURN 'deferred_flow';
  END IF;

  SELECT t.min_participants INTO v_minimum
    FROM public.tours t WHERE t.id = v_instance.tour_id;

  IF v_minimum <= 1 OR v_instance.capacity_reserved >= v_minimum THEN
    -- `reached` exige disparo y foto (…043/…047).
    UPDATE public.tour_instances
      SET minimum_charge_triggered_at = now(),
          min_participants_at_trigger = v_minimum,
          seats_at_trigger            = v_instance.capacity_reserved,
          minimum_resolved_at         = now(),
          minimum_resolution          = 'reached'
      WHERE id = p_instance_id;

    INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
    VALUES (
      'system', 'departure.minimum_resolved', 'tour_instance', p_instance_id,
      jsonb_build_object(
        'resolution', 'reached',
        'minimum', v_minimum,
        'seats', v_instance.capacity_reserved
      )
    );
    RETURN 'reached';
  END IF;

  v_result := public.cancel_departure(p_instance_id, 'minimum', NULL);
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.keep_departure(p_instance_id uuid, p_actor_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_instance public.tour_instances;
  v_minimum  integer;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  IF p_actor_id IS NULL OR NOT public.is_panel_actor(p_actor_id) THEN
    RAISE EXCEPTION 'INVALID_ACTOR';
  END IF;

  SELECT * INTO v_instance FROM public.tour_instances WHERE id = p_instance_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSTANCE_NOT_FOUND';
  END IF;

  IF v_instance.status = 'cancelled' THEN
    RETURN 'already_cancelled';
  END IF;

  IF v_instance.minimum_resolved_at IS NOT NULL THEN
    RETURN 'already_resolved';
  END IF;

  -- El motor diferido tiene su propia decisión (decideDeparture): mantener acá dispararía el
  -- cobro de reservas que ese motor todavía no autorizó.
  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE tour_instance_id = p_instance_id
      AND payment_method_id IS NOT NULL
      AND status IN ('pending_minimum', 'pending_payment', 'confirmed')
  ) THEN
    RETURN 'deferred_flow';
  END IF;

  SELECT t.min_participants INTO v_minimum
    FROM public.tours t WHERE t.id = v_instance.tour_id;

  UPDATE public.tour_instances
    SET minimum_charge_triggered_at = now(),
        min_participants_at_trigger = v_minimum,
        seats_at_trigger            = v_instance.capacity_reserved,
        minimum_resolved_at         = now(),
        minimum_resolution          = 'staff_confirmed',
        minimum_resolved_by         = p_actor_id
    WHERE id = p_instance_id;

  INSERT INTO public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    public.audit_actor_type(p_actor_id, 'staff'), p_actor_id,
    'departure.minimum_resolved', 'tour_instance', p_instance_id,
    jsonb_build_object(
      'resolution', 'staff_confirmed',
      'minimum', v_minimum,
      'seats', v_instance.capacity_reserved
    )
  );

  RETURN 'resolved';
END;
$$;

-- ================================================================
-- 5. Decisiones sobre reservas en revisión
-- ================================================================

-- Bloquea la instancia y después la reserva (mismo orden que reschedule_booking). Devuelve la
-- reserva bloqueada, o NULL si se movió de salida entre la lectura y el lock.
CREATE FUNCTION public.lock_booking_with_instance(p_booking_id uuid)
RETURNS public.bookings
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_instance_id uuid;
  v_booking     public.bookings;
BEGIN
  SELECT tour_instance_id INTO v_instance_id FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  PERFORM 1 FROM public.tour_instances WHERE id = v_instance_id FOR UPDATE;
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;

  IF v_booking.tour_instance_id <> v_instance_id THEN
    RETURN NULL;
  END IF;
  RETURN v_booking;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.lock_booking_with_instance(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.refund_reviewed_booking(p_booking_id uuid, p_actor_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking public.bookings;
  v_actor   text;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  IF p_actor_id IS NULL OR NOT public.is_panel_actor(p_actor_id) THEN
    RAISE EXCEPTION 'INVALID_ACTOR';
  END IF;

  v_booking := public.lock_booking_with_instance(p_booking_id);
  IF v_booking.id IS NULL
     OR v_booking.status <> 'confirmed'
     OR v_booking.operator_review_required_at IS NULL THEN
    RETURN 'not_under_review';
  END IF;

  v_actor := public.audit_actor_type(p_actor_id, 'staff');

  UPDATE public.bookings SET operator_review_required_at = NULL WHERE id = p_booking_id;

  -- Decisión del operador: reembolso del total. cancel_booking encola la cancelación con el monto.
  PERFORM public.cancel_booking(
    p_booking_id, v_actor, v_booking.total_amount_cents, 'operator_decision', 0, p_actor_id
  );

  INSERT INTO public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_actor, p_actor_id, 'booking.review_decided', 'booking', p_booking_id,
    jsonb_build_object('decision', 'refund', 'amount_cents', v_booking.total_amount_cents)
  );

  RETURN 'refunded';
END;
$$;

CREATE FUNCTION public.close_reviewed_booking_without_refund(p_booking_id uuid, p_actor_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking public.bookings;
  v_actor   text;
  v_seats   integer;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  IF p_actor_id IS NULL OR NOT public.is_panel_actor(p_actor_id) THEN
    RAISE EXCEPTION 'INVALID_ACTOR';
  END IF;

  v_booking := public.lock_booking_with_instance(p_booking_id);
  IF v_booking.id IS NULL
     OR v_booking.status <> 'confirmed'
     OR v_booking.operator_review_required_at IS NULL THEN
    RETURN 'not_under_review';
  END IF;

  v_actor := public.audit_actor_type(p_actor_id, 'staff');
  v_seats := v_booking.tickets_adult + v_booking.tickets_child + v_booking.tickets_student;

  UPDATE public.bookings
    SET operator_review_required_at = NULL, status = 'cancelled'
    WHERE id = p_booking_id;

  UPDATE public.tour_instances
    SET capacity_reserved = capacity_reserved - v_seats
    WHERE id = v_booking.tour_instance_id;

  UPDATE public.notifications
    SET status = 'cancelled', cancelled_reason = 'booking_cancelled'
    WHERE booking_id = p_booking_id AND kind = 'reminder_24h' AND status = 'pending';

  -- Sin reembolso: el correo de cancelación ya tiene esa variante ("no tiene reembolso").
  PERFORM public.enqueue_booking_notice(v_booking, 'cancellation_confirmation');

  INSERT INTO public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
  VALUES
    (
      v_actor, p_actor_id, 'booking.cancelled', 'booking', p_booking_id,
      jsonb_build_object('reason', 'operator_review', 'refund_amount_cents', 0, 'seats', v_seats)
    ),
    (
      v_actor, p_actor_id, 'booking.review_decided', 'booking', p_booking_id,
      jsonb_build_object('decision', 'no_refund')
    );

  RETURN 'closed';
END;
$$;

-- ================================================================
-- 6. reschedule_booking
-- ================================================================
CREATE FUNCTION public.reschedule_booking(
  p_booking_id         uuid,
  p_target_instance_id uuid,
  p_actor_id           uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source_id uuid;
  v_source    public.tour_instances;
  v_target    public.tour_instances;
  v_booking   public.bookings;
  v_seats     integer;
  v_held      integer;
  v_actor     text;
  v_in_review boolean;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  IF p_actor_id IS NULL OR NOT public.is_panel_actor(p_actor_id) THEN
    RAISE EXCEPTION 'INVALID_ACTOR';
  END IF;

  SELECT tour_instance_id INTO v_source_id FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  IF v_source_id = p_target_instance_id THEN
    RETURN 'same_instance';
  END IF;

  -- Las dos instancias en orden de id: dos cambios cruzados no se bloquean entre sí.
  PERFORM 1 FROM public.tour_instances
    WHERE id IN (v_source_id, p_target_instance_id)
    ORDER BY id
    FOR UPDATE;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;

  -- Se movió o cambió de estado entre la lectura y el lock.
  IF v_booking.tour_instance_id <> v_source_id OR v_booking.status <> 'confirmed' THEN
    RETURN 'not_confirmed';
  END IF;

  SELECT * INTO v_source FROM public.tour_instances WHERE id = v_source_id;
  SELECT * INTO v_target FROM public.tour_instances WHERE id = p_target_instance_id;

  IF NOT FOUND THEN
    RETURN 'target_unavailable';
  END IF;

  v_in_review := v_booking.operator_review_required_at IS NOT NULL;

  -- Una salida que ya empezó no se cambia (salvo una reserva en revisión, cuya salida se canceló).
  IF v_source.starts_at <= now() AND NOT v_in_review THEN
    RETURN 'source_started';
  END IF;

  IF v_target.tour_id <> v_source.tour_id THEN
    RETURN 'different_tour';
  END IF;

  IF v_target.status = 'cancelled' OR v_target.starts_at <= now() THEN
    RETURN 'target_unavailable';
  END IF;

  -- Mismo cupo que al apartar (create_hold_atomic, …036): capacidad menos cobrados menos holds
  -- vivos (`active` sin vencer y `paying`).
  v_seats := v_booking.tickets_adult + v_booking.tickets_child + v_booking.tickets_student;
  SELECT COALESCE(SUM(held_seats), 0) INTO v_held
    FROM public.tour_holds
    WHERE tour_instance_id = p_target_instance_id
      AND ((status = 'active' AND expires_at > now()) OR status = 'paying');

  IF v_target.capacity_total - v_target.capacity_reserved - v_held < v_seats THEN
    RETURN 'no_capacity';
  END IF;

  UPDATE public.tour_instances SET capacity_reserved = capacity_reserved - v_seats
    WHERE id = v_source_id;
  UPDATE public.tour_instances SET capacity_reserved = capacity_reserved + v_seats
    WHERE id = p_target_instance_id;

  -- El precio no cambia: es el mandato que el turista pagó (…043).
  UPDATE public.bookings
    SET tour_instance_id = p_target_instance_id,
        operator_review_required_at = NULL
    WHERE id = p_booking_id;

  -- Recordatorio: a la hora de la fecha nueva, aunque el anterior ya haya salido o se haya
  -- cancelado. Si la fecha nueva cae dentro de las 24 h, no hay recordatorio (…044, paso f).
  IF v_target.starts_at - interval '24 hours' > now() THEN
    IF btrim(v_booking.customer_email) <> '' THEN
      INSERT INTO public.notifications (booking_id, kind, recipient_email, locale, scheduled_for)
      VALUES (
        p_booking_id, 'reminder_24h', v_booking.customer_email, v_booking.locale,
        v_target.starts_at - interval '24 hours'
      )
      ON CONFLICT (booking_id, kind) DO UPDATE
        SET status = 'pending',
            scheduled_for = EXCLUDED.scheduled_for,
            attempts = 0,
            last_error = NULL,
            sent_at = NULL,
            cancelled_reason = NULL;
    END IF;
  ELSE
    UPDATE public.notifications
      SET status = 'cancelled', cancelled_reason = 'booking_rescheduled'
      WHERE booking_id = p_booking_id AND kind = 'reminder_24h' AND status = 'pending';
  END IF;

  PERFORM public.enqueue_booking_notice(v_booking, 'booking_rescheduled');

  v_actor := public.audit_actor_type(p_actor_id, 'staff');
  INSERT INTO public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_actor, p_actor_id, 'booking.rescheduled', 'booking', p_booking_id,
    jsonb_build_object(
      'from_instance_id', v_source_id,
      'to_instance_id', p_target_instance_id,
      'seats', v_seats,
      'from_review', v_in_review
    )
  );

  RETURN 'rescheduled';
END;
$$;

-- ================================================================
-- 7. Punto de encuentro fijo para quien ya reservó
-- ================================================================
CREATE FUNCTION public.reject_locked_meeting_point()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.bookings b
    JOIN public.tour_instances ti ON ti.id = b.tour_instance_id
    WHERE ti.tour_id = NEW.id
      AND ti.starts_at > now()
      AND b.status = 'confirmed'
  ) THEN
    RAISE EXCEPTION 'MEETING_POINT_LOCKED'
      USING HINT = 'El punto de encuentro no cambia con reservas confirmadas en salidas futuras (spec 0035)';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reject_locked_meeting_point()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tours_meeting_point_lock
  BEFORE UPDATE OF meeting_point_es, meeting_point_en ON public.tours
  FOR EACH ROW
  WHEN (
    OLD.meeting_point_es IS DISTINCT FROM NEW.meeting_point_es
    OR OLD.meeting_point_en IS DISTINCT FROM NEW.meeting_point_en
  )
  EXECUTE FUNCTION public.reject_locked_meeting_point();

-- ================================================================
-- 8. Devolución por transferencia o SINPE Móvil
-- ================================================================
CREATE FUNCTION public.request_refund_transfer(p_refund_id uuid, p_actor_id uuid)
RETURNS text
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

  IF p_actor_id IS NULL OR NOT public.is_panel_actor(p_actor_id) THEN
    RAISE EXCEPTION 'INVALID_ACTOR';
  END IF;

  SELECT * INTO v_refund FROM public.refunds WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REFUND_NOT_FOUND';
  END IF;

  IF v_refund.status <> 'failed' THEN
    RETURN 'not_failed';
  END IF;

  -- Con id externo, o con un resultado desconocido (REFUND_MANUAL_CHECK_REASONS), OnvoPay todavía
  -- puede acreditar a la tarjeta: transferir pagaría dos veces.
  IF v_refund.external_refund_id IS NOT NULL
     OR v_refund.failure_reason IN ('processing-stale', 'ambiguous-timeout') THEN
    RETURN 'provider_may_settle';
  END IF;

  -- Otro reembolso vivo de la misma reserva (un reintento): el índice parcial de …018 admite
  -- uno solo fuera de `failed`, y este pasaría a contar.
  IF EXISTS (
    SELECT 1 FROM public.refunds
    WHERE booking_id = v_refund.booking_id AND id <> p_refund_id AND status <> 'failed'
  ) THEN
    RETURN 'other_refund_active';
  END IF;

  UPDATE public.refunds
    SET status = 'awaiting_transfer',
        method = 'transfer',
        transfer_requested_at = now()
    WHERE id = p_refund_id;

  SELECT * INTO v_booking FROM public.bookings WHERE id = v_refund.booking_id;
  PERFORM public.enqueue_booking_notice(v_booking, 'refund_transfer_request');

  INSERT INTO public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    public.audit_actor_type(p_actor_id, 'staff'), p_actor_id,
    'refund.transfer_requested', 'booking', v_refund.booking_id,
    jsonb_build_object('refund_id', p_refund_id, 'amount_cents', v_refund.amount_cents)
  );

  RETURN 'requested';
END;
$$;

CREATE FUNCTION public.settle_refund_transfer(
  p_refund_id uuid,
  p_actor_id  uuid,
  p_channel   text,
  p_reference text,
  p_paid_at   timestamptz
)
RETURNS text
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

  IF p_actor_id IS NULL OR NOT public.is_panel_actor(p_actor_id) THEN
    RAISE EXCEPTION 'INVALID_ACTOR';
  END IF;

  IF p_channel IS NULL OR p_channel NOT IN ('sinpe_movil', 'bank_transfer') THEN
    RAISE EXCEPTION 'INVALID_CHANNEL';
  END IF;

  IF p_reference IS NULL OR btrim(p_reference) = '' THEN
    RAISE EXCEPTION 'INVALID_REFERENCE';
  END IF;

  IF p_paid_at IS NULL OR p_paid_at > now() THEN
    RAISE EXCEPTION 'INVALID_PAID_AT';
  END IF;

  SELECT * INTO v_refund FROM public.refunds WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REFUND_NOT_FOUND';
  END IF;

  IF v_refund.status <> 'awaiting_transfer' THEN
    RETURN 'not_awaiting_transfer';
  END IF;

  -- UPDATE propio: settle_refund (…036) solo cierra reembolsos `processing`.
  UPDATE public.refunds
    SET status = 'succeeded',
        transfer_channel = p_channel,
        transfer_reference = btrim(p_reference),
        transfer_paid_at = p_paid_at
    WHERE id = p_refund_id;
  UPDATE public.payments SET status = 'refunded' WHERE id = v_refund.payment_id;
  UPDATE public.bookings SET status = 'refunded'
    WHERE id = v_refund.booking_id AND status <> 'overbooked_refunded';

  SELECT * INTO v_booking FROM public.bookings WHERE id = v_refund.booking_id;
  PERFORM public.enqueue_booking_notice(v_booking, 'refund_confirmation');

  INSERT INTO public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    public.audit_actor_type(p_actor_id, 'staff'), p_actor_id,
    'refund.succeeded', 'booking', v_refund.booking_id,
    jsonb_build_object(
      'refund_id', p_refund_id,
      'amount_cents', v_refund.amount_cents,
      'currency', v_refund.currency,
      'method', 'transfer',
      'channel', p_channel
    )
  );

  RETURN 'settled';
END;
$$;

-- ================================================================
-- 9. Permisos: solo service_role
-- ================================================================
REVOKE EXECUTE ON FUNCTION public.cancel_departure(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_departure(uuid, text, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.resolve_immediate_minimum(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_immediate_minimum(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.keep_departure(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.keep_departure(uuid, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.refund_reviewed_booking(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_reviewed_booking(uuid, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.close_reviewed_booking_without_refund(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_reviewed_booking_without_refund(uuid, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.reschedule_booking(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_booking(uuid, uuid, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.request_refund_transfer(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_refund_transfer(uuid, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.settle_refund_transfer(uuid, uuid, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_refund_transfer(uuid, uuid, text, text, timestamptz)
  TO service_role;
