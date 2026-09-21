-- Migration: cupo mínimo y cobro diferido — esquema (spec 0029, workstream A).
--
-- Solo modelo de datos, sin tocar dinero: columnas, estado `pending_minimum`, kinds de
-- notificación, índices y la tabla de configuración `business_settings`. Las funciones que
-- escriben estos datos (create_deferred_booking, charge_*, confirm_departure, cancel_departure,
-- los cambios a confirm_booking / flag_payment_mismatch / cancel_stale_pending_booking y las
-- exclusiones de retención) llegan en los workstreams B y C. Hasta entonces ningún código
-- escribe `pending_minimum` ni los kinds nuevos, así que el flujo vigente no cambia.
--
-- Excede 150 líneas: excepción permitida para migraciones SQL (codebase-conventions).
--
-- Deploy: la DB de prod no tiene datos reales (pre-cutover) → sin NOT VALID ni CONCURRENTLY.
-- Los índices únicos parciales fallan explícitos si un entorno tuviera datos en conflicto.
--
-- Reversibilidad: forward-only. Revertir = re-CREATE de audit_table_grants_to_public_roles
-- de …038; DROP de la tabla, el trigger, la función, los índices y los CHECK nuevos; re-ADD de
-- los CHECK de status/kind de …036 (requiere que no existan filas con los valores nuevos) y
-- DROP de las columnas. Hoy no pierde datos (nadie escribe estas columnas). Después de B NO es
-- un rollback seguro: borraría datos de tarjeta, de cobro y de cierre de intents que el barrido
-- y la retención necesitan; antes hay que cerrar los cobros en vuelo y los intents abiertos.

-- ----------------------------------------------------------------
-- 1. tours: política ante una salida bajo el mínimo (spec 0029 §5.11).
--    false = el staff decide en la ventana; true = cancelación automática sin avisar al staff.
--    min_participants ya existe (…004) y es editable desde el panel.
-- ----------------------------------------------------------------
ALTER TABLE public.tours
  ADD COLUMN auto_cancel_below_minimum boolean NOT NULL DEFAULT false;

-- ----------------------------------------------------------------
-- 2. tour_holds: customer de OnvoPay creado en el checkout (§5.2) y marca de su limpieza
--    cuando el checkout se abandona (§5.9).
-- ----------------------------------------------------------------
ALTER TABLE public.tour_holds
  ADD COLUMN customer_external_id text        NULL,
  ADD COLUMN customer_cleaned_at  timestamptz NULL;

-- ----------------------------------------------------------------
-- 3. bookings: tarjeta guardada, estado del cobro diferido y estado `pending_minimum`.
--    card_* son datos obtenidos por el servidor (GET /payment-methods), nunca el PAN; el año
--    se guarda con 4 dígitos (el rango lo exige: un año de 2 dígitos rompería la regla de
--    "tarjeta que vence antes del tour" sin error visible).
--    charge_last_error guarda el CÓDIGO del rechazo, no el mensaje crudo del proveedor.
-- ----------------------------------------------------------------
ALTER TABLE public.bookings
  ADD COLUMN payment_method_id      text        NULL,
  ADD COLUMN customer_external_id   text        NULL,
  ADD COLUMN card_brand             text        NULL,
  ADD COLUMN card_last4             text        NULL
    CONSTRAINT bookings_card_last4_check CHECK (card_last4 ~ '^[0-9]{4}$'),
  ADD COLUMN card_exp_month         smallint    NULL
    CONSTRAINT bookings_card_exp_month_check CHECK (card_exp_month BETWEEN 1 AND 12),
  ADD COLUMN card_exp_year          smallint    NULL
    CONSTRAINT bookings_card_exp_year_check CHECK (card_exp_year BETWEEN 2000 AND 2100),
  ADD COLUMN charge_attempts        integer     NOT NULL DEFAULT 0
    CONSTRAINT bookings_charge_attempts_check CHECK (charge_attempts >= 0),
  ADD COLUMN charge_next_attempt_at timestamptz NULL,
  ADD COLUMN charge_started_at      timestamptz NULL,
  ADD COLUMN charge_last_error      text        NULL,
  ADD COLUMN awaiting_action_until  timestamptz NULL,
  ADD COLUMN recovery_deadline      timestamptz NULL;

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN (
    'pending_minimum', 'pending_payment', 'confirmed', 'cancelled', 'refunded',
    'payment_mismatch', 'overbooked_refunded'
  ));

-- Una reserva sin cobrar solo existe con la tarjeta guardada y el customer que la respaldan:
-- la actualización de tarjeta verifica el customerId contra el de la reserva (§5.2).
ALTER TABLE public.bookings ADD CONSTRAINT bookings_pending_minimum_has_card_check
  CHECK (
    status <> 'pending_minimum'
    OR (payment_method_id IS NOT NULL AND customer_external_id IS NOT NULL)
  );

-- Una tarjeta, una reserva viva (§5.2). Las reservas del flujo vigente tienen
-- payment_method_id NULL y no colisionan (NULL es distinto de NULL en un índice único).
CREATE UNIQUE INDEX bookings_one_live_per_payment_method
  ON public.bookings (payment_method_id)
  WHERE status IN ('pending_minimum', 'pending_payment');

-- Selección de reservas a cobrar por salida (charge-bookings, workstream C).
CREATE INDEX bookings_pending_minimum_instance_idx
  ON public.bookings (tour_instance_id)
  WHERE status = 'pending_minimum';

-- Reintentos programados (§5.5): la selección siempre filtra pending_minimum. Filtrar por
-- estado también limpia el índice si una función olvida poner la columna en NULL al salir.
CREATE INDEX bookings_charge_next_attempt_idx
  ON public.bookings (charge_next_attempt_at)
  WHERE status = 'pending_minimum' AND charge_next_attempt_at IS NOT NULL;

-- Monto y moneda son el mandato que el turista aceptó al guardar la tarjeta (§5.2), y
-- confirm_booking valida ambos contra lo pagado: inmutables tras el INSERT para todos los
-- roles, incluido service_role (los triggers se disparan siempre). Ninguna función vigente
-- los actualiza.
CREATE OR REPLACE FUNCTION public.reject_booking_mandate_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'BOOKING_MANDATE_IMMUTABLE'
    USING HINT = 'total_amount_cents y currency son el mandato y no cambian tras el INSERT (spec 0029)';
END;
$$;

CREATE TRIGGER bookings_block_mandate_change
  BEFORE UPDATE OF total_amount_cents, currency ON public.bookings
  FOR EACH ROW
  WHEN (
    OLD.total_amount_cents IS DISTINCT FROM NEW.total_amount_cents
    OR OLD.currency IS DISTINCT FROM NEW.currency
  )
  EXECUTE FUNCTION public.reject_booking_mandate_change();

-- ----------------------------------------------------------------
-- 4. payments: cierre del intent y anti-doble-cobro (§5.6).
--    failed_at lo fija toda función que pasa una fila a `failed`; provider_closed_at, el
--    barrido que comprueba el cierre del intent en OnvoPay. Las filas `failed` del flujo
--    vigente (cancel_stale_pending_booking, …036) no tienen failed_at: quedan fuera del
--    barrido, y la exclusión de retención de B debe acotarse al flujo diferido
--    (payment_method_id IS NOT NULL) para no retener checkouts abandonados para siempre.
-- ----------------------------------------------------------------
ALTER TABLE public.payments
  ADD COLUMN failed_at          timestamptz NULL,
  ADD COLUMN provider_closed_at timestamptz NULL;

-- Una sola fila `pending` por reserva: un intent por reserva, reutilizado en los reintentos.
-- Índice parcial: como árbitro de ON CONFLICT exige `ON CONFLICT (booking_id) WHERE status =
-- 'pending'`; B usa la guarda explícita bajo FOR UPDATE de §6.
CREATE UNIQUE INDEX payments_one_pending_per_booking
  ON public.payments (booking_id)
  WHERE status = 'pending';

-- Barrido de intents no cerrados (close-payment-intents, workstream B): filas `failed` sin
-- cerrar dentro de la ventana de 7 días desde failed_at. Desvío de §6, que decía (booking_id):
-- la búsqueda por reserva ya la cubre payments_booking_idx.
CREATE INDEX payments_failed_unclosed_idx
  ON public.payments (failed_at)
  WHERE status = 'failed' AND provider_closed_at IS NULL AND failed_at IS NOT NULL;

-- ----------------------------------------------------------------
-- 5. notifications: kinds nuevos. La unicidad (booking_id, kind) de …013 NO cambia: es el
--    árbitro de los ON CONFLICT de confirm_booking, cancel_booking y settle_refund. El aviso
--    repetido de tarjeta rechazada usa tres kinds distintos (_1, _2, _3).
-- ----------------------------------------------------------------
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
    'charge_requires_action'
  ));

-- ----------------------------------------------------------------
-- 6. tour_instances: disparo y resolución del mínimo por salida (§5.5), con snapshot de
--    mínimo y asientos al momento del disparo.
-- ----------------------------------------------------------------
ALTER TABLE public.tour_instances
  ADD COLUMN minimum_charge_triggered_at timestamptz NULL,
  ADD COLUMN staff_decision_required_at  timestamptz NULL,
  ADD COLUMN minimum_resolved_at         timestamptz NULL,
  ADD COLUMN minimum_resolved_by         uuid        NULL REFERENCES public.users (id),
  ADD COLUMN minimum_resolution          text        NULL
    CONSTRAINT tour_instances_minimum_resolution_check
    CHECK (minimum_resolution IN ('reached', 'staff_confirmed', 'staff_cancelled', 'auto_cancelled')),
  ADD COLUMN min_participants_at_trigger integer     NULL,
  ADD COLUMN seats_at_trigger            integer     NULL;

-- Toda resolución es terminal y lleva su marca de tiempo: ni resolución sin fecha ni al revés.
ALTER TABLE public.tour_instances ADD CONSTRAINT tour_instances_minimum_resolution_pair_check
  CHECK ((minimum_resolved_at IS NULL) = (minimum_resolution IS NULL));

-- El disparo del cobro existe exactamente cuando la salida se resolvió confirmándose
-- (`reached` automático o `staff_confirmed`): nunca un cobro sobre una salida cancelada.
ALTER TABLE public.tour_instances ADD CONSTRAINT tour_instances_minimum_trigger_check
  CHECK (
    (minimum_charge_triggered_at IS NOT NULL)
    = COALESCE(minimum_resolution IN ('reached', 'staff_confirmed'), false)
  );

-- El disparo guarda el snapshot con el que se decidió. IS NOT NULL explícito: un CHECK que
-- evalúa a NULL se acepta, y `NULL >= 0` dejaría pasar un disparo sin snapshot.
ALTER TABLE public.tour_instances ADD CONSTRAINT tour_instances_minimum_snapshot_check
  CHECK (
    minimum_charge_triggered_at IS NULL
    OR (
      min_participants_at_trigger IS NOT NULL AND min_participants_at_trigger >= 1
      AND seats_at_trigger IS NOT NULL AND seats_at_trigger >= 0
    )
  );

-- Solo las decisiones del staff tienen actor; las automáticas no.
ALTER TABLE public.tour_instances ADD CONSTRAINT tour_instances_minimum_actor_check
  CHECK (
    minimum_resolved_by IS NULL
    OR minimum_resolution IN ('staff_confirmed', 'staff_cancelled')
  );

-- Salidas pendientes de resolver (resolve-minimum-window, workstream C). Las canceladas no
-- necesitan resolución. El barrido de rezagados de C debe partir de las reservas vivas
-- (bookings_pending_minimum_instance_idx), no de este índice, que incluye las históricas.
CREATE INDEX tour_instances_minimum_unresolved_idx
  ON public.tour_instances (starts_at)
  WHERE minimum_resolved_at IS NULL AND status <> 'cancelled';

-- FK de soporte, completo como las FKs nullable de …041. business_settings.updated_by queda
-- sin índice a propósito: la tabla tiene una sola fila.
CREATE INDEX tour_instances_minimum_resolved_by_idx
  ON public.tour_instances (minimum_resolved_by);

-- ----------------------------------------------------------------
-- 7. business_settings: configuración global del negocio, fila única.
--    minimum_decision_window_hours = horas antes de la salida en que una salida bajo el
--    mínimo se resuelve (el staff decide, o se cancela sola si el tour tiene el toggle).
-- ----------------------------------------------------------------
CREATE TABLE public.business_settings (
  id                            smallint    PRIMARY KEY DEFAULT 1
    CONSTRAINT business_settings_singleton_check CHECK (id = 1),
  minimum_decision_window_hours integer     NOT NULL DEFAULT 24
    CONSTRAINT business_settings_decision_window_check
    CHECK (minimum_decision_window_hours BETWEEN 1 AND 720),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  updated_by                    uuid        NULL REFERENCES public.users (id)
);

CREATE TRIGGER set_business_settings_updated_at
  BEFORE UPDATE ON public.business_settings
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

INSERT INTO public.business_settings (id) VALUES (1);

-- RLS: lectura admin/staff, escritura admin. El claim user_role lo inyecta el auth hook
-- (…007); (select auth.jwt() ...) para evaluación InitPlan (patrón de …009).
-- La escritura exige además que updated_by sea quien escribe: el registro de autoría no
-- se puede falsear desde el cliente.
ALTER TABLE public.business_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY business_settings_select_admin_staff
  ON public.business_settings
  FOR SELECT
  TO authenticated
  USING ((select auth.jwt() ->> 'user_role') IN ('admin', 'staff'));

CREATE POLICY business_settings_update_admin
  ON public.business_settings
  FOR UPDATE
  TO authenticated
  USING ((select auth.jwt() ->> 'user_role') = 'admin')
  WITH CHECK (
    (select auth.jwt() ->> 'user_role') = 'admin'
    AND updated_by = (select auth.uid())
  );

-- Grants explícitos (spec 0027). Sin INSERT ni DELETE: la fila única la crea esta
-- migración. UPDATE a nivel COLUMNA (como users en …038): id y updated_at quedan fuera del
-- alcance de authenticated; updated_at lo fija el trigger.
REVOKE ALL ON public.business_settings FROM anon, authenticated;
GRANT SELECT ON public.business_settings TO authenticated;
GRANT UPDATE (minimum_decision_window_hours, updated_by) ON public.business_settings TO authenticated;
-- service_role (worker de C) explícito: no depender del default privilege (incidente de …039).
GRANT ALL ON public.business_settings TO service_role;

-- ----------------------------------------------------------------
-- 8. Red de regresión de grants de tabla (…038): se suma business_settings a la allowlist.
--    Cuerpo vigente de …038 con el único agregado de ('business_settings', authenticated,
--    SELECT). El UPDATE es de COLUMNA y no figura en role_table_grants (misma nota que users).
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_table_grants_to_public_roles()
RETURNS TABLE(table_name text, role_name text, privilege_type text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT g.table_name::text, g.grantee::text, g.privilege_type::text
  FROM information_schema.role_table_grants g
  WHERE g.table_schema = 'public'
    AND g.grantee IN ('anon', 'authenticated')
    -- Excluir la allowlist explícita de ternas (tabla, rol, privilegio) intencionales.
    AND NOT EXISTS (
      SELECT 1
      FROM (VALUES
        -- anon: solo SELECT en las tablas del portal público.
        ('tours',                'anon',          'SELECT'),
        ('tour_pricing',         'anon',          'SELECT'),
        ('tour_schedules',       'anon',          'SELECT'),
        ('tour_instances',       'anon',          'SELECT'),
        -- authenticated: CRUD en tablas de tours.
        ('tours',                'authenticated', 'SELECT'),
        ('tours',                'authenticated', 'INSERT'),
        ('tours',                'authenticated', 'UPDATE'),
        ('tours',                'authenticated', 'DELETE'),
        ('tour_pricing',         'authenticated', 'SELECT'),
        ('tour_pricing',         'authenticated', 'INSERT'),
        ('tour_pricing',         'authenticated', 'UPDATE'),
        ('tour_pricing',         'authenticated', 'DELETE'),
        ('tour_schedules',       'authenticated', 'SELECT'),
        ('tour_schedules',       'authenticated', 'INSERT'),
        ('tour_schedules',       'authenticated', 'UPDATE'),
        ('tour_schedules',       'authenticated', 'DELETE'),
        -- authenticated: solo SELECT en el resto de las tablas de la app.
        ('tour_instances',       'authenticated', 'SELECT'),
        ('bookings',             'authenticated', 'SELECT'),
        ('payments',             'authenticated', 'SELECT'),
        ('notifications',        'authenticated', 'SELECT'),
        ('refunds',              'authenticated', 'SELECT'),
        ('users',                'authenticated', 'SELECT'),
        -- (users NO lleva UPDATE acá: el self-update de perfil es un grant de COLUMNA
        --  full_name/phone/locale, que no figura en role_table_grants — ver nota en …038.)
        ('tour_instance_guides', 'authenticated', 'SELECT'),
        -- (business_settings: el UPDATE del admin también es de COLUMNA, spec 0029.)
        ('business_settings',    'authenticated', 'SELECT')
      ) AS allow(tbl, role, priv)
      WHERE allow.tbl  = g.table_name
        AND allow.role = g.grantee
        AND allow.priv = g.privilege_type
    )
  ORDER BY 1, 2, 3;
$$;

REVOKE EXECUTE ON FUNCTION public.audit_table_grants_to_public_roles()
  FROM PUBLIC, anon, authenticated;
