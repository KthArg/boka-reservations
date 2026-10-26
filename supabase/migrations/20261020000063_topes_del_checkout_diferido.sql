-- Migration: topes anti-acaparamiento del checkout diferido (spec 0048, Fase A)
--
-- Una reserva diferida retiene cupo sin vencimiento hasta el cobro, y para crearla alcanza una
-- tarjeta que exista (OnvoPay verifica la tarjeta, no los fondos). Sin tope, una sola persona
-- aparta una salida entera tokenizando la misma tarjeta con emails inventados (auditoría
-- 2026-10-18, PAYSEC-N1).
--
--   1. Índices parciales de la cohorte viva, por email normalizado y por huella de tarjeta.
--   2. deferred_cap_exceeded: helper interno. Serializa por identidad (advisory locks, email y
--      después tarjeta) y suma los cupos vivos.
--   3. create_deferred_booking: el tope antes del INSERT → DEFERRED_CAP_EXCEEDED.
--   4. update_booking_payment_method: el tope por tarjeta → outcome 'cap_exceeded'. Sin esto se
--      esquiva pasando la reserva a otra tarjeta y volviendo a reservar con la primera.
--   5. deferred_live_seats_for_email: chequeo temprano del paso 1 (solo lectura).
--   6. deferred_hoarding_candidates: salidas con los cupos concentrados en pocas identidades,
--      para la alerta del worker (solo lectura).
--
-- Cohorte viva: status pending_minimum o pending_payment con payment_method_id (la misma de
-- bookings_one_live_per_payment_method), de salidas futuras no canceladas. pending_payment cuenta
-- para no abrir un hueco durante el ciclo del cobro: si la autorización falla, la reserva vuelve a
-- pending_minimum y nunca dejó de contar.
--
-- Huella de tarjeta: últimos 4 + coalesce(marca, ''). OnvoPay no expone fingerprint. Sin el
-- vencimiento a propósito: lo escribe el turista al tokenizar, y si OnvoPay no lo valida con el
-- emisor, cambiarlo daría una huella nueva por cada vencimiento y anularía el tope (revisión de
-- pagos del 2026-10-20). Últimos 4 y marca no se pueden inventar. Colisiona más entre personas
-- distintas, pero para bloquear a alguien la otra identidad tiene que tener ya casi 10 cupos vivos.
-- card_brand es nullable: sin el coalesce, la huella daría NULL, pg_advisory_xact_lock (STRICT) no
-- tomaría el lock y la suma no encontraría nada.
--
-- Deadlocks: quien toma el advisory lock ya tiene sus locks de fila (tour_holds FOR UPDATE y
-- tour_instances FOR SHARE, o bookings FOR UPDATE en el cambio de tarjeta) y después solo lee o
-- inserta una fila nueva. Ninguna transacción que tenga un advisory lock espera un lock de fila de
-- otra. La única espera posible es la del índice único bookings_one_live_per_payment_method, ante
-- otra transacción sin confirmar con el mismo payment_method_id: esa tiene la misma tarjeta, así que
-- espera el mismo lock de tarjeta y no pueden estar las dos adentro a la vez. create_hold_atomic y reschedule_booking no toman advisory locks. Email y tarjeta usan
-- clases distintas, así que sus claves no se pisan y el orden email → tarjeta no se invierte.
--
-- Rollback, en este orden: primero re-crear create_deferred_booking desde …045 y
-- update_booking_payment_method desde …044 (CREATE OR REPLACE con el cuerpo original); después DROP
-- de las tres funciones nuevas y los dos índices. plpgsql no registra dependencias: con el orden
-- inverso el DROP pasa igual y el checkout se rompe en runtime.
--
-- Sin SET LOCAL lock_timeout: el CLI aplica las migraciones fuera de una transacción y la sentencia
-- no tiene efecto. Los CREATE INDEX toman SHARE sobre bookings un instante (la tabla es chica).

-- ================================================================
-- 1. Índices de la cohorte viva
-- ================================================================

CREATE INDEX bookings_live_deferred_email_idx
  ON public.bookings (lower(btrim(customer_email)))
  WHERE status IN ('pending_minimum', 'pending_payment') AND payment_method_id IS NOT NULL;

CREATE INDEX bookings_live_deferred_card_idx
  ON public.bookings (card_last4, coalesce(card_brand, ''))
  WHERE status IN ('pending_minimum', 'pending_payment') AND payment_method_id IS NOT NULL;

-- ================================================================
-- 2. deferred_cap_exceeded
-- ================================================================

-- p_email NULL o vacío: no se mira el email (cambio de tarjeta, o reserva sin correo).
-- p_exclude_booking: la propia reserva en el cambio de tarjeta, para no contarse dos veces.
CREATE FUNCTION public.deferred_cap_exceeded(
  p_email           text,
  p_card_last4      text,
  p_card_brand      text,
  p_seats           integer,
  p_exclude_booking uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- Espejo de shared/constants/bookings.ts → DEFERRED_MAX_LIVE_SEATS_PER_IDENTITY.
  c_max_seats   constant integer := 10;
  c_lock_email  constant integer := 48001;
  c_lock_card   constant integer := 48002;
  v_email       text := nullif(lower(btrim(p_email)), '');
  v_card_key    text := p_card_last4 || '|' || coalesce(p_card_brand, '');
  v_email_seats integer := 0;
  v_card_seats  integer := 0;
BEGIN
  -- Falla cerrado: sin últimos 4 la huella sería NULL y el tope por tarjeta, el que frena los
  -- alias de email, se saltearía sin aviso. La web ya lo exige; esta es la regla autoritativa.
  IF p_card_last4 IS NULL THEN
    RAISE EXCEPTION 'CARD_DATA_MISSING';
  END IF;

  IF v_email IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(c_lock_email, hashtext(v_email));
  END IF;
  PERFORM pg_advisory_xact_lock(c_lock_card, hashtext(v_card_key));

  IF v_email IS NOT NULL THEN
    SELECT COALESCE(SUM(b.tickets_adult + b.tickets_child + b.tickets_student), 0)::integer
      INTO v_email_seats
      FROM public.bookings b
      JOIN public.tour_instances ti ON ti.id = b.tour_instance_id
      WHERE b.status IN ('pending_minimum', 'pending_payment')
        AND b.payment_method_id IS NOT NULL
        AND lower(btrim(b.customer_email)) = v_email
        AND b.id IS DISTINCT FROM p_exclude_booking
        AND ti.starts_at > now()
        AND ti.status <> 'cancelled';
  END IF;

  SELECT COALESCE(SUM(b.tickets_adult + b.tickets_child + b.tickets_student), 0)::integer
      INTO v_card_seats
      FROM public.bookings b
      JOIN public.tour_instances ti ON ti.id = b.tour_instance_id
      WHERE b.status IN ('pending_minimum', 'pending_payment')
        AND b.payment_method_id IS NOT NULL
        AND b.card_last4 = p_card_last4
        AND coalesce(b.card_brand, '') = coalesce(p_card_brand, '')
        AND b.id IS DISTINCT FROM p_exclude_booking
        AND ti.starts_at > now()
        AND ti.status <> 'cancelled';

  RETURN v_email_seats + p_seats > c_max_seats OR v_card_seats + p_seats > c_max_seats;
END;
$$;

-- Interna: la llaman las funciones de abajo, que corren como su owner. Nadie más la ejecuta.
REVOKE EXECUTE ON FUNCTION public.deferred_cap_exceeded(
  text, text, text, integer, uuid
) FROM PUBLIC, anon, authenticated, service_role;

-- ================================================================
-- 3. create_deferred_booking con el tope
-- ================================================================

-- Mismo cuerpo que …045 más el tope, justo antes del INSERT. CREATE OR REPLACE conserva el ACL.
CREATE OR REPLACE FUNCTION public.create_deferred_booking(
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

  -- Spec 0048: tope de cupos vivos por email y por tarjeta, serializado por identidad.
  IF public.deferred_cap_exceeded(
    p_customer_email, p_card_last4, p_card_brand, v_hold.held_seats, NULL
  ) THEN
    RAISE EXCEPTION 'DEFERRED_CAP_EXCEEDED';
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

-- ================================================================
-- 4. update_booking_payment_method con el tope por tarjeta
-- ================================================================

-- Mismo cuerpo que …044 más el outcome 'cap_exceeded', después de las validaciones de la tarjeta
-- y antes del UPDATE. Solo la tarjeta: el email no cambia. CREATE OR REPLACE conserva el ACL.
-- Outcomes: 'updated' | 'not_updatable' | 'customer_mismatch' | 'update_limit_reached' |
--           'recovery_expired' | 'card_data_invalid' | 'card_expires_before_departure' |
--           'cap_exceeded'.
CREATE OR REPLACE FUNCTION public.update_booking_payment_method(
  p_booking_id           uuid,
  p_customer_external_id text,
  p_payment_method_id    text,
  p_card_brand           text,
  p_card_last4           text,
  p_card_exp_month       smallint,
  p_card_exp_year        smallint,
  p_consent_version      text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking   public.bookings;
  v_starts_at timestamptz;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  IF p_card_exp_month IS NULL OR p_card_exp_year IS NULL THEN
    RAISE EXCEPTION 'CARD_DATA_MISSING';
  END IF;

  -- Mandato de credencial almacenada para la tarjeta nueva: sin versión aceptada no se guarda.
  IF p_consent_version IS NULL THEN
    RAISE EXCEPTION 'CONSENT_REQUIRED';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  IF v_booking.status <> 'pending_minimum' THEN
    RETURN 'not_updatable';
  END IF;

  IF v_booking.customer_external_id IS DISTINCT FROM p_customer_external_id THEN
    RETURN 'customer_mismatch';
  END IF;

  -- Bajo el lock de la reserva: dos cambios concurrentes no pasan juntos el conteo.
  IF (
    SELECT count(*) FROM public.audit_logs
      WHERE entity_type = 'booking'
        AND entity_id = p_booking_id
        AND action = 'booking.payment_method_updated'
  ) >= 5 THEN
    RETURN 'update_limit_reached';
  END IF;

  IF v_booking.recovery_deadline IS NOT NULL AND v_booking.recovery_deadline <= now() THEN
    RETURN 'recovery_expired';
  END IF;

  IF NOT public.card_expiry_valid(p_card_exp_year, p_card_exp_month) THEN
    RETURN 'card_data_invalid';
  END IF;

  SELECT starts_at INTO v_starts_at
    FROM public.tour_instances WHERE id = v_booking.tour_instance_id;

  IF public.card_expires_before_departure(p_card_exp_year, p_card_exp_month, v_starts_at) THEN
    RETURN 'card_expires_before_departure';
  END IF;

  -- Spec 0048: la tarjeta nueva no puede pasar el tope de cupos vivos (sin contar esta reserva).
  IF public.deferred_cap_exceeded(
    NULL, p_card_last4, p_card_brand,
    v_booking.tickets_adult + v_booking.tickets_child + v_booking.tickets_student,
    p_booking_id
  ) THEN
    RETURN 'cap_exceeded';
  END IF;

  UPDATE public.bookings
    SET payment_method_id = p_payment_method_id,
        card_brand = p_card_brand,
        card_last4 = p_card_last4,
        card_exp_month = p_card_exp_month,
        card_exp_year = p_card_exp_year,
        charge_next_attempt_at = CASE
          WHEN v_booking.charge_attempts > 0
            THEN GREATEST(now(), v_booking.charge_started_at + interval '1 hour')
          ELSE v_booking.charge_next_attempt_at
        END
    WHERE id = p_booking_id;

  INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
  VALUES (
    'tourist', 'booking.payment_method_updated', 'booking', p_booking_id,
    jsonb_build_object(
      'previous_card_last4', v_booking.card_last4,
      'card_brand', p_card_brand,
      'card_last4', p_card_last4,
      'charge_attempts', v_booking.charge_attempts,
      'consent_version', p_consent_version,
      'consent_at', now()
    )
  );

  RETURN 'updated';
END;
$$;

-- ================================================================
-- 5. deferred_live_seats_for_email (chequeo temprano del paso 1)
-- ================================================================

CREATE FUNCTION public.deferred_live_seats_for_email(p_email text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(SUM(b.tickets_adult + b.tickets_child + b.tickets_student), 0)::integer
  FROM public.bookings b
  JOIN public.tour_instances ti ON ti.id = b.tour_instance_id
  WHERE nullif(lower(btrim(p_email)), '') IS NOT NULL
    AND b.status IN ('pending_minimum', 'pending_payment')
    AND b.payment_method_id IS NOT NULL
    AND lower(btrim(b.customer_email)) = lower(btrim(p_email))
    AND ti.starts_at > now()
    AND ti.status <> 'cancelled';
$$;

REVOKE EXECUTE ON FUNCTION public.deferred_live_seats_for_email(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deferred_live_seats_for_email(text) TO service_role;

-- ================================================================
-- 6. deferred_hoarding_candidates (alerta del worker)
-- ================================================================

-- Cohorte "diferida sin autorizar": pending_minimum, o pending_payment todavía sin autorización.
-- Una salida es candidata si esa cohorte ocupa al menos p_share de la capacidad y está en a lo
-- sumo p_max_identities emails distintos O a lo sumo p_max_identities tarjetas distintas (mismo
-- email con varias tarjetas, o misma tarjeta con varios emails).
CREATE FUNCTION public.deferred_hoarding_candidates(p_share numeric, p_max_identities integer)
RETURNS TABLE (
  instance_id     uuid,
  starts_at       timestamptz,
  tour_name       text,
  capacity        integer,
  held_seats      integer,
  distinct_emails integer,
  distinct_cards  integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    ti.id,
    ti.starts_at,
    t.name_es,
    ti.capacity_total,
    agg.seats,
    agg.emails,
    agg.cards
  FROM public.tour_instances ti
  JOIN public.tours t ON t.id = ti.tour_id
  JOIN LATERAL (
    SELECT
      SUM(b.tickets_adult + b.tickets_child + b.tickets_student)::integer AS seats,
      COUNT(DISTINCT nullif(lower(btrim(b.customer_email)), ''))::integer AS emails,
      COUNT(DISTINCT (b.card_last4, coalesce(b.card_brand, '')))::integer AS cards
    FROM public.bookings b
    WHERE b.tour_instance_id = ti.id
      AND b.payment_method_id IS NOT NULL
      AND (
        b.status = 'pending_minimum'
        OR (b.status = 'pending_payment' AND b.authorized_at IS NULL)
      )
  ) agg ON agg.seats IS NOT NULL
  WHERE ti.starts_at > now()
    AND ti.status <> 'cancelled'
    AND agg.seats >= p_share * ti.capacity_total
    AND (agg.emails <= p_max_identities OR agg.cards <= p_max_identities)
  ORDER BY ti.starts_at;
$$;

REVOKE EXECUTE ON FUNCTION public.deferred_hoarding_candidates(numeric, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deferred_hoarding_candidates(numeric, integer) TO service_role;
