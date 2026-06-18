-- Migration: auditoría de regresión AMPLIA de funciones ejecutables por roles públicos
-- (spec 0019, follow-up de F-3).
--
-- CONTEXTO: la auditoría 20260611000029 (`secdef_functions_public_executable()`) solo
-- cubre funciones `SECURITY DEFINER` (filtra `prosecdef`). El hallazgo F-3 fue una función
-- `SECURITY INVOKER` (`is_public_request`) que quedó ejecutable por anon — un caso que esa
-- auditoría NO detecta. Aunque el impacto de una INVOKER abierta es bajo (corre como el
-- llamador, no escala privilegios), el patrón "`REVOKE FROM PUBLIC` insuficiente" ya
-- apareció 2 veces, así que se agrega una red de regresión que cubra TODO el esquema.
--
-- DISEÑO: enumera las funciones de `public` ejecutables por `anon` o `authenticated`,
-- excluyendo:
--   1. Las funciones de TRIGGER (return type `trigger`): no son invocables como RPC y
--      DEBEN seguir siendo ejecutables (el trigger se dispara para todos los roles).
--   2. Una ALLOWLIST explícita de funciones intencionalmente públicas. Hoy son solo los
--      3 reportes (`report_*`), `SECURITY INVOKER` que el panel invoca con sesión
--      `authenticated` y que quedan gated por RLS + el guard de ruta. Si en el futuro se
--      agrega una función pública legítima, sumarla a esta lista es un acto DELIBERADO y
--      reviewable (no un olvido silencioso). El par (función, rol) es específico: un
--      reporte ejecutable por `anon` SÍ se reporta (la allowlist solo cubre authenticated).
--
-- El test de integración (`rpc-execute-grants.test.ts`) exige que esta función devuelva 0
-- filas. Cubre DEFINER + INVOKER, presentes y FUTURAS (no enumerativa). Complementa —no
-- reemplaza— a `secdef_functions_public_executable()`, que mantiene el invariante estricto
-- "cero DEFINER pública".
--
-- Reversibilidad: forward-only. Revertir: DROP FUNCTION.

CREATE OR REPLACE FUNCTION public.audit_public_executable_functions()
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
    -- (1) Excluir funciones de trigger: no son RPC y deben quedar ejecutables.
    AND p.prorettype <> 'pg_catalog.trigger'::regtype
    AND pg_catalog.has_function_privilege(r.rolname, p.oid, 'EXECUTE')
    -- (2) Excluir la allowlist de funciones intencionalmente públicas (par función+rol).
    AND NOT EXISTS (
      SELECT 1
      FROM (VALUES
        ('report_revenue',         'authenticated'),
        ('report_occupancy',       'authenticated'),
        ('report_refunds_summary', 'authenticated')
      ) AS allow(proname, rolname)
      WHERE allow.proname = p.proname
        AND allow.rolname = r.rolname
    )
  ORDER BY 1, 2;
$$;

-- Solo service_role la ejecuta (como las demás funciones de auditoría/privilegiadas).
REVOKE EXECUTE ON FUNCTION public.audit_public_executable_functions()
  FROM PUBLIC, anon, authenticated;
