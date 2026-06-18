-- Migration: guard de identidad in-función en las funciones que mueven dinero.
-- Defensa en profundidad del hallazgo CRÍTICO de la 2da auditoría (spec 0018).
--
-- La migración 20260611000028 cerró el agujero revocando EXECUTE de anon/authenticated
-- (control PRIMARIO). Esta migración agrega una SEGUNDA barrera dentro de las funciones
-- SECURITY DEFINER que mueven dinero: aunque por error una migración futura les volviera
-- a otorgar EXECUTE a un rol público, la función rechaza la invocación si la request
-- viene de anon/authenticated.
--
-- Señal de identidad: el rol de la request lo deja PostgREST en el GUC de sesión
-- `request.jwt.claims` (verificado en vivo: anon -> "anon", service key -> "service_role",
-- usuario real -> "authenticated"). Ese GUC sobrevive dentro del contexto SECURITY DEFINER
-- (donde current_user es el OWNER, no el llamador), así que es el único dato confiable del
-- rol original. service_role y los contextos sin JWT (migraciones, seed, psql/superusuario)
-- pasan -> no se rompe ningún camino legítimo (la app llama todo con service_role).
--
-- Alcance: solo las 4 funciones que mueven dinero (confirm_booking, cancel_booking,
-- settle_refund, flag_payment_mismatch). create_hold_atomic / check_rate_limit /
-- cancel_stale_pending_booking quedan protegidas solo por el REVOKE de 028 (decisión
-- deliberada: no mueven dinero; ver spec 0018 §3).
--
-- Reversibilidad: forward-only. Los cuerpos son idénticos a las definiciones vigentes
-- (confirm_booking=…024, cancel_booking=…020, settle_refund=…019, flag_payment_mismatch=…025)
-- más la llamada al guard al inicio.

-- ----------------------------------------------------------------
-- Helper: ¿la request viene de un rol "público" (anon/authenticated) vía PostgREST?
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_public_request()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) IN ('anon', 'authenticated');
$$;

REVOKE EXECUTE ON FUNCTION public.is_public_request() FROM PUBLIC;

-- ----------------------------------------------------------------
-- confirm_booking: cuerpo vigente (…024, 4 args con idempotencia in-tx) + guard.
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
  v_booking public.bookings;
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
-- cancel_booking: cuerpo vigente (…020) + guard.
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
SET search_path = ''
AS $$
DECLARE
  v_booking public.bookings;
  v_seats   integer;
  v_payment public.payments;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  IF v_booking.status <> 'confirmed' THEN
    RETURN;
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
    jsonb_build_object('refund_amount_cents', p_refund_amount_cents, 'seats', v_seats)
  );

  IF p_refund_amount_cents > 0 THEN
    SELECT * INTO v_payment
      FROM public.payments
      WHERE booking_id = p_booking_id AND status = 'succeeded'
      ORDER BY created_at DESC
      LIMIT 1;

    IF FOUND THEN
      INSERT INTO public.refunds (booking_id, payment_id, amount_cents, currency, reason)
      VALUES (
        p_booking_id, v_payment.id, v_payment.amount_cents, v_payment.currency,
        'requested_by_customer'
      )
      ON CONFLICT (booking_id) WHERE status <> 'failed' DO NOTHING;

      INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
      VALUES (
        'system', 'refund.requested', 'booking', p_booking_id,
        jsonb_build_object('amount_cents', v_payment.amount_cents, 'currency', v_payment.currency)
      );
    ELSE
      INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
      VALUES (
        'system', 'refund.skipped_no_payment', 'booking', p_booking_id, '{}'
      );
    END IF;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_booking(uuid, text, integer, uuid)
  FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------
-- settle_refund: cuerpo vigente (…019) + guard.
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
  UPDATE public.bookings SET status = 'refunded'  WHERE id = v_refund.booking_id;

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
-- flag_payment_mismatch: cuerpo vigente (…025) + guard.
-- ----------------------------------------------------------------
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
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  IF v_booking.status <> 'pending_payment' THEN
    RETURN false;
  END IF;

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

REVOKE EXECUTE ON FUNCTION public.flag_payment_mismatch(uuid, integer, text, text)
  FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------
-- Auditoría de regresión (no enumerativa): lista las funciones SECURITY DEFINER del
-- esquema public que sigan siendo ejecutables por anon o authenticated. Debe ser SIEMPRE
-- vacía — todas las privilegiadas corren con service_role. A diferencia del test
-- enumerativo (lista fija de funciones), esto cubre funciones FUTURAS automáticamente: si
-- alguien crea una nueva SECURITY DEFINER sin revocar anon/authenticated (el patrón que
-- causó el bug), aparece acá y el test de integración falla. `has_function_privilege`
-- considera grants directos, default privileges y PUBLIC. Solo service_role la ejecuta.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.secdef_functions_public_executable()
RETURNS TABLE(function_name text, role_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.proname::text, r.rolname
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rolname)
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND pg_catalog.has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  ORDER BY 1, 2;
$$;

REVOKE EXECUTE ON FUNCTION public.secdef_functions_public_executable()
  FROM PUBLIC, anon, authenticated;
