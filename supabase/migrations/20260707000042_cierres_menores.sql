-- Migration: cierres menores del spec 0028 (workstream C, ítem C1).
-- Cierra hallazgos BAJOS del code review integral 2026-07-06:
--   1. cancel_booking auditaba p_refund_amount_cents pero encolaba v_payment.amount_cents:
--      idénticos hoy (política binaria), pero si mañana computeRefund devuelve un parcial,
--      el refund encolado seguiría siendo el TOTAL (sobre-reembolso silencioso). Ahora
--      encola LEAST(p_refund_amount_cents, v_payment.amount_cents): lo auditado es lo
--      encolado y JAMÁS más que lo cobrado.
--   2. TOCTOU de "último admin": countActiveAdmins + UPDATE en la app no eran atómicos
--      (dos desactivaciones concurrentes de los dos últimos admins → 0 admins, lockout en
--      un sistema invite-only). deactivate_internal_user serializa con FOR UPDATE.
--   3. La política users_delete_admin prometía un DELETE que las FKs NO ACTION
--      (audit_logs.actor_id, bookings.checked_in_by, tour_instance_guides.assigned_by)
--      hacen fallar en cuanto el usuario tiene actividad; la operación soportada es
--      DESACTIVAR. Se elimina la política (la versión vigente es la de …009).
--   4. processed_webhook_events era el único store operativo sin retención (crecía para
--      siempre). purge_old_webhook_events la incorpora al job apply-retention (90 días;
--      un evento solo protege la idempotencia mientras OnvoPay pueda reintentarlo).
--
-- Reversibilidad: (1) re-CREATE del cuerpo de cancel_booking de …029; (2) y (4) DROP
-- FUNCTION deactivate_internal_user / purge_old_webhook_events (la app debe volver al
-- UPDATE directo); (3) re-CREATE de la política users_delete_admin de …009.

-- ----------------------------------------------------------------
-- 1. cancel_booking: el refund encolado es el monto de la política, capado al pago.
--    Cuerpo vigente (…029) con el único cambio en el INSERT de refunds y su audit.
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
  v_refund_cents integer;
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
      -- 0028 (C1): se encola el monto que dictó la POLÍTICA (lo mismo que se auditó
      -- arriba), capado a lo efectivamente cobrado. Antes se encolaba el total del
      -- pago ignorando p_refund_amount_cents: un futuro refund parcial habría
      -- sobre-reembolsado en silencio.
      v_refund_cents := LEAST(p_refund_amount_cents, v_payment.amount_cents);

      INSERT INTO public.refunds (booking_id, payment_id, amount_cents, currency, reason)
      VALUES (
        p_booking_id, v_payment.id, v_refund_cents, v_payment.currency,
        'requested_by_customer'
      )
      ON CONFLICT (booking_id) WHERE status <> 'failed' DO NOTHING;

      INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
      VALUES (
        'system', 'refund.requested', 'booking', p_booking_id,
        jsonb_build_object('amount_cents', v_refund_cents, 'currency', v_payment.currency)
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
-- 2. Desactivación atómica anti-TOCTOU. El FOR UPDATE sobre los admins activos
--    serializa desactivaciones concurrentes: la segunda espera el commit de la
--    primera y re-evalúa el conteo. Devuelve false si el guard bloquea (último
--    admin) o el usuario ya estaba inactivo/no existe.
-- ----------------------------------------------------------------
CREATE FUNCTION public.deactivate_internal_user(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  -- Lock de todos los admins activos: el conteo de abajo queda serializado.
  PERFORM 1 FROM public.users WHERE role = 'admin' AND active FOR UPDATE;

  UPDATE public.users u
    SET active = false
    WHERE u.id = p_user_id
      AND u.active
      AND (
        u.role <> 'admin'
        OR (SELECT count(*) FROM public.users a WHERE a.role = 'admin' AND a.active) > 1
      );

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.deactivate_internal_user(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_internal_user(uuid) TO service_role;

-- ----------------------------------------------------------------
-- 3. La única operación soportada sobre usuarios es DESACTIVAR (documentado en la
--    UI y en el spec 0010); el DELETE real siempre falla por FKs con actividad.
-- ----------------------------------------------------------------
DROP POLICY IF EXISTS users_delete_admin ON public.users;

-- ----------------------------------------------------------------
-- 4. Retención de processed_webhook_events (la llama apply-retention, spec 0022/0028).
-- ----------------------------------------------------------------
CREATE FUNCTION public.purge_old_webhook_events(p_cutoff timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  DELETE FROM public.processed_webhook_events WHERE processed_at < p_cutoff;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_old_webhook_events(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_old_webhook_events(timestamptz) TO service_role;
