-- Migration: cierre legal para el lanzamiento (spec 0031).
--
--   1. bookings.terms_accepted_at / terms_version: la aceptación de los términos se guarda aparte
--      del consentimiento de datos (consent_at / consent_version), con su propia versión. El
--      reglamento de la Ley 8968 (art. 2.f) exige que el consentimiento sobre los datos dentro de
--      un contrato sea una cláusula específica e independiente.
--   2. create_deferred_booking cambia de firma: recibe p_terms_version (después de
--      p_consent_version) y estampa terms_accepted_at con la misma hora que consent_at. Se borra
--      la firma de 17 parámetros de …044 y se crea la de 18, con sus permisos.
--   3. purge_stale_holds: nueva purga de reservas temporales de cupo terminales, sin reserva que
--      las referencie y sin cliente de OnvoPay pendiente de limpieza (art. 6.1).
--   4. purge_old_notifications: deja de borrar recordatorios pendientes cuyo envío todavía está
--      por venir (una reserva hecha con más de 90 días de anticipación perdía su recordatorio).
--
-- Reversibilidad:
--   (1) ALTER TABLE public.bookings DROP CONSTRAINT bookings_terms_pair_check, DROP COLUMN
--       terms_accepted_at, DROP COLUMN terms_version. NO revertir (1) una vez que haya reservas
--       con terms_* no nulos: se pierde la evidencia de qué términos aceptó cada turista.
--       Revertir solo (2)-(4).
--   (2) DROP FUNCTION de la firma de 18 parámetros y re-CREATE de la de 17 de …044 con sus
--       REVOKE/GRANT. Revertir …044 después de aplicar esta migración exige eliminar también la
--       firma de 18 parámetros.
--   (3) DROP FUNCTION public.purge_stale_holds(timestamptz). El worker la llama: revertir antes
--       el código, o apagar la retención con RETENTION_ENABLED=false.
--   (4) re-CREATE OR REPLACE del cuerpo de …034 (DELETE por created_at).

-- ADD COLUMN toma un ACCESS EXCLUSIVE breve sobre bookings: no quedar en cola detrás de una
-- consulta larga bloqueando a todo el que venga después.
SET lock_timeout = '5s';

-- ================================================================
-- 1. Columnas de aceptación de los términos
-- ================================================================

-- Nullables y sin default: las reservas previas no tienen el dato y no se rellenan. La fecha y
-- la versión van siempre juntas (valida al instante: hoy ambas son NULL en todas las filas).
ALTER TABLE public.bookings
  ADD COLUMN terms_accepted_at timestamptz NULL,
  ADD COLUMN terms_version     text        NULL,
  ADD CONSTRAINT bookings_terms_pair_check
    CHECK ((terms_version IS NULL) = (terms_accepted_at IS NULL));

-- ================================================================
-- 2. create_deferred_booking con versión de términos
-- ================================================================

DROP FUNCTION public.create_deferred_booking(
  uuid, text, text, text, text, integer, integer, integer, integer, text, text, text, text,
  text, text, smallint, smallint
);

CREATE FUNCTION public.create_deferred_booking(
  p_hold_id              uuid,
  p_session_token        text,
  p_customer_name        text,
  p_customer_email       text,
  p_locale               text,
  p_tickets_adult        integer,
  p_tickets_child        integer,
  p_tickets_student      integer,
  p_total_amount_cents   integer,
  p_currency             text,
  p_consent_version      text,
  p_terms_version        text,
  p_payment_method_id    text,
  p_customer_external_id text,
  p_card_brand           text,
  p_card_last4           text,
  p_card_exp_month       smallint,
  p_card_exp_year        smallint
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hold            public.tour_holds;
  v_starts_at       timestamptz;
  v_instance_status text;
  v_booking_id      uuid;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  IF p_consent_version IS NULL THEN
    RAISE EXCEPTION 'CONSENT_REQUIRED';
  END IF;

  IF p_terms_version IS NULL THEN
    RAISE EXCEPTION 'TERMS_REQUIRED';
  END IF;

  IF p_card_exp_month IS NULL OR p_card_exp_year IS NULL THEN
    RAISE EXCEPTION 'CARD_DATA_MISSING';
  END IF;

  IF NOT public.card_expiry_valid(p_card_exp_year, p_card_exp_month) THEN
    RAISE EXCEPTION 'CARD_DATA_INVALID';
  END IF;

  SELECT * INTO v_hold FROM public.tour_holds WHERE id = p_hold_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'HOLD_NOT_FOUND';
  END IF;

  IF v_hold.session_token IS DISTINCT FROM p_session_token THEN
    RAISE EXCEPTION 'HOLD_SESSION_MISMATCH';
  END IF;

  IF v_hold.status <> 'active' OR v_hold.expires_at <= now() THEN
    RAISE EXCEPTION 'HOLD_NOT_ACTIVE';
  END IF;

  -- El customer de la tarjeta tiene que ser el que el server creó para este hold (0029 §5.2).
  IF v_hold.customer_external_id IS DISTINCT FROM p_customer_external_id THEN
    RAISE EXCEPTION 'HOLD_CUSTOMER_MISMATCH';
  END IF;

  IF p_tickets_adult + p_tickets_child + p_tickets_student <> v_hold.held_seats THEN
    RAISE EXCEPTION 'HOLD_SEATS_MISMATCH';
  END IF;

  -- En el flujo diferido la tokenización ocurre entre el hold y la reserva (minutos, hasta el
  -- TTL del hold): la salida pudo cancelarse o archivarse en el medio. FOR SHARE la fija hasta el
  -- commit. `full` no se rechaza: el hold ya cuenta este asiento.
  SELECT starts_at, status INTO v_starts_at, v_instance_status
    FROM public.tour_instances WHERE id = v_hold.tour_instance_id
    FOR SHARE;

  IF v_instance_status = 'cancelled' THEN
    RAISE EXCEPTION 'INSTANCE_UNAVAILABLE';
  END IF;

  IF v_starts_at <= now() THEN
    RAISE EXCEPTION 'INSTANCE_PAST';
  END IF;

  IF public.card_expires_before_departure(p_card_exp_year, p_card_exp_month, v_starts_at) THEN
    RAISE EXCEPTION 'CARD_EXPIRES_BEFORE_DEPARTURE';
  END IF;

  -- now() es la hora de la transacción: consent_at y terms_accepted_at quedan idénticos.
  INSERT INTO public.bookings (
    tour_instance_id, hold_id, customer_name, customer_email, locale,
    tickets_adult, tickets_child, tickets_student, total_amount_cents, currency,
    status, consent_at, consent_version, terms_accepted_at, terms_version,
    payment_method_id, customer_external_id, card_brand, card_last4,
    card_exp_month, card_exp_year
  )
  VALUES (
    v_hold.tour_instance_id, v_hold.id, p_customer_name, p_customer_email, p_locale,
    p_tickets_adult, p_tickets_child, p_tickets_student, p_total_amount_cents, p_currency,
    'pending_minimum', now(), p_consent_version, now(), p_terms_version,
    p_payment_method_id, p_customer_external_id, p_card_brand, p_card_last4,
    p_card_exp_month, p_card_exp_year
  )
  RETURNING id INTO v_booking_id;

  UPDATE public.tour_holds SET status = 'paying' WHERE id = v_hold.id;

  INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
  VALUES (
    'tourist', 'booking.reserved', 'booking', v_booking_id,
    jsonb_build_object(
      'amount_cents', p_total_amount_cents,
      'currency', p_currency,
      'seats', v_hold.held_seats,
      'card_brand', p_card_brand,
      'card_last4', p_card_last4
    )
  );

  INSERT INTO public.notifications (booking_id, kind, recipient_email, locale, scheduled_for)
  VALUES (v_booking_id, 'booking_reserved', p_customer_email, p_locale, now())
  ON CONFLICT (booking_id, kind) DO NOTHING;

  RETURN v_booking_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_deferred_booking(
  uuid, text, text, text, text, integer, integer, integer, integer, text, text, text, text,
  text, text, text, smallint, smallint
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_deferred_booking(
  uuid, text, text, text, text, integer, integer, integer, integer, text, text, text, text,
  text, text, text, smallint, smallint
) TO service_role;

-- ================================================================
-- 3. purge_stale_holds
-- ================================================================

-- Un hold referenciado por una reserva se conserva mientras exista esa reserva, sea cual sea su
-- estado (la FK bookings.hold_id lo exige). Solo se borran holds terminales huérfanos. Incluir
-- `converted` es defensivo: hoy ningún camino deja un convertido sin referencia.
CREATE FUNCTION public.purge_stale_holds(p_cutoff timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  DELETE FROM public.tour_holds h
    WHERE h.status IN ('released', 'expired', 'converted')
      AND h.created_at < p_cutoff
      AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.hold_id = h.id)
      -- El customer de OnvoPay de un hold del flujo diferido se borra en OnvoPay antes que el
      -- hold: si todavía no se limpió, el id se necesita para hacerlo.
      AND (h.customer_external_id IS NULL OR h.customer_cleaned_at IS NOT NULL);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
  VALUES (
    'system', 'retention.purged_holds', 'retention_run', gen_random_uuid(),
    jsonb_build_object('affected_count', v_count, 'cutoff', p_cutoff)
  );

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_stale_holds(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_stale_holds(timestamptz) TO service_role;

-- ================================================================
-- 4. purge_old_notifications respeta los envíos futuros
-- ================================================================

-- Terminales: por antigüedad de creación. Pendientes: por fecha de envío programada, así un
-- recordatorio de una reserva hecha con mucha anticipación sobrevive hasta salir, y una fila que
-- nunca se enviará (p. ej. con NOTIFICATIONS_ENABLED=false) no queda para siempre.
CREATE OR REPLACE FUNCTION public.purge_old_notifications(p_cutoff timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  DELETE FROM public.notifications
    WHERE (status IN ('sent', 'failed', 'cancelled') AND created_at < p_cutoff)
       OR (status = 'pending' AND scheduled_for < p_cutoff);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
  VALUES (
    'system', 'retention.purged_notifications', 'retention_run', gen_random_uuid(),
    jsonb_build_object('affected_count', v_count, 'cutoff', p_cutoff)
  );

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_old_notifications(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_old_notifications(timestamptz) TO service_role;
