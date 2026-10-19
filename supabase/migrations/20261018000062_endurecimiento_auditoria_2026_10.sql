-- Migration: endurecimiento de la auditoría de seguridad del 2026-10-18
--
--   1. ACCESS-2: las funciones FUTURAS nacen sin EXECUTE para PUBLIC, anon ni authenticated.
--      Hasta acá cada migración tenía que acordarse del REVOKE (la 046 casi lo olvida): una
--      función SECURITY DEFINER nueva sin revoke quedaba invocable por anon vía PostgREST. Con el
--      default revocado, el olvido falla cerrado; quien necesite exponer una función lo hace con
--      un GRANT explícito. service_role ya recibe EXECUTE por default (…039).
--
--      Dos piezas, porque los default privileges por schema se SUMAN a los globales:
--        - El EXECUTE de PUBLIC viene del default global de PostgreSQL, así que se revoca SIN
--          `IN SCHEMA` (un REVOKE con `IN SCHEMA` solo deshace un GRANT por schema y no hace nada
--          contra el global). Alcanza a las funciones que cree `postgres` en cualquier schema:
--          si en el futuro una migración corre `CREATE EXTENSION` como `postgres` y algo que corre
--          como anon/authenticated (una política RLS, un RPC INVOKER) necesita esas funciones,
--          hay que darles el GRANT explícito.
--        - El GRANT a anon y authenticated lo agrega Supabase por schema (`IN SCHEMA public`).
--
--      Regla desde acá: una migración que haga DROP + CREATE de una función que llama
--      authenticated (los report_*) tiene que poner su GRANT explícito, como ya hace …059.
--      CREATE OR REPLACE conserva el ACL y no cambia nada.
--
--   2. ACCESS-3: fuera la sobrecarga vieja cancel_booking(uuid, text, integer, uuid) de …042.
--      Nadie la llama: la web y todas las funciones SQL usan la de 6 parámetros (spec 0032), que
--      además valida motivo y comisión. Viva, un caller con service_role podía caer en la lógica
--      de reembolso anterior a 0032 con solo omitir p_reason y p_fee_cents.
--
-- Verificación: SELECT defaclnamespace::regnamespace, defaclobjtype, defaclacl
--   FROM pg_default_acl WHERE defaclrole = 'postgres'::regrole;
--   → una entrada global (namespace 0) de tipo 'f' sin '=X', y la de public sin anon/authenticated.
--
-- Rollback:
--   (1) ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
--       ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
--   (2) re-crear la función desde 20260707000042_cierres_menores.sql y su REVOKE.

SET LOCAL lock_timeout = '5s';

ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

DROP FUNCTION public.cancel_booking(uuid, text, integer, uuid);
