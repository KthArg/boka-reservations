-- Migration: acceso EXPLÍCITO de `service_role` a `public` (fix correctivo de 0027).
--
-- SÍNTOMA (prod): el worker (que usa el service_role key) y el web server-side reciben
--   `permission denied for table tours/tour_holds/tour_schedules/refunds` (SQLSTATE 42501) y
--   `permission denied for function purge_*`, AUNQUE en local todo funciona. Confirmado por REST:
--   `GET /rest/v1/tours` con la service_role key → 403 / 42501 en prod.
--
-- CAUSA: `service_role` bypassa RLS pero NO los GRANT de tabla ni el EXECUTE de funciones (no es
--   superusuario de Postgres). Las migraciones conceden acceso EXPLÍCITO solo a `anon`/`authenticated`
--   (0027 para tablas; 0018–0036 para funciones) y para `service_role` confían en el *default
--   privilege* que Supabase aplica al rol que crea los objetos. El proyecto de PROD no propagó ese
--   default a `service_role`, así que tras los `REVOKE … FROM PUBLIC` de las funciones y los grants
--   solo-anon/authenticated de las tablas, `service_role` quedó sin acceso a `public`. (Situación
--   invertida observable: anon/authenticated SÍ pueden `SELECT tour_schedules`, service_role no.)
--
-- FIX: hacer EXPLÍCITO el acceso completo de `service_role` a `public` — el análogo, para el rol de
--   servicio, de lo que 0027 hizo para los roles públicos. `service_role` es el rol administrativo
--   server-only (worker, web server-side, webhooks); su secret key NUNCA se expone al browser, así que
--   esto NO debilita la postura frente a `anon`/`authenticated` (esos siguen con sus grants mínimos de
--   0027 intactos). Idempotente. Reversibilidad: forward-only (revertir = REVOKE puntual + git revert).
--
-- NOTA: esto también deja explícita la postura para `db reset` local y para cualquier proyecto nuevo,
--   sin depender del default del proveedor (mismo criterio "no depender de un default de Supabase" de 0027).

-- Acceso a los objetos EXISTENTES de public.
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Objetos FUTUROS de public: que service_role los reciba sin depender del default del proveedor.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;
