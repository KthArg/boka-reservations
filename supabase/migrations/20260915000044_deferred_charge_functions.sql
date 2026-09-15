-- Migration: funciones del cobro diferido (spec 0029, workstream B).
--
-- Sobre el esquema de …043. Agrega las funciones que mueven una reserva diferida por su ciclo
-- de vida y cierra los caminos vigentes que asumían que toda reserva sin pagar era del flujo
-- con widget:
--   - create_deferred_booking: reserva pending_minimum + hold paying en UNA transacción (§5.2).
--   - charge_booking_start / charge_attempt_failed / charge_requires_action / close_pending_payment:
--     ciclo del cobro (§5.3, §5.6, §5.7). El HTTP a OnvoPay lo hace el caller; estas funciones
--     registran bajo lock, y las de resultado exigen el intent al que se refieren.
--   - cancel_charge_in_flight / cancel_unpaid_booking: cancelaciones sin cobro (§5.8).
--   - update_booking_payment_method: cambio de tarjeta tras un rechazo (§5.2, §5.7).
--   - mark_payment_provider_closed: cierre manual del intent desde el panel (§5.9).
--   - record_intent_closed / record_customer_cleaned: cierres del barrido de close-payment-intents,
--     auditados y bajo lock (§5.9; liberan la retención y borran datos en OnvoPay).
--   - confirm_booking: gate POSITIVO, outcomes confirmed_unclaimed / duplicate_payment /
--     late_payment_refund_blocked, y avisos de cobro cancelados al confirmar (§5.3, §5.6).
--   - flag_payment_mismatch: acepta pending_minimum (§5.3).
--   - cancel_stale_pending_booking: no toca un cobro diferido en vuelo (§5.4).
--   - anonymize_booking_pii_by_email / purge_unpaid_bookings: no borran reservas vivas ni
--     filas con un intent potencialmente abierto (§6, retención).
--
-- Constantes de negocio (spec 0029 §5.7), en SQL porque las aplica la función bajo lock:
--   piso del plazo de recuperación 6 h; margen mínimo para reintentar 2 h; backoff 1 h / 6 h /
--   24 h tras los fallos 1, 2 y 3; tres kinds de aviso de tarjeta rechazada. Desde el cuarto
--   fallo se reemplaza el aviso `_3` ya enviado por uno nuevo: cada rechazo se notifica (Q7) sin
--   tocar la unicidad (booking_id, kind). Contra card testing con el enlace de la reserva: una
--   hora mínima entre intentos de cobro (la aplica charge_booking_start para el worker y el
--   panel) y como mucho 5 cambios de tarjeta por reserva.
--
-- Hardening (patrón …029/…042): SECURITY DEFINER + search_path = '' + guard
-- is_public_request() + REVOKE EXECUTE de PUBLIC, anon, authenticated + GRANT a service_role.
-- Los helpers internos no son RPC: se les revoca EXECUTE también a service_role (…039 lo
-- otorga por default privilege); las funciones DEFINER los llaman como dueño.
--
-- Excede 150 líneas: excepción permitida para migraciones SQL (codebase-conventions).
--
-- Reversibilidad: forward-only. Revertir = DROP de las funciones nuevas y del índice, y re-CREATE
-- de los cuerpos de …040 (confirm_booking, flag_payment_mismatch), …036
-- (cancel_stale_pending_booking) y …034 (anonymize_booking_pii_by_email, purge_unpaid_bookings).
-- Con reservas diferidas vivas NO es seguro: …040 confirmaría pending_minimum sin cobro y …034
-- borraría reservas con intents abiertos; primero hay que cancelarlas y cerrar sus intents.
-- Revertir esta migración ANTES que …043: booking_retention_locked es LANGUAGE sql sin
-- BEGIN ATOMIC y Postgres no registra su dependencia con las columnas de …043.

-- ================================================================
-- 0. Helpers internos e índice
-- ================================================================

-- Una reserva no se borra (retención ni baja a pedido) mientras siga viva o pueda tener un
-- intent abierto en OnvoPay: borrarla haría que una liquidación tardía respondiera
-- payment_not_found (plata sin reserva ni refund). Los pagos `failed` sin cierre se acotan al
-- flujo diferido: los del flujo vigente no pasan por el barrido y quedarían retenidos siempre.
CREATE FUNCTION public.booking_retention_locked(p_booking public.bookings)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT
    p_booking.status = 'pending_minimum'
    OR (p_booking.status = 'pending_payment' AND p_booking.charge_started_at IS NOT NULL)
    OR EXISTS (
      SELECT 1 FROM public.payments p
      WHERE p.booking_id = p_booking.id AND p.status = 'pending'
    )
    OR (
      p_booking.payment_method_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.booking_id = p_booking.id
          AND p.status = 'failed'
          AND p.provider_closed_at IS NULL
      )
    );
$$;

REVOKE EXECUTE ON FUNCTION public.booking_retention_locked(public.bookings)
  FROM PUBLIC, anon, authenticated, service_role;

-- Plazo de recuperación tras el primer fallo (§5.7): el inicio de la ventana de decisión, o
-- now() + 6 h si eso es más tarde; nunca después del inicio de la salida. NULL si falta la
-- salida o la fila de business_settings: los callers lo convierten en error explícito.
CREATE FUNCTION public.compute_recovery_deadline(p_instance_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT LEAST(
    GREATEST(
      ti.starts_at - make_interval(hours => s.minimum_decision_window_hours),
      now() + interval '6 hours'
    ),
    ti.starts_at
  )
  FROM public.tour_instances ti
  CROSS JOIN public.business_settings s
  WHERE ti.id = p_instance_id AND s.id = 1;
$$;

REVOKE EXECUTE ON FUNCTION public.compute_recovery_deadline(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Datos de vencimiento plausibles: mes 1-12 y año de 4 dígitos. Se valida antes de construir la
-- fecha: un mes 13 haría fallar make_date con un error opaco y un año de 2 dígitos daría
-- "vence antes de la salida" con el mensaje equivocado.
CREATE FUNCTION public.card_expiry_valid(p_exp_year smallint, p_exp_month smallint)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_exp_month BETWEEN 1 AND 12 AND p_exp_year BETWEEN 2000 AND 2100;
$$;

REVOKE EXECUTE ON FUNCTION public.card_expiry_valid(smallint, smallint)
  FROM PUBLIC, anon, authenticated, service_role;

-- Tarjeta que vence antes de la salida (§5.2): vence el último día de su mes, y se compara
-- contra la FECHA de la salida en hora de Costa Rica. Llamar solo con datos ya validados.
CREATE FUNCTION public.card_expires_before_departure(
  p_exp_year  smallint,
  p_exp_month smallint,
  p_starts_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT (make_date(p_exp_year, p_exp_month, 1) + interval '1 month' - interval '1 day')::date
       < (p_starts_at AT TIME ZONE 'America/Costa_Rica')::date;
$$;

REVOKE EXECUTE ON FUNCTION public.card_expires_before_departure(smallint, smallint, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

-- actor_type de audit_logs para una acción del panel: el rol del usuario; sin actor, el
-- fallback que indique el caller ('tourist' o 'system').
CREATE FUNCTION public.audit_actor_type(p_actor_id uuid, p_fallback text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT CASE WHEN u.role = 'admin' THEN 'admin' ELSE 'staff' END
       FROM public.users u WHERE u.id = p_actor_id),
    p_fallback
  );
$$;

REVOKE EXECUTE ON FUNCTION public.audit_actor_type(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- Avisos del ciclo de cobro que ya no corresponden: al confirmar o cancelar la reserva no debe
-- salir un "tu tarjeta fue rechazada" ni un "reserva registrada sin cargo" (espejo de
-- cancel_booking con reminder_24h, …042).
CREATE FUNCTION public.cancel_pending_charge_notifications(p_booking_id uuid, p_reason text)
RETURNS void
LANGUAGE sql
SET search_path = ''
AS $$
  UPDATE public.notifications
    SET status = 'cancelled', cancelled_reason = p_reason
    WHERE booking_id = p_booking_id
      AND status = 'pending'
      AND kind IN (
        'booking_reserved',
        'charge_failed_action_required_1',
        'charge_failed_action_required_2',
        'charge_failed_action_required_3',
        'charge_requires_action'
      );
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_pending_charge_notifications(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- Cobros en vuelo por antigüedad (watch-charges): hoy alcanza bookings_status_idx, pero la
-- tabla solo crece y el filtro corre cada minuto.
CREATE INDEX bookings_charge_in_flight_idx
  ON public.bookings (charge_started_at)
  WHERE status = 'pending_payment' AND charge_started_at IS NOT NULL;

-- Un customer de OnvoPay por hold (§5.2). La limpieza de customers decide mirando solo las
-- reservas de SU hold: si un customer se reutilizara en otro hold, borrarlo rompería el cobro de
-- una reserva viva. El checkout crea uno nuevo por hold; esto lo fija como contrato.
CREATE UNIQUE INDEX tour_holds_one_per_customer
  ON public.tour_holds (customer_external_id)
  WHERE customer_external_id IS NOT NULL;

-- ================================================================
-- 1. create_deferred_booking (§5.2): reserva pending_minimum + hold active -> paying, atómico.
--    El monto lo calcula el server (spec 0015) y los datos de tarjeta los obtuvo el server con
--    GET /payment-methods; acá se vuelven a validar contra el hold y la salida bajo lock.
-- ================================================================
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

  -- El customer de la tarjeta tiene que ser el que el server creó para este hold (§5.2).
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

  INSERT INTO public.bookings (
    tour_instance_id, hold_id, customer_name, customer_email, locale,
    tickets_adult, tickets_child, tickets_student, total_amount_cents, currency,
    status, consent_at, consent_version,
    payment_method_id, customer_external_id, card_brand, card_last4,
    card_exp_month, card_exp_year
  )
  VALUES (
    v_hold.tour_instance_id, v_hold.id, p_customer_name, p_customer_email, p_locale,
    p_tickets_adult, p_tickets_child, p_tickets_student, p_total_amount_cents, p_currency,
    'pending_minimum', now(), p_consent_version,
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
  text, text, smallint, smallint
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_deferred_booking(
  uuid, text, text, text, text, integer, integer, integer, integer, text, text, text, text,
  text, text, smallint, smallint
) TO service_role;

-- ================================================================
-- 2. charge_booking_start (§5.3, §5.6): pending_minimum -> pending_payment.
--    El discriminador de intent nuevo es la fila `pending` de payments: sin ella se inserta
--    una con el intent recién creado; con ella se exige ese mismo intent. Monto y moneda salen
--    de la reserva (el mandato), nunca del caller. p_payment_method_id es la tarjeta con la que
--    el caller va a confirmar: si el turista la reemplazó en el medio, no se cobra la vieja.
--    El caller cancela el intent que haya creado ante CUALQUIER outcome distinto de 'started'.
--    Outcomes: 'started' | 'not_chargeable' | 'departure_unavailable' | 'recovery_expired' |
--              'retry_too_soon' | 'payment_method_changed' | 'intent_mismatch'.
-- ================================================================
CREATE FUNCTION public.charge_booking_start(
  p_booking_id          uuid,
  p_external_payment_id text,
  p_payment_method_id   text,
  p_actor_id            uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking         public.bookings;
  v_pending         public.payments;
  v_starts_at       timestamptz;
  v_instance_status text;
  v_reused          boolean;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  IF v_booking.status <> 'pending_minimum' THEN
    RETURN 'not_chargeable';
  END IF;

  IF v_booking.payment_method_id IS DISTINCT FROM p_payment_method_id THEN
    RETURN 'payment_method_changed';
  END IF;

  -- Orden de locks booking -> instancia, igual que confirm_booking.
  SELECT starts_at, status INTO v_starts_at, v_instance_status
    FROM public.tour_instances WHERE id = v_booking.tour_instance_id
    FOR SHARE;

  IF v_starts_at <= now() OR v_instance_status = 'cancelled' THEN
    RETURN 'departure_unavailable';
  END IF;

  -- Al vencer el plazo, cancelar tiene precedencia sobre intentar (§5.7).
  IF v_booking.recovery_deadline IS NOT NULL AND v_booking.recovery_deadline <= now() THEN
    RETURN 'recovery_expired';
  END IF;

  -- Una hora mínima entre intentos (§5.7), para el worker y para el cobro manual del panel: una
  -- tarjeta rechazada no se re-confirma sin pausa (las marcas lo penalizan) y el enlace de la
  -- reserva no sirve para probar tarjetas en ráfaga. También sostiene el gate por intent de
  -- charge_attempt_failed: las respuestas HTTP que lo llaman viven segundos (timeout de 15 s) y
  -- el watchdog espera 30 min, así que ninguna alcanza a un intento nuevo sobre el mismo intent.
  IF v_booking.charge_started_at IS NOT NULL
     AND v_booking.charge_started_at + interval '1 hour' > now() THEN
    RETURN 'retry_too_soon';
  END IF;

  SELECT * INTO v_pending
    FROM public.payments
    WHERE booking_id = p_booking_id AND status = 'pending'
    FOR UPDATE;
  v_reused := FOUND;

  IF v_reused THEN
    IF v_pending.external_payment_id IS DISTINCT FROM p_external_payment_id THEN
      RETURN 'intent_mismatch';
    END IF;
  ELSE
    INSERT INTO public.payments (booking_id, external_payment_id, amount_cents, currency)
    VALUES (
      p_booking_id, p_external_payment_id, v_booking.total_amount_cents, v_booking.currency
    );
  END IF;

  UPDATE public.bookings
    SET status = 'pending_payment',
        charge_started_at = now(),
        charge_next_attempt_at = NULL
    WHERE id = p_booking_id;

  INSERT INTO public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    public.audit_actor_type(p_actor_id, 'system'), p_actor_id,
    'charge.started', 'booking', p_booking_id,
    jsonb_build_object(
      'external_payment_id', p_external_payment_id,
      'attempt', v_booking.charge_attempts + 1,
      'intent_reused', v_reused
    )
  );

  RETURN 'started';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.charge_booking_start(uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.charge_booking_start(uuid, text, text, uuid) TO service_role;

-- ================================================================
-- 3. charge_attempt_failed (§5.7): rechazo del intent p_external_payment_id. Solo actúa si ESE
--    intent es el cobro en vuelo (su fila sigue `pending`): una respuesta vieja de un intento
--    anterior no puede cerrar ni retroceder el intento actual (§5.6, escrituras condicionales).
--    La reserva vuelve a pending_minimum, se agenda el reintento si hay margen y SIEMPRE se
--    avisa al turista. Con p_intent_terminal el caller ya comprobó por GET que el intent está
--    canceled/failed: el pago pasa a failed y cerrado.
-- ================================================================
CREATE FUNCTION public.charge_attempt_failed(
  p_booking_id          uuid,
  p_external_payment_id text,
  p_error_code          text,
  p_intent_terminal     boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking  public.bookings;
  v_pending  public.payments;
  v_attempts integer;
  v_deadline timestamptz;
  v_next     timestamptz;
  v_kind     text;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  IF v_booking.status <> 'pending_payment' OR v_booking.charge_started_at IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_pending
    FROM public.payments
    WHERE booking_id = p_booking_id
      AND external_payment_id = p_external_payment_id
      AND status = 'pending'
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_attempts := v_booking.charge_attempts + 1;
  v_deadline := COALESCE(
    v_booking.recovery_deadline,
    public.compute_recovery_deadline(v_booking.tour_instance_id)
  );

  IF v_deadline IS NULL THEN
    RAISE EXCEPTION 'RECOVERY_DEADLINE_UNAVAILABLE';
  END IF;

  -- Con margen (≥ 2 h hasta el plazo) se agenda el reintento de este fallo; sin margen, o tras
  -- el tercer fallo, no hay reintento automático (una tarjeta rechazada no se re-confirma sin
  -- pausa: las marcas lo penalizan).
  v_next := NULL;
  IF v_deadline - now() >= interval '2 hours' THEN
    v_next := CASE v_attempts
      WHEN 1 THEN now() + interval '1 hour'
      WHEN 2 THEN now() + interval '6 hours'
      WHEN 3 THEN now() + interval '24 hours'
      ELSE NULL
    END;
    IF v_next IS NOT NULL THEN
      v_next := LEAST(v_next, v_deadline);
    END IF;
  END IF;

  UPDATE public.bookings
    SET status = 'pending_minimum',
        charge_attempts = v_attempts,
        charge_last_error = p_error_code,
        recovery_deadline = v_deadline,
        charge_next_attempt_at = v_next,
        awaiting_action_until = NULL
    WHERE id = p_booking_id;

  IF p_intent_terminal THEN
    UPDATE public.payments
      SET status = 'failed', failed_at = now(), provider_closed_at = now()
      WHERE id = v_pending.id;
  END IF;

  -- Aviso con enlace (Q7: todo cobro fallido se notifica). Desde el cuarto fallo se reutiliza el
  -- kind `_3`: se reemplaza la fila ya procesada por una nueva, así el envío lleva un id nuevo
  -- (clave de idempotencia del proveedor de email) y la unicidad (booking_id, kind) no cambia.
  v_kind := 'charge_failed_action_required_' || LEAST(v_attempts, 3);
  IF v_attempts > 3 THEN
    DELETE FROM public.notifications
      WHERE booking_id = p_booking_id AND kind = v_kind AND status <> 'pending';
  END IF;

  INSERT INTO public.notifications (booking_id, kind, recipient_email, locale, scheduled_for)
  VALUES (p_booking_id, v_kind, v_booking.customer_email, v_booking.locale, now())
  ON CONFLICT (booking_id, kind) DO NOTHING;

  INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
  VALUES (
    'system', 'charge.failed', 'booking', p_booking_id,
    jsonb_build_object(
      'attempt', v_attempts,
      'external_payment_id', p_external_payment_id,
      'error_code', p_error_code,
      'intent_terminal', p_intent_terminal,
      'recovery_deadline', v_deadline,
      'next_attempt_at', v_next
    )
  );

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.charge_attempt_failed(uuid, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.charge_attempt_failed(uuid, text, text, boolean)
  TO service_role;

-- ================================================================
-- 4. charge_requires_action (§5.7): el banco pidió 3DS para el intent p_external_payment_id.
--    Mismo gate por intent que charge_attempt_failed. El plazo nunca queda nulo tras esta
--    llamada (sin margen se fija igual), así el watchdog cancela al vencer y no reentra.
--    Idempotente: si el plazo ya estaba registrado devuelve false.
-- ================================================================
CREATE FUNCTION public.charge_requires_action(
  p_booking_id          uuid,
  p_external_payment_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking  public.bookings;
  v_deadline timestamptz;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  IF v_booking.status <> 'pending_payment'
     OR v_booking.charge_started_at IS NULL
     OR v_booking.awaiting_action_until IS NOT NULL THEN
    RETURN false;
  END IF;

  PERFORM 1
    FROM public.payments
    WHERE booking_id = p_booking_id
      AND external_payment_id = p_external_payment_id
      AND status = 'pending';

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_deadline := COALESCE(
    v_booking.recovery_deadline,
    public.compute_recovery_deadline(v_booking.tour_instance_id)
  );

  IF v_deadline IS NULL THEN
    RAISE EXCEPTION 'RECOVERY_DEADLINE_UNAVAILABLE';
  END IF;

  UPDATE public.bookings
    SET awaiting_action_until = v_deadline,
        recovery_deadline = v_deadline
    WHERE id = p_booking_id;

  INSERT INTO public.notifications (booking_id, kind, recipient_email, locale, scheduled_for)
  VALUES (
    p_booking_id, 'charge_requires_action',
    v_booking.customer_email, v_booking.locale, now()
  )
  ON CONFLICT (booking_id, kind) DO NOTHING;

  INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
  VALUES (
    'system', 'charge.requires_action', 'booking', p_booking_id,
    jsonb_build_object(
      'external_payment_id', p_external_payment_id,
      'awaiting_action_until', v_deadline
    )
  );

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.charge_requires_action(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.charge_requires_action(uuid, text) TO service_role;

-- ================================================================
-- 5. close_pending_payment (§5.6): libera la fila `pending` de una reserva sin cobrar cuyo
--    intent terminó fuera de un cobro en vuelo (lo canceló el caller antes de crear otro, el
--    staff desde el dashboard, o OnvoPay). Sin esto charge_booking_start devolvería
--    intent_mismatch para siempre. Contrato: el caller comprobó por GET que el intent está
--    canceled o failed.
-- ================================================================
CREATE FUNCTION public.close_pending_payment(
  p_booking_id          uuid,
  p_external_payment_id text
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

  IF v_booking.status <> 'pending_minimum' THEN
    RETURN false;
  END IF;

  UPDATE public.payments
    SET status = 'failed', failed_at = now(), provider_closed_at = now()
    WHERE booking_id = p_booking_id
      AND external_payment_id = p_external_payment_id
      AND status = 'pending'
    RETURNING * INTO v_payment;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
  VALUES (
    'system', 'charge.intent_closed', 'booking', p_booking_id,
    jsonb_build_object('external_payment_id', p_external_payment_id, 'payment_id', v_payment.id)
  );

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.close_pending_payment(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_pending_payment(uuid, text) TO service_role;

-- ================================================================
-- 6. cancel_charge_in_flight (§5.7, §5.9): la única vía, junto con cancel_departure (C), para
--    cancelar una pending_payment con cobro iniciado. Solo si el plazo que invoca venció.
--    Razones: 'action_expired' | 'recovery_expired' | 'departure_started'.
-- ================================================================
CREATE FUNCTION public.cancel_charge_in_flight(p_booking_id uuid, p_reason text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking   public.bookings;
  v_starts_at timestamptz;
  v_due       boolean;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  IF p_reason NOT IN ('action_expired', 'recovery_expired', 'departure_started') THEN
    RAISE EXCEPTION 'INVALID_CANCEL_REASON';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  IF v_booking.status <> 'pending_payment' OR v_booking.charge_started_at IS NULL THEN
    RETURN false;
  END IF;

  SELECT starts_at INTO v_starts_at
    FROM public.tour_instances WHERE id = v_booking.tour_instance_id;

  -- Frontera `<=` en todos los plazos, igual que charge_booking_start: el plazo vence en su
  -- instante exacto.
  v_due := CASE p_reason
    WHEN 'action_expired' THEN v_booking.awaiting_action_until <= now()
    WHEN 'recovery_expired' THEN v_booking.recovery_deadline <= now()
    ELSE v_starts_at <= now()
  END;

  IF v_due IS NOT TRUE THEN
    RETURN false;
  END IF;

  UPDATE public.bookings
    SET status = 'cancelled', charge_next_attempt_at = NULL
    WHERE id = p_booking_id;

  UPDATE public.payments
    SET status = 'failed', failed_at = now()
    WHERE booking_id = p_booking_id AND status = 'pending';

  IF v_booking.hold_id IS NOT NULL THEN
    UPDATE public.tour_holds SET status = 'released'
      WHERE id = v_booking.hold_id AND status IN ('active', 'paying');
  END IF;

  PERFORM public.cancel_pending_charge_notifications(p_booking_id, 'booking_cancelled');

  INSERT INTO public.notifications (booking_id, kind, recipient_email, locale, scheduled_for)
  VALUES (
    p_booking_id, 'cancellation_confirmation',
    v_booking.customer_email, v_booking.locale, now()
  )
  ON CONFLICT (booking_id, kind) DO NOTHING;

  INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
  VALUES (
    'system', 'booking.charge_cancelled', 'booking', p_booking_id,
    jsonb_build_object('reason', p_reason, 'charge_attempts', v_booking.charge_attempts)
  );

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_charge_in_flight(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_charge_in_flight(uuid, text) TO service_role;

-- ================================================================
-- 7. cancel_unpaid_booking (§5.8): cancela una pending_minimum (turista, panel o red terminal
--    del worker). Hold liberado, pago pendiente a failed, capacity_reserved sin cambio (nunca
--    se incrementó). Rechaza un cobro en vuelo: la UI pide reintentar en unos minutos.
--    Razones: 'customer_request' | 'staff_request' | 'recovery_expired' | 'departure_started'.
--    Outcomes: 'cancelled' | 'charge_in_flight' | 'not_cancellable'.
-- ================================================================
CREATE FUNCTION public.cancel_unpaid_booking(
  p_booking_id uuid,
  p_actor_id   uuid,
  p_reason     text
)
RETURNS text
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

  -- La razón decide el actor_type auditado: lista cerrada.
  IF p_reason NOT IN ('customer_request', 'staff_request', 'recovery_expired', 'departure_started') THEN
    RAISE EXCEPTION 'INVALID_CANCEL_REASON';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  IF v_booking.status = 'pending_payment' AND v_booking.charge_started_at IS NOT NULL THEN
    RETURN 'charge_in_flight';
  END IF;

  IF v_booking.status <> 'pending_minimum' THEN
    RETURN 'not_cancellable';
  END IF;

  UPDATE public.bookings
    SET status = 'cancelled', charge_next_attempt_at = NULL
    WHERE id = p_booking_id;

  UPDATE public.payments
    SET status = 'failed', failed_at = now()
    WHERE booking_id = p_booking_id AND status = 'pending';

  IF v_booking.hold_id IS NOT NULL THEN
    UPDATE public.tour_holds SET status = 'released'
      WHERE id = v_booking.hold_id AND status IN ('active', 'paying');
  END IF;

  PERFORM public.cancel_pending_charge_notifications(p_booking_id, 'booking_cancelled');

  INSERT INTO public.notifications (booking_id, kind, recipient_email, locale, scheduled_for)
  VALUES (
    p_booking_id, 'cancellation_confirmation',
    v_booking.customer_email, v_booking.locale, now()
  )
  ON CONFLICT (booking_id, kind) DO NOTHING;

  -- Sin actor: el turista si la pidió él; si no, el sistema (red terminal del worker).
  INSERT INTO public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    public.audit_actor_type(
      p_actor_id,
      CASE WHEN p_reason = 'customer_request' THEN 'tourist' ELSE 'system' END
    ),
    p_actor_id, 'booking.cancelled', 'booking', p_booking_id,
    jsonb_build_object('reason', p_reason, 'deferred', true, 'refund_amount_cents', 0)
  );

  RETURN 'cancelled';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_unpaid_booking(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_unpaid_booking(uuid, uuid, text) TO service_role;

-- ================================================================
-- 8. update_booking_payment_method (§5.2, §5.7): el turista cambia la tarjeta de una reserva
--    sin cobrar. El caller verificó por GET los datos de la tarjeta y hace el detach del
--    método reemplazado; acá se vuelve a exigir el customer de la reserva bajo lock. Con fallos
--    previos agenda un intento, como mucho uno por hora. Contra card testing con el enlace de la
--    reserva, además, un tope de 5 cambios por reserva contados en audit_logs (append-only, no se
--    puede reiniciar). El índice único de …043 rechaza una tarjeta de otra reserva viva. Exige la
--    versión del mandato que el turista aceptó para la tarjeta nueva y la deja auditada (spec 0021).
--    Outcomes: 'updated' | 'not_updatable' | 'customer_mismatch' | 'update_limit_reached' |
--              'recovery_expired' | 'card_data_invalid' | 'card_expires_before_departure'.
-- ================================================================
CREATE FUNCTION public.update_booking_payment_method(
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

REVOKE EXECUTE ON FUNCTION public.update_booking_payment_method(
  uuid, text, text, text, text, smallint, smallint, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_booking_payment_method(
  uuid, text, text, text, text, smallint, smallint, text
) TO service_role;

-- ================================================================
-- 9. mark_payment_provider_closed (§5.9): tras 7 días sin cierre automático, el staff verifica
--    el intent en el dashboard de OnvoPay y lo registra a mano. Es la otra única forma de
--    liberar la exclusión de retención: los gates (reserva cancelada, pago failed con 7 días)
--    viven acá y no en la UI. Queda auditada con actor.
-- ================================================================
CREATE FUNCTION public.mark_payment_provider_closed(p_payment_id uuid, p_actor_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_payment public.payments;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'ACTOR_REQUIRED';
  END IF;

  UPDATE public.payments p
    SET provider_closed_at = now()
    FROM public.bookings b
    WHERE p.id = p_payment_id
      AND b.id = p.booking_id
      AND b.status = 'cancelled'
      AND p.status = 'failed'
      AND p.provider_closed_at IS NULL
      AND p.failed_at IS NOT NULL
      AND p.failed_at <= now() - interval '7 days'
    RETURNING p.* INTO v_payment;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    public.audit_actor_type(p_actor_id, 'staff'), p_actor_id,
    'payment.provider_closed_manually', 'booking', v_payment.booking_id,
    jsonb_build_object(
      'payment_id', v_payment.id,
      'external_payment_id', v_payment.external_payment_id
    )
  );

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_payment_provider_closed(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_payment_provider_closed(uuid, uuid) TO service_role;

-- ================================================================
-- 9b. record_intent_closed (§5.9): close-payment-intents registra el cierre que comprobó por GET.
--     Mismo alcance que el barrido (reserva diferida cancelada, pago sin cierre), bajo el lock de
--     la reserva y auditado: este cierre libera la retención y habilita la purga, así que tiene
--     que quedar quién lo comprobó y con qué estado. Una fila `pending` (anómala: toda
--     cancelación la pasa a failed) queda además failed con su failed_at.
--     p_intent_status: 'canceled' | 'failed' | 'not_found' (el GET devolvió 404).
-- ================================================================
CREATE FUNCTION public.record_intent_closed(p_payment_id uuid, p_intent_status text)
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

  IF p_intent_status IS NULL OR p_intent_status NOT IN ('canceled', 'failed', 'not_found') THEN
    RAISE EXCEPTION 'INVALID_INTENT_STATUS';
  END IF;

  SELECT b.* INTO v_booking
    FROM public.bookings b
    JOIN public.payments p ON p.booking_id = b.id
    WHERE p.id = p_payment_id
    FOR UPDATE OF b;

  IF NOT FOUND OR v_booking.status <> 'cancelled' OR v_booking.payment_method_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;

  IF v_payment.status NOT IN ('pending', 'failed') OR v_payment.provider_closed_at IS NOT NULL THEN
    RETURN false;
  END IF;

  UPDATE public.payments
    SET status = 'failed',
        failed_at = COALESCE(failed_at, now()),
        provider_closed_at = now()
    WHERE id = p_payment_id;

  INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
  VALUES (
    'system', 'charge.intent_closed', 'booking', v_booking.id,
    jsonb_build_object(
      'payment_id', v_payment.id,
      'external_payment_id', v_payment.external_payment_id,
      'previous_status', v_payment.status,
      'intent_status', p_intent_status,
      'source', 'close-payment-intents'
    )
  );

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_intent_closed(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_intent_closed(uuid, text) TO service_role;

-- ================================================================
-- 9c. record_customer_cleaned (§5.2, §5.9; Ley 8968): marca el hold cuyo customer se borró en
--     OnvoPay. El caller ya hizo el detach de sus métodos y el DELETE; la marca y la auditoría
--     van juntas para que el borrado de datos del turista deje evidencia.
-- ================================================================
CREATE FUNCTION public.record_customer_cleaned(p_hold_id uuid, p_detached_count integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  UPDATE public.tour_holds
    SET customer_cleaned_at = now()
    WHERE id = p_hold_id
      AND customer_external_id IS NOT NULL
      AND customer_cleaned_at IS NULL;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
  VALUES (
    'system', 'customer.provider_deleted', 'tour_hold', p_hold_id,
    jsonb_build_object('detached_payment_methods', COALESCE(p_detached_count, 0))
  );

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_customer_cleaned(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_customer_cleaned(uuid, integer) TO service_role;

-- ================================================================
-- 10. confirm_booking (§5.3, §5.6): cuerpo de …040 con estos cambios, marcados abajo con
--     "(spec 0029)":
--    a) Estados resueltos: un intent distinto del que resolvió la reserva y que liquida después
--       es un DOBLE COBRO. Se asienta el pago y se devuelve 'duplicate_payment' (auditado); los
--       callers alertan con nivel error. Una re-entrega del mismo intent sigue siendo
--       'already_processed'.
--    b) Pago tardío: si el refund no se pudo encolar (otro refund activo), 'late_payment_refund_
--       blocked' en lugar de un 'late_payment_refunded' falso.
--    c) Gate POSITIVO: tras los estados anteriores, solo sigue con pending_payment o
--       pending_minimum; cualquier otro -> 'ignored'.
--    d) Una reserva diferida que nunca inició un cobro pasa por las MISMAS guardas; si confirma,
--       el outcome es 'confirmed_unclaimed'. Una diferida solo confirma contra la fila `pending`
--       de su intent: sin ella, 'ignored'.
--    e) Al confirmar limpia la agenda de cobro y cancela los avisos de cobro pendientes.
--    f) reminder_24h solo si su hora cae en el futuro (§8).
--    Misma firma y tipo de retorno: CREATE OR REPLACE conserva el ACL; se re-afirma igual.
-- ================================================================
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

REVOKE EXECUTE ON FUNCTION public.confirm_booking(uuid, text, integer, text, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_booking(uuid, text, integer, text, integer, text)
  TO service_role;

-- ================================================================
-- 11. flag_payment_mismatch: cuerpo de …040; acepta también pending_minimum (§5.3), limpia la
--     agenda de cobro y cancela los avisos de cobro pendientes.
-- ================================================================
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

  IF v_booking.status NOT IN ('pending_payment', 'pending_minimum') THEN
    RETURN false;
  END IF;

  SELECT * INTO v_payment
    FROM public.payments
    WHERE booking_id = p_booking_id
    ORDER BY created_at DESC
    LIMIT 1;

  UPDATE public.bookings
    SET status = 'payment_mismatch', charge_next_attempt_at = NULL
    WHERE id = p_booking_id;

  -- (spec 0029) Sin avisos de cobro sobre una reserva en revisión manual.
  PERFORM public.cancel_pending_charge_notifications(p_booking_id, 'payment_mismatch');

  -- 0028: liberar el hold (`active` o `paying`); el cupo no está confirmado en mismatch.
  IF v_booking.hold_id IS NOT NULL THEN
    UPDATE public.tour_holds SET status = 'released'
      WHERE id = v_booking.hold_id AND status IN ('active', 'paying');
  END IF;

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
GRANT EXECUTE ON FUNCTION public.flag_payment_mismatch(uuid, integer, text, text)
  TO service_role;

-- ================================================================
-- 12. cancel_stale_pending_booking (§5.4): cuerpo de …036 con el gate por charge_started_at
--     bajo el lock (filtrar solo en la consulta del worker dejaría un TOCTOU) y el guard
--     is_public_request que le faltaba.
-- ================================================================
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

  -- Un cobro diferido en vuelo es del worker de cobro (watch-charges), no del reconciliador:
  -- su creación puede tener semanas y parecería abandonada.
  IF v_booking.charge_started_at IS NOT NULL THEN
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

-- ================================================================
-- 13. Retención (§6): cuerpos de …034 con la exclusión booking_retention_locked en cada
--     borrado. La anonimización de reservas con rastro financiero no cambia; la baja a pedido
--     informa en la auditoría cuántas reservas vivas retuvo.
--     Nota (review de B): las tres sentencias de borrado usan snapshots distintos. Si un intent
--     se cierra entre el DELETE de payments y el de bookings, la corrida falla por FK y se
--     reintenta al día siguiente; no borra de más.
-- ================================================================
CREATE OR REPLACE FUNCTION public.anonymize_booking_pii_by_email(
  p_email    text,
  p_actor_id uuid
)
RETURNS TABLE(anonymized_count integer, deleted_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email    text := lower(trim(p_email));
  v_anon     integer := 0;
  v_del      integer := 0;
  v_retained integer := 0;
BEGIN
  IF public.is_public_request() THEN
    RAISE EXCEPTION 'FORBIDDEN_PUBLIC_ROLE'
      USING HINT = 'Solo service_role puede ejecutar esta funcion';
  END IF;

  -- 1) Anonimizar (rastro financiero o payment_mismatch). Primero las notificaciones,
  --    mientras el email original aún matchea; luego la reserva.
  UPDATE public.notifications n
    SET recipient_email = 'anonimizado@anonimizado.local'
    FROM public.bookings b
    WHERE n.booking_id = b.id
      AND lower(b.customer_email) = v_email
      AND b.anonymized_at IS NULL
      AND (
        b.status = 'payment_mismatch'
        OR EXISTS (
          SELECT 1 FROM public.payments p
          WHERE p.booking_id = b.id AND p.status IN ('succeeded', 'refunded')
        )
      );

  UPDATE public.bookings b
    SET customer_name  = 'ANONIMIZADO',
        customer_email = 'anonimizado@anonimizado.local',
        anonymized_at  = now()
    WHERE lower(b.customer_email) = v_email
      AND b.anonymized_at IS NULL
      AND (
        b.status = 'payment_mismatch'
        OR EXISTS (
          SELECT 1 FROM public.payments p
          WHERE p.booking_id = b.id AND p.status IN ('succeeded', 'refunded')
        )
      );
  GET DIAGNOSTICS v_anon = ROW_COUNT;

  -- (spec 0029) Reservas vivas o con un intent potencialmente abierto: no se borran. La baja a
  -- pedido sobre una reserva viva la cancela primero y espera el cierre del intent.
  SELECT count(*) INTO v_retained
    FROM public.bookings b
    WHERE lower(b.customer_email) = v_email
      AND b.status <> 'payment_mismatch'
      AND public.booking_retention_locked(b)
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.booking_id = b.id AND p.status IN ('succeeded', 'refunded')
      );

  -- 2) Borrar las abandonadas (sin rastro financiero, no payment_mismatch, no retenidas).
  DELETE FROM public.refunds r
    USING public.bookings b
    WHERE r.booking_id = b.id
      AND lower(b.customer_email) = v_email
      AND b.status <> 'payment_mismatch'
      AND NOT public.booking_retention_locked(b)
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.booking_id = b.id AND p.status IN ('succeeded', 'refunded')
      );

  DELETE FROM public.payments p
    USING public.bookings b
    WHERE p.booking_id = b.id
      AND lower(b.customer_email) = v_email
      AND b.status <> 'payment_mismatch'
      AND NOT public.booking_retention_locked(b)
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p2
        WHERE p2.booking_id = b.id AND p2.status IN ('succeeded', 'refunded')
      );

  DELETE FROM public.bookings b
    WHERE lower(b.customer_email) = v_email
      AND b.status <> 'payment_mismatch'
      AND NOT public.booking_retention_locked(b)
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.booking_id = b.id AND p.status IN ('succeeded', 'refunded')
      );
  GET DIAGNOSTICS v_del = ROW_COUNT;

  INSERT INTO public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    'admin', p_actor_id, 'privacy.anonymized_by_email', 'privacy_erasure', gen_random_uuid(),
    jsonb_build_object(
      'anonymized_count', v_anon,
      'deleted_count', v_del,
      'retained_count', v_retained
    )
  );

  RETURN QUERY SELECT v_anon, v_del;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.anonymize_booking_pii_by_email(text, uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.purge_unpaid_bookings(p_cutoff timestamptz)
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

  DELETE FROM public.refunds r
    USING public.bookings b
    WHERE r.booking_id = b.id
      AND b.created_at < p_cutoff
      AND b.status <> 'payment_mismatch'
      AND NOT public.booking_retention_locked(b)
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.booking_id = b.id AND p.status IN ('succeeded', 'refunded')
      );

  DELETE FROM public.payments p
    USING public.bookings b
    WHERE p.booking_id = b.id
      AND b.created_at < p_cutoff
      AND b.status <> 'payment_mismatch'
      AND NOT public.booking_retention_locked(b)
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p2
        WHERE p2.booking_id = b.id AND p2.status IN ('succeeded', 'refunded')
      );

  DELETE FROM public.bookings b
    WHERE b.created_at < p_cutoff
      AND b.status <> 'payment_mismatch'
      AND NOT public.booking_retention_locked(b)
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.booking_id = b.id AND p.status IN ('succeeded', 'refunded')
      );
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
  VALUES (
    'system', 'retention.purged_unpaid', 'retention_run', gen_random_uuid(),
    jsonb_build_object('affected_count', v_count, 'cutoff', p_cutoff)
  );

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_unpaid_bookings(timestamptz)
  FROM PUBLIC, anon, authenticated;
