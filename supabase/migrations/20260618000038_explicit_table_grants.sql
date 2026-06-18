-- Migration: grants de tabla EXPLÍCITOS para roles públicos de PostgREST (spec 0027).
--
-- CONTEXTO: en Supabase, las tablas nuevas de `public` reciben un GRANT por defecto a
-- `anon`/`authenticated` (lo gobierna el toggle "Automatically expose new tables", que
-- maneja ALTER DEFAULT PRIVILEGES). PostgREST necesita ese GRANT de tabla para que una
-- fila sea alcanzable; la RLS filtra DENTRO de lo concedido. Hoy la app depende de ese
-- default para varias tablas (users, bookings, etc.), así que el toggle no se puede apagar
-- sin romperla. Este spec hace EXPLÍCITO todo el control de exposición de tablas, para que
-- el toggle quede en OFF y la postura de seguridad no dependa de un default del proveedor.
-- Es el análogo, para TABLAS, de lo que 0018/0019 hicieron para EXECUTE de funciones.
--
-- ORDEN (sección 5.2 del spec):
--   1. ALTER DEFAULT PRIVILEGES ... REVOKE  → espeja "auto-expose OFF" a nivel DB.
--   2. REVOKE ALL de las tablas service-only.
--   3. GRANT con verbos mínimos a las tablas de la app.
--   4. REVOKE INSERT/UPDATE/DELETE de anon en las tablas del portal (anon solo SELECT).
--   5. Función de auditoría de regresión (red de seguridad).
--
-- El audit 5.1 quedó cerrado y verificado contra el código (2026-06-18). El único caso de
-- escritura autenticada son las tablas de tours (CRUD del panel); el resto de las escrituras
-- van por service_role (que bypassa grants+RLS, no le afecta ningún REVOKE de acá).
--
-- Idempotente respecto de los grants explícitos ya existentes (reafirmarlos no daña).
-- Reversibilidad: forward-only. Revertir = GRANT puntual de emergencia y/o git revert.

-- ----------------------------------------------------------------
-- 1. Cortar la exposición automática de tablas futuras (auto-expose OFF a nivel DB).
--    Toda tabla nueva de `public` deberá declarar sus grants explícitamente o no será
--    alcanzable por PostgREST. Local == prod.
-- ----------------------------------------------------------------
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;

-- ----------------------------------------------------------------
-- 2. Tablas SOLO service_role: revocar todo de los roles públicos.
--    La app las toca únicamente con service_role (que bypassa grants+RLS). Quitar el grant
--    de tabla las saca del alcance de PostgREST para anon/authenticated.
-- ----------------------------------------------------------------
REVOKE ALL ON public.audit_logs               FROM anon, authenticated;
REVOKE ALL ON public.tour_holds               FROM anon, authenticated;
REVOKE ALL ON public.guide_access_tokens      FROM anon, authenticated;
REVOKE ALL ON public.booking_access_tokens    FROM anon, authenticated;
REVOKE ALL ON public.processed_webhook_events FROM anon, authenticated;
REVOKE ALL ON public.rate_limits              FROM anon, authenticated;

-- ----------------------------------------------------------------
-- 3. Tablas de la app: REVOKE ALL primero, luego GRANT con verbos mínimos (audit 5.1).
--
--    El REVOKE ALL es OBLIGATORIO: el proyecto local de Supabase concede ALL por defecto
--    (SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE) a anon/authenticated
--    en cada tabla al crearse. Sin revocar primero, esos privilegios sobrantes quedarían
--    (anon/authenticated con INSERT/UPDATE/DELETE en tablas que solo deben LEER, más
--    REFERENCES/TRIGGER/TRUNCATE en todas). REVOKE ALL deja la tabla en cero y el GRANT
--    siguiente fija el estado final deseado, reproducible con `db reset` sin depender del
--    default del proveedor (spec 5.2).
-- ----------------------------------------------------------------
REVOKE ALL ON public.tours                FROM anon, authenticated;
REVOKE ALL ON public.tour_pricing         FROM anon, authenticated;
REVOKE ALL ON public.tour_schedules       FROM anon, authenticated;
REVOKE ALL ON public.tour_instances       FROM anon, authenticated;
REVOKE ALL ON public.bookings             FROM anon, authenticated;
REVOKE ALL ON public.payments             FROM anon, authenticated;
REVOKE ALL ON public.notifications        FROM anon, authenticated;
REVOKE ALL ON public.refunds              FROM anon, authenticated;
REVOKE ALL ON public.users                FROM anon, authenticated;
REVOKE ALL ON public.tour_instance_guides FROM anon, authenticated;

-- 3a. Tablas de tours: ÚNICO caso de escritura autenticada (CRUD del panel admin,
--     gated por RLS a role=admin). anon lee el portal público; authenticated hace CRUD.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tours          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tour_pricing   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tour_schedules TO authenticated;
GRANT SELECT ON public.tours          TO anon;
GRANT SELECT ON public.tour_pricing   TO anon;
GRANT SELECT ON public.tour_schedules TO anon;

-- 3b. tour_instances: anon SELECT (portal) + authenticated SELECT (panel + reports).
--     Las crea el worker (service); ninguna escritura autenticada/anon.
GRANT SELECT ON public.tour_instances TO anon, authenticated;

-- 3c. Tablas de solo lectura autenticada (panel + reports SECURITY INVOKER).
--     Toda escritura va por service_role. NO quitar el SELECT de payments/bookings:
--     lo necesitan los reportes report_* (SECURITY INVOKER, corren como authenticated).
GRANT SELECT ON public.bookings             TO authenticated;
GRANT SELECT ON public.payments             TO authenticated;
GRANT SELECT ON public.notifications        TO authenticated;
GRANT SELECT ON public.refunds              TO authenticated;
GRANT SELECT ON public.tour_instance_guides TO authenticated;

-- users: además de SELECT, authenticated necesita UPDATE para el "perfil propio". La RLS
--   users_update (…009) permite a un usuario actualizar SOLO su fila (id = auth.uid()) y su
--   WITH CHECK bloquea el cambio de rol; el grant de tabla solo habilita esa capacidad ya
--   existente (sin él, el self-update da 42501 antes de la RLS — lo prueba auth.test.ts).
--   El CRUD del panel de usuarios va por service_role (web/lib/users/manage.ts), no por acá.
GRANT SELECT, UPDATE ON public.users        TO authenticated;

-- ----------------------------------------------------------------
-- 4. anon solo conserva SELECT en las tablas del portal: revocar escrituras.
--    (Redundante tras el REVOKE ALL de la sección 3 — a anon solo se le re-otorgó SELECT —,
--    pero se deja EXPLÍCITO como pin del invariante "anon = solo SELECT en el portal", según
--    la sección 5.2 del spec. Idempotente.)
-- ----------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.tours          FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.tour_pricing   FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.tour_schedules FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.tour_instances FROM anon;

-- ----------------------------------------------------------------
-- 5. Red de regresión: audit_table_grants_to_public_roles()
--    (espejo de audit_public_executable_functions() de la …031).
--
--    Enumera las ternas (tabla, rol, privilegio) donde un rol público (anon/authenticated)
--    tiene un grant sobre una tabla de `public`, EXCLUYENDO una allowlist explícita de
--    ternas intencionales. El test (table-grants.test.ts) la invoca vía service_role y
--    exige 0 filas. Agregar una tabla pública nueva obliga a sumarla a la allowlist (acto
--    deliberado y reviewable) o el test se vuelve rojo — el olvido no es agujero silencioso.
--
--    SECURITY DEFINER (corre como el owner) para que role_table_grants vea TODOS los grants,
--    no solo los del invocador. Solo lectura. REVOKE EXECUTE de los roles públicos abajo.
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
        -- users UPDATE: self-update de perfil propio, gated por RLS users_update (…009).
        ('users',                'authenticated', 'UPDATE'),
        ('tour_instance_guides', 'authenticated', 'SELECT')
      ) AS allow(tbl, role, priv)
      WHERE allow.tbl  = g.table_name
        AND allow.role = g.grantee
        AND allow.priv = g.privilege_type
    )
  ORDER BY 1, 2, 3;
$$;

-- Solo service_role la ejecuta (como las demás funciones de auditoría/privilegiadas).
REVOKE EXECUTE ON FUNCTION public.audit_table_grants_to_public_roles()
  FROM PUBLIC, anon, authenticated;
