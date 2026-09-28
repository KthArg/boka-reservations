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
    CHECK (cancellation_reason IN ('minimum', 'weather', 'safety', 'force_majeure', 'other'));

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
  -- Lo que se transfirió de verdad: SINPE Móvil opera en colones y la reserva se cobró en dólares.
  ADD COLUMN transfer_amount_cents integer     NULL
    CONSTRAINT refunds_transfer_amount_check CHECK (transfer_amount_cents > 0),
  ADD COLUMN transfer_currency     text        NULL
    CONSTRAINT refunds_transfer_currency_check CHECK (transfer_currency IN ('USD', 'CRC')),
  ADD COLUMN transfer_requested_at timestamptz NULL,
  ADD COLUMN transfer_paid_at      timestamptz NULL;

-- Una transferencia pedida es de método transferencia y tiene fecha de pedido; una pagada tiene
-- canal, comprobante y fecha. Ninguna tarjeta lleva datos de transferencia.
ALTER TABLE public.refunds ADD CONSTRAINT refunds_transfer_coherence_check
  CHECK (
    (method = 'card'
      AND transfer_channel IS NULL AND transfer_reference IS NULL
      AND transfer_requested_at IS NULL AND transfer_paid_at IS NULL
      AND transfer_amount_cents IS NULL AND transfer_currency IS NULL
      AND status <> 'awaiting_transfer')
    OR (method = 'transfer'
      AND transfer_requested_at IS NOT NULL
      AND status IN ('awaiting_transfer', 'succeeded')
      AND (status = 'awaiting_transfer' OR (
        transfer_channel IS NOT NULL
        AND transfer_reference IS NOT NULL AND btrim(transfer_reference) <> ''
        AND transfer_paid_at IS NOT NULL
        AND transfer_amount_cents IS NOT NULL AND transfer_currency IS NOT NULL
      )))
  );

-- Un aviso que se vuelve a encolar sobre la misma fila (segundo cambio de fecha, salida cancelada
-- tras un cambio) sube la generación. El worker la usa en la clave de idempotencia del proveedor
-- de correo y como guarda al marcar el envío: sin ella, Resend devolvería el envío anterior (o un
-- 409) y un "sent" viejo pisaría el "pending" nuevo.
ALTER TABLE public.notifications
  ADD COLUMN generation integer NOT NULL DEFAULT 0
    CONSTRAINT notifications_generation_check CHECK (generation >= 0);

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
        provider = NULL,
        provider_message_id = NULL,
        recipient_email = EXCLUDED.recipient_email,
        locale = EXCLUDED.locale,
        generation = public.notifications.generation + 1;
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

  IF p_reason IS NULL OR p_reason NOT IN ('minimum', 'weather', 'safety', 'force_majeure', 'other') THEN
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
  -- 10 minutos de margen: el aviso lo manda el worker al minuto siguiente y tiene que llegar con
  -- 24 horas o más.
  IF p_reason = 'minimum' THEN
    IF v_instance.starts_at <= now() + interval '24 hours 10 minutes' THEN
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
      -- Una cancelación concurrente ya la cerró: no se cuenta ni se toca su aviso.
      IF public.cancel_booking(
        v_booking.id, v_actor, v_booking.total_amount_cents, 'operator_decision', 0, p_actor_id
      ) <> 'cancelled' THEN
        CONTINUE;
      END IF;
      -- Un solo aviso: el de salida cancelada, que ya dice el monto devuelto.
      UPDATE public.notifications
        SET status = 'cancelled', cancelled_reason = 'departure_cancelled'
        WHERE booking_id = v_booking.id
          AND kind = 'cancellation_confirmation'
          AND status = 'pending';
      v_refunded := v_refunded + 1;
    ELSE
      -- Clima, seguridad o fuerza mayor: el turista reservó bajo su propio riesgo (cláusula 7).
      -- Sin reembolso automático; el equipo decide cada reserva desde el panel.
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

  -- Pago en curso del cobro inmediato (el turista está en el widget): no se toca. Cancelarlo sin
  -- preguntarle a OnvoPay dejaría fuera del reconciliador un pago que quizá ya se acreditó. Si se
  -- acredita, confirm_booking ve la salida cancelada y lo reembolsa entero; si no, el reconciliador
  -- lo cierra como a cualquier pago abandonado.

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
      'unpaid_bookings', v_unpaid,
      -- Cobradas con un monto que no coincide: siguen su circuito manual, pero quedan a la vista.
      'mismatch_bookings', (
        SELECT count(*) FROM public.bookings
        WHERE tour_instance_id = p_instance_id AND status = 'payment_mismatch'
      )
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

  -- Ventana de 24 h 10 min a 25 h: el margen es para que el aviso salga antes del límite.
  IF v_instance.starts_at <= now() + interval '24 hours 10 minutes'
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
            cancelled_reason = NULL,
            provider = NULL,
            provider_message_id = NULL,
            recipient_email = EXCLUDED.recipient_email,
            locale = EXCLUDED.locale,
            generation = public.notifications.generation + 1;
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
-- SECURITY DEFINER: el UPDATE del tour llega con la sesión del admin, y el lock no puede depender
-- de lo que la RLS de bookings le deje ver (mismo motivo que set_booking_no_show_tolerance, …048).
CREATE FUNCTION public.reject_locked_meeting_point()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.bookings b
    JOIN public.tour_instances ti ON ti.id = b.tour_instance_id
    WHERE ti.tour_id = NEW.id
      AND ti.starts_at > now()
      -- Quien ya reservó vio el punto de encuentro, haya pagado o esté pagando.
      AND b.status IN ('confirmed', 'pending_minimum', 'pending_payment')
  ) THEN
    RAISE EXCEPTION 'MEETING_POINT_LOCKED'
      USING HINT = 'El punto de encuentro no cambia con reservas confirmadas en salidas futuras (spec 0035)';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reject_locked_meeting_point()
  FROM PUBLIC, anon, authenticated, service_role;

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

  -- Solo con el rechazo definitivo de OnvoPay: el reembolso existe allá (id externo) y el último
  -- estado fue `failed` (la tarjeta no lo acepta). Sin id, el POST pudo haberlo creado igual (un
  -- 5xx o un corte de red); con un resultado desconocido (REFUND_MANUAL_CHECK_REASONS y el
  -- timeout de la consulta) todavía puede acreditarse. En esos casos transferir pagaría dos veces.
  -- La excepción es `payment-intent-missing`: OnvoPay no encontró el pago, así que no pudo crear
  -- el reembolso.
  IF v_refund.failure_reason IS NULL
     OR v_refund.failure_reason IN ('processing-stale', 'ambiguous-timeout', 'processing-timeout')
     OR (v_refund.external_refund_id IS NULL
         AND v_refund.failure_reason <> 'payment-intent-missing') THEN
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
  p_refund_id    uuid,
  p_actor_id     uuid,
  p_channel      text,
  p_reference    text,
  p_paid_at      timestamptz,
  p_amount_cents integer,
  p_currency     text
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

  IF p_amount_cents IS NULL OR p_amount_cents <= 0
     OR p_currency IS NULL OR p_currency NOT IN ('USD', 'CRC') THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  SELECT * INTO v_refund FROM public.refunds WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REFUND_NOT_FOUND';
  END IF;

  IF v_refund.status <> 'awaiting_transfer' THEN
    RETURN 'not_awaiting_transfer';
  END IF;

  -- La transferencia no puede ser anterior al pedido (mismo día en hora de Costa Rica).
  IF (p_paid_at AT TIME ZONE 'America/Costa_Rica')::date
     < (v_refund.transfer_requested_at AT TIME ZONE 'America/Costa_Rica')::date THEN
    RAISE EXCEPTION 'INVALID_PAID_AT';
  END IF;

  -- En la moneda del cobro se devuelve exactamente lo reembolsado; en colones, el monto que se
  -- transfirió al tipo de cambio del día, que queda registrado.
  IF p_currency = v_refund.currency AND p_amount_cents <> v_refund.amount_cents THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  -- UPDATE propio: settle_refund (…036) solo cierra reembolsos `processing`.
  UPDATE public.refunds
    SET status = 'succeeded',
        transfer_channel = p_channel,
        transfer_reference = btrim(p_reference),
        transfer_paid_at = p_paid_at,
        transfer_amount_cents = p_amount_cents,
        transfer_currency = p_currency
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
      'channel', p_channel,
      'transfer_amount_cents', p_amount_cents,
      'transfer_currency', p_currency
    )
  );

  RETURN 'settled';
END;
$$;


-- ================================================================
-- 9. Motivo de cancelación en todos los caminos
-- ================================================================

-- Las salidas que cancelan otros caminos (resolve_departure_minimum de …047, archivar un tour)
-- también llevan motivo: el aviso al turista lo nombra. Si la salida vuelve a estar disponible
-- (restaurar un tour archivado), el motivo se limpia.
CREATE FUNCTION public.set_instance_cancellation_reason()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.status <> 'cancelled' THEN
    NEW.cancellation_reason := NULL;
    RETURN NEW;
  END IF;
  IF NEW.minimum_resolution IN ('auto_cancelled', 'staff_cancelled')
     AND OLD.minimum_resolution IS DISTINCT FROM NEW.minimum_resolution THEN
    NEW.cancellation_reason := 'minimum';
  ELSIF NEW.cancellation_reason IS NULL THEN
    NEW.cancellation_reason := 'other';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_instance_cancellation_reason()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER tour_instances_cancellation_reason
  BEFORE UPDATE ON public.tour_instances
  FOR EACH ROW EXECUTE FUNCTION public.set_instance_cancellation_reason();

UPDATE public.tour_instances
  SET cancellation_reason = CASE
    WHEN minimum_resolution IN ('auto_cancelled', 'staff_cancelled') THEN 'minimum'
    ELSE 'other'
  END
  WHERE status = 'cancelled';

ALTER TABLE public.tour_instances ADD CONSTRAINT tour_instances_cancellation_reason_status_check
  CHECK (cancellation_reason IS NULL OR status = 'cancelled');

-- ================================================================
-- 10. cancel_booking: la salida antes que la reserva, y la revisión explícita
-- ================================================================

CREATE OR REPLACE FUNCTION public.cancel_booking(
  p_booking_id          uuid,
  p_actor_type          text,
  p_refund_amount_cents integer,
  p_reason              text,
  p_fee_cents           integer,
  p_actor_id            uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_instance_id uuid;
  v_booking public.bookings;
  v_seats   integer;
  v_payment public.payments;
  v_refund_cents integer;
  v_fee_cents integer;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  IF p_reason IS NULL OR p_reason NOT IN ('customer_request', 'operator_decision') THEN
    RAISE EXCEPTION 'INVALID_REASON';
  END IF;

  -- Reembolsos completos (spec 0034): nunca se descuenta una comisión.
  IF p_fee_cents IS NULL OR p_fee_cents <> 0 THEN
    RAISE EXCEPTION 'INVALID_FEE';
  END IF;

  -- Primero la salida y después la reserva: el mismo orden que cancel_departure y
  -- reschedule_booking (…049). En el orden inverso, cancelar una reserva mientras se cancela su
  -- salida terminaba en un deadlock.
  SELECT tour_instance_id INTO v_instance_id FROM public.bookings WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  PERFORM 1 FROM public.tour_instances WHERE id = v_instance_id FOR UPDATE;
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;

  -- Se movió de salida entre la lectura y el lock: se bloquea también la nueva.
  IF v_booking.tour_instance_id <> v_instance_id THEN
    PERFORM 1 FROM public.tour_instances WHERE id = v_booking.tour_instance_id FOR UPDATE;
  END IF;

  -- Ya cancelada o nunca confirmada: el llamador lo informa en vez de mostrar un monto que no se
  -- aplicó (dos cancelaciones concurrentes).
  IF v_booking.status <> 'confirmed' THEN
    RETURN 'already_cancelled';
  END IF;

  -- Salida cancelada por clima o seguridad (…049): la decide el equipo con sus propias funciones,
  -- que limpian la marca antes de llegar acá.
  IF v_booking.operator_review_required_at IS NOT NULL THEN
    RETURN 'under_review';
  END IF;

  -- Invariantes de monto (después del chequeo de estado: una segunda cancelación sigue
  -- devolviendo 'already_cancelled'). La decisión del operador reembolsa el total, y el monto más
  -- la comisión nunca superan el total de la reserva.
  IF p_reason = 'operator_decision'
     AND p_refund_amount_cents <> v_booking.total_amount_cents THEN
    RAISE EXCEPTION 'INVALID_REFUND_AMOUNT';
  END IF;

  -- La cancelación del turista es todo o nada: el total con 24 h o más, cero con menos.
  IF p_reason = 'customer_request'
     AND p_refund_amount_cents NOT IN (0, v_booking.total_amount_cents) THEN
    RAISE EXCEPTION 'INVALID_REFUND_AMOUNT';
  END IF;

  IF p_refund_amount_cents < 0
     OR p_refund_amount_cents + p_fee_cents > v_booking.total_amount_cents THEN
    RAISE EXCEPTION 'INVALID_REFUND_AMOUNT';
  END IF;

  v_seats := v_booking.tickets_adult + v_booking.tickets_child + v_booking.tickets_student;

  UPDATE public.bookings SET status = 'cancelled' WHERE id = p_booking_id;

  UPDATE public.tour_instances
    SET capacity_reserved = capacity_reserved - v_seats
    WHERE id = v_booking.tour_instance_id;

  UPDATE public.notifications
    SET status = 'cancelled', cancelled_reason = 'booking_cancelled'
    WHERE booking_id = p_booking_id
      AND kind = 'reminder_24h'
      AND status = 'pending';

  INSERT INTO public.notifications (
    booking_id, kind, recipient_email, locale, scheduled_for
  )
  VALUES (
    p_booking_id, 'cancellation_confirmation',
    v_booking.customer_email, v_booking.locale, NOW()
  )
  ON CONFLICT (booking_id, kind) DO NOTHING;

  INSERT INTO public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_actor_type, p_actor_id, 'booking.cancelled', 'booking', p_booking_id,
    jsonb_build_object(
      'refund_amount_cents', p_refund_amount_cents,
      'seats', v_seats,
      'reason', p_reason,
      'fee_cents', p_fee_cents
    )
  );

  IF p_refund_amount_cents > 0 THEN
    SELECT * INTO v_payment
      FROM public.payments
      WHERE booking_id = p_booking_id AND status = 'succeeded'
      ORDER BY created_at DESC
      LIMIT 1;

    IF FOUND THEN
      -- Se encola el monto que dictó la política, capado a lo efectivamente cobrado (…042). Si
      -- el tope recorta el monto, la comisión guardada se recorta también, para que reembolso +
      -- comisión nunca superen lo cobrado.
      v_refund_cents := LEAST(p_refund_amount_cents, v_payment.amount_cents);
      v_fee_cents := LEAST(p_fee_cents, v_payment.amount_cents - v_refund_cents);

      INSERT INTO public.refunds (
        booking_id, payment_id, amount_cents, currency, reason, processing_fee_cents
      )
      VALUES (
        p_booking_id, v_payment.id, v_refund_cents, v_payment.currency,
        'requested_by_customer', v_fee_cents
      )
      ON CONFLICT (booking_id) WHERE status <> 'failed' DO NOTHING;

      INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
      VALUES (
        'system', 'refund.requested', 'booking', p_booking_id,
        jsonb_build_object(
          'amount_cents', v_refund_cents,
          'currency', v_payment.currency,
          'fee_cents', v_fee_cents
        )
      );
    ELSE
      INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
      VALUES (
        'system', 'refund.skipped_no_payment', 'booking', p_booking_id, '{}'
      );
    END IF;
  END IF;

  RETURN 'cancelled';
END;
$$;


-- ================================================================
-- 12. confirm_booking: un pago sobre una salida cancelada se reembolsa
-- ================================================================
-- Cuerpo de …044 con un solo bloque nuevo, antes del camino del pago tardío. Misma firma: los
-- grants de …044 se conservan.
CREATE OR REPLACE FUNCTION public.confirm_booking(
  p_booking_id          uuid,
  p_external_payment_id text,
  -- DEPRECATED (spec 0028): se ignora; los asientos se derivan de la reserva.
  p_total_seats         integer DEFAULT NULL,
  p_event_id            text DEFAULT NULL,
  p_paid_amount_cents   integer DEFAULT NULL,
  p_paid_currency       text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_instance_status text;
  v_booking           public.bookings;
  v_total_seats       integer;
  v_capacity_total    integer;
  v_capacity_reserved integer;
  v_payment           public.payments;
  v_expected          public.payments;
  v_unclaimed         boolean;
  v_paid_rows         integer;
  v_refund_rows       integer;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  -- Gate por evento (spec 0028): si el evento ya fue procesado, no-op ANTES de tocar
  -- nada. FOUND es true solo si el INSERT insertó una fila; en conflicto (evento
  -- repetido) es false. La fila vive en esta transacción: un rollback la deshace y el
  -- retry del proveedor reprocesa limpio (diseño de 0024, ahora gateando).
  IF p_event_id IS NOT NULL THEN
    INSERT INTO public.processed_webhook_events (id)
      VALUES (p_event_id)
      ON CONFLICT (id) DO NOTHING;
    IF NOT FOUND THEN
      RETURN 'already_processed';
    END IF;
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  -- Estados ya resueltos: no-op idempotente. Crítico porque el reconciliador llama SIN
  -- p_event_id: este gate por estado es su única idempotencia (espeja …036/…037).
  IF v_booking.status IN ('confirmed', 'refunded', 'overbooked_refunded') THEN
    -- (a) (spec 0029) Doble cobro: la fila de ESTE intent todavía no está succeeded/refunded,
    -- así que no fue el que resolvió la reserva. La plata entró: se asienta y se alerta. No se
    -- reembolsa solo: el modelo admite un refund activo por reserva (…018:47).
    UPDATE public.payments SET status = 'succeeded'
      WHERE booking_id = p_booking_id
        AND external_payment_id = p_external_payment_id
        AND status IN ('pending', 'failed')
      RETURNING * INTO v_payment;

    IF FOUND THEN
      INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
      VALUES (
        'system', 'booking.duplicate_payment', 'booking', p_booking_id,
        jsonb_build_object(
          'external_payment_id', p_external_payment_id,
          'amount_cents', v_payment.amount_cents,
          'currency', v_payment.currency,
          'booking_status', v_booking.status,
          'event_id', p_event_id
        )
      );
      RETURN 'duplicate_payment';
    END IF;

    RETURN 'already_processed';
  END IF;

  -- Mismatch pendiente de resolución manual: no tocar nada; el caller alerta.
  -- OJO: el gate por evento ya consumió p_event_id, así que un reenvío del MISMO
  -- evento devolverá 'already_processed' sin re-alertar. Es deliberado: la
  -- resolución del mismatch es manual (no llega por webhook); no lo "arregles"
  -- moviendo el gate después de este chequeo.
  IF v_booking.status = 'payment_mismatch' THEN
    RETURN 'ignored';
  END IF;

  -- Salida cancelada (spec 0035): el pago de una reserva que no se cobró todavía llega cuando la
  -- salida ya no sale. Se cancela la reserva y sigue por el camino del pago tardío, que la
  -- reembolsa entera. La salida se bloquea acá (y no más abajo) para que una cancelación de
  -- salida concurrente no quede en medio de la lectura y la confirmación.
  IF v_booking.status IN ('pending_payment', 'pending_minimum') THEN
    SELECT status INTO v_instance_status
      FROM public.tour_instances WHERE id = v_booking.tour_instance_id FOR UPDATE;
    IF v_instance_status = 'cancelled' THEN
      UPDATE public.bookings SET status = 'cancelled' WHERE id = p_booking_id;
      IF v_booking.hold_id IS NOT NULL THEN
        UPDATE public.tour_holds SET status = 'released'
          WHERE id = v_booking.hold_id AND status IN ('active', 'paying');
      END IF;
      INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
      VALUES (
        'system', 'booking.cancelled', 'booking', p_booking_id,
        jsonb_build_object('reason', 'departure_cancelled', 'refund_amount_cents', 0)
      );
      v_booking.status := 'cancelled';
    END IF;
  END IF;

  -- Pago tardío (spec 0028): la reserva ya fue cancelada (staleness del reconciliador, o una
  -- cancelación del flujo diferido que dejó el pago en `failed`) pero el cobro ocurrió
  -- después. El dinero NO puede quedar huérfano: refund total automático + audit.
  IF v_booking.status = 'cancelled' THEN
    -- Guard de mismatch también acá: jamás encolar un refund por un monto que no
    -- coincide con lo esperado ('ignored'; el pago queda como esté, revisión manual).
    IF p_paid_amount_cents IS NOT NULL AND p_paid_currency IS NOT NULL THEN
      SELECT * INTO v_expected
        FROM public.payments
        WHERE booking_id = p_booking_id AND external_payment_id = p_external_payment_id;
      IF FOUND AND (
        p_paid_amount_cents <> v_expected.amount_cents
        OR UPPER(p_paid_currency) <> UPPER(v_expected.currency)
      ) THEN
        RETURN 'ignored';
      END IF;
    END IF;

    -- Elegibilidad (fix del db-schema-guardian, review pre-PR de 0028): SOLO califica como
    -- "pago tardío" un pago que estaba 'pending' (webhook nunca llegó) o 'failed'
    -- (cancel_stale o una cancelación diferida lo marcó). Un pago ya 'succeeded'
    -- pertenece a una reserva que fue CONFIRMADA y luego cancelada por la vía normal:
    -- reembolsar acá violaría la política (<24h sin refund) o duplicaría un refund
    -- 'failed' en retry manual. Esos casos -> 'ignored' (el caller alerta).
    -- El turista pagó de verdad: el pago queda succeeded (espejo del camino overbooked;
    -- el refund necesita un pago succeeded que reembolsar y los reportes no deben ver
    -- un pago "refunded que nunca fue succeeded").
    UPDATE public.payments SET status = 'succeeded'
      WHERE booking_id = p_booking_id
        AND external_payment_id = p_external_payment_id
        AND status IN ('pending', 'failed')
      RETURNING * INTO v_payment;

    IF NOT FOUND THEN
      RETURN 'ignored';
    END IF;

    -- Refund total encolado en la MISMA transacción (patrón cancel_booking/…036). El
    -- índice único parcial refunds_one_active_per_booking garantiza a lo sumo un refund
    -- activo por reserva: reenvíos o carreras no duplican.
    INSERT INTO public.refunds (booking_id, payment_id, amount_cents, currency, reason)
    VALUES (
      p_booking_id, v_payment.id, v_payment.amount_cents, v_payment.currency,
      'late_payment'
    )
    ON CONFLICT (booking_id) WHERE status <> 'failed' DO NOTHING;
    GET DIAGNOSTICS v_refund_rows = ROW_COUNT;

    -- (b) (spec 0029) Acción propia cuando el refund no se encoló: una consulta forense por
    -- `action` no debe contar como reembolsado un cobro que no vuelve solo.
    INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
    VALUES (
      'system',
      CASE WHEN v_refund_rows > 0
        THEN 'booking.late_payment_refunded'
        ELSE 'booking.late_payment_refund_blocked'
      END,
      'booking', p_booking_id,
      jsonb_build_object(
        'refund_amount_cents', v_payment.amount_cents,
        'currency', v_payment.currency,
        'external_payment_id', p_external_payment_id,
        'event_id', p_event_id,
        'refund_enqueued', v_refund_rows > 0
      )
    );

    -- (b) (spec 0029) Sin refund encolado (ya había uno activo) el dinero de este cobro no
    -- vuelve solo: outcome propio para que el caller alerte con nivel error.
    IF v_refund_rows = 0 THEN
      RETURN 'late_payment_refund_blocked';
    END IF;

    RETURN 'late_payment_refunded';
  END IF;

  -- (c) (spec 0029) Gate positivo: nada de fall-through por "el CHECK agota los estados".
  IF v_booking.status NOT IN ('pending_payment', 'pending_minimum') THEN
    RETURN 'ignored';
  END IF;

  -- (d) (spec 0029) Diferida que nunca inició un cobro: el flujo se deduce de la reserva (SQL no
  -- ve el feature flag). Una pending_minimum CON charge_started_at liquidó tras un rechazo
  -- registrado (§8): es legítimo y no se marca.
  v_unclaimed := v_booking.charge_started_at IS NULL
    AND (v_booking.status = 'pending_minimum' OR v_booking.payment_method_id IS NOT NULL);

  -- Guard de mismatch (spec 0026): solo corre si el caller pasó monto/moneda pagados.
  IF p_paid_amount_cents IS NOT NULL AND p_paid_currency IS NOT NULL THEN
    -- (d) (spec 0029) En una diferida solo cuenta la fila `pending` del intent, igual que para
    -- confirmar: una fila ya cerrada no puede llevar la reserva a payment_mismatch.
    SELECT * INTO v_expected
      FROM public.payments
      WHERE booking_id = p_booking_id
        AND external_payment_id = p_external_payment_id
        AND (v_booking.payment_method_id IS NULL OR status = 'pending');

    IF FOUND AND (
      p_paid_amount_cents <> v_expected.amount_cents
      OR UPPER(p_paid_currency) <> UPPER(v_expected.currency)
    ) THEN
      UPDATE public.bookings
        SET status = 'payment_mismatch', charge_next_attempt_at = NULL
        WHERE id = p_booking_id;

      -- (e) (spec 0029) Sin "actualizá tu tarjeta" sobre una reserva en revisión manual.
      PERFORM public.cancel_pending_charge_notifications(p_booking_id, 'payment_mismatch');

      -- 0028: liberar el hold. Un mismatch retiene la fila `paying` para siempre si no
      -- se libera acá (ni release-expired-holds ni cancel_stale la tocan).
      IF v_booking.hold_id IS NOT NULL THEN
        UPDATE public.tour_holds SET status = 'released'
          WHERE id = v_booking.hold_id AND status IN ('active', 'paying');
      END IF;

      INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
      VALUES (
        'system', 'booking.payment_mismatch', 'booking', p_booking_id,
        jsonb_build_object(
          'expected_amount_cents', v_expected.amount_cents,
          'expected_currency', v_expected.currency,
          'paid_amount_cents', p_paid_amount_cents,
          'paid_currency', p_paid_currency,
          'source', 'confirm_booking',
          'unclaimed', v_unclaimed
        )
      );

      RETURN 'payment_mismatch';
    END IF;
  END IF;

  -- Asientos autoritativos (spec 0028): derivados de la propia reserva bajo lock.
  v_total_seats := COALESCE(v_booking.tickets_adult, 0)
                 + COALESCE(v_booking.tickets_child, 0)
                 + COALESCE(v_booking.tickets_student, 0);

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
  IF v_booking.payment_method_id IS NOT NULL THEN
    -- (d) (spec 0029) Diferida: solo la fila `pending` de este intent respalda la confirmación.
    -- Una fila `failed` (intent registrado como terminal) o ausente no confirma: revisión
    -- manual con 'ignored'.
    UPDATE public.payments SET status = 'succeeded'
      WHERE booking_id = p_booking_id
        AND external_payment_id = p_external_payment_id
        AND status = 'pending';
    GET DIAGNOSTICS v_paid_rows = ROW_COUNT;

    IF v_paid_rows = 0 THEN
      RETURN 'ignored';
    END IF;
  ELSE
    UPDATE public.payments SET status = 'succeeded'
      WHERE booking_id = p_booking_id AND external_payment_id = p_external_payment_id;
  END IF;

  -- Capa 2 — sobreventa (spec 0025): confirmar superaría capacity_total. NO se confirma;
  -- reserva terminal overbooked_refunded + refund total. No se incrementa capacity_reserved.
  IF v_capacity_reserved + v_total_seats > v_capacity_total THEN
    UPDATE public.bookings
      SET status = 'overbooked_refunded', charge_next_attempt_at = NULL
      WHERE id = p_booking_id;

    IF v_booking.hold_id IS NOT NULL THEN
      UPDATE public.tour_holds SET status = 'released' WHERE id = v_booking.hold_id;
    END IF;

    PERFORM public.cancel_pending_charge_notifications(p_booking_id, 'booking_overbooked');

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
        'seats', v_total_seats,
        'refund_amount_cents', COALESCE(v_payment.amount_cents, 0),
        'currency', COALESCE(v_payment.currency, v_booking.currency),
        'unclaimed', v_unclaimed
      )
    );

    INSERT INTO public.notifications (booking_id, kind, recipient_email, locale, scheduled_for)
    VALUES (
      p_booking_id, 'overbooked_refunded',
      v_booking.customer_email, v_booking.locale, NOW()
    )
    ON CONFLICT (booking_id, kind) DO NOTHING;

    RETURN 'overbooked_refunded';
  END IF;

  -- Camino feliz: hay cupo. Confirmar, ocupar cupo y (e) (spec 0029) limpiar la agenda de cobro.
  UPDATE public.bookings
    SET status = 'confirmed',
        charge_next_attempt_at = NULL,
        awaiting_action_until = NULL
    WHERE id = p_booking_id;

  UPDATE public.tour_instances
    SET capacity_reserved = capacity_reserved + v_total_seats
    WHERE id = v_booking.tour_instance_id;

  IF v_booking.hold_id IS NOT NULL THEN
    UPDATE public.tour_holds SET status = 'converted' WHERE id = v_booking.hold_id;
  END IF;

  PERFORM public.cancel_pending_charge_notifications(p_booking_id, 'booking_confirmed');

  -- 0028: el evento de dinero más importante deja traza forense.
  INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
  VALUES (
    'system', 'booking.confirmed', 'booking', p_booking_id,
    jsonb_build_object(
      'seats', v_total_seats,
      'external_payment_id', p_external_payment_id,
      'event_id', p_event_id,
      'deferred', v_booking.payment_method_id IS NOT NULL,
      'unclaimed', v_unclaimed
    )
  );

  INSERT INTO public.notifications (booking_id, kind, recipient_email, locale, scheduled_for)
  VALUES (
    p_booking_id, 'booking_confirmation',
    v_booking.customer_email, v_booking.locale, NOW()
  )
  ON CONFLICT (booking_id, kind) DO NOTHING;

  -- (f) (spec 0029) El recordatorio solo si todavía no pasó su hora: confirmar dentro de las
  -- 24 h previas ya no encola un recordatorio vencido que saldría de inmediato.
  INSERT INTO public.notifications (booking_id, kind, recipient_email, locale, scheduled_for)
  SELECT
    p_booking_id, 'reminder_24h',
    v_booking.customer_email, v_booking.locale,
    ti.starts_at - INTERVAL '24 hours'
  FROM public.tour_instances ti
  WHERE ti.id = v_booking.tour_instance_id
    AND ti.starts_at - INTERVAL '24 hours' > NOW()
  ON CONFLICT (booking_id, kind) DO NOTHING;

  RETURN CASE WHEN v_unclaimed THEN 'confirmed_unclaimed' ELSE 'confirmed' END;
END;
$$;

-- ================================================================
-- 11. Permisos: solo service_role
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

REVOKE EXECUTE ON FUNCTION public.settle_refund_transfer(uuid, uuid, text, text, timestamptz, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_refund_transfer(uuid, uuid, text, text, timestamptz, integer, text)
  TO service_role;
