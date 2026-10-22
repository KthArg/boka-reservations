-- Migration: segundo factor obligatorio para el panel (spec 0049 §5.1, §6)
--
-- Una política RESTRICTIVE por tabla que el panel lee o escribe con el cliente `authenticated`:
-- un token de admin o staff solo pasa si la sesión verificó el segundo factor (claim `aal` =
-- 'aal2'). Es la capa que cierra el acceso directo por PostgREST y Storage con un token `aal1`
-- (solo contraseña); el middleware y requireAuth lo exigen en la app.
--
-- Las RESTRICTIVE se combinan con AND con las PERMISSIVE existentes: no dan acceso, solo lo
-- quitan. Una sesión que no es del panel (sin user_role admin/staff) no queda afectada por esta
-- política. Un token sin claim `aal` cuenta como no-aal2.
--
-- Inventario cerrado (pg_policies con roles {authenticated} o {public}, al escribir esto): las 12
-- tablas de public de abajo y storage.objects (tour_images_admin_* de …050). Ninguna de sus
-- políticas usa subconsultas a otras tablas: la RESTRICTIVE no rompe lecturas cruzadas. Las
-- políticas TO anon no aplican a un token authenticated. El test no enumerativo de
-- mfa-rls.test.ts exige que una tabla nueva con políticas para authenticated sume la suya.
--
-- ORDEN DE ROLLOUT (spec 0049 §11): aplicar en producción DESPUÉS de desplegar la web con /mfa y
-- de que todo el equipo haya enrolado su factor. Antes, una sesión aal1 se queda sin datos.
--
-- Rollback: una migración nueva con DROP POLICY de las 13 políticas (el proyecto es
-- forward-only), aplicada ANTES de revertir la web.

DO $$
DECLARE
  t text;
  c_check constant text :=
    '((select auth.jwt() ->> ''aal'') = ''aal2'' '
    || 'OR coalesce((select auth.jwt() ->> ''user_role''), '''') NOT IN (''admin'', ''staff''))';
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'tours', 'tour_pricing', 'tour_schedules', 'tour_instances', 'bookings',
    'payments', 'notifications', 'refunds', 'audit_logs', 'business_settings',
    'tour_instance_guides'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING %s WITH CHECK %s',
      t || '_require_aal2_for_panel', t, c_check, c_check
    );
  END LOOP;

  EXECUTE format(
    'CREATE POLICY %I ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated USING %s WITH CHECK %s',
    'objects_require_aal2_for_panel', c_check, c_check
  );
END;
$$;

-- Auditoría no enumerativa (spec 0049 §10), espejo de secdef_functions_public_executable (…029):
-- tablas de public o storage con alguna política que alcanza a usuarios autenticados (roles
-- authenticated o public) y sin la RESTRICTIVE de aal2. Una tabla nueva del panel que se olvide
-- de sumar la suya aparece en mfa-rls.test.ts. Solo service_role.
CREATE FUNCTION public.panel_tables_missing_aal2()
RETURNS TABLE (schema_name text, table_name text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT DISTINCT p.schemaname::text, p.tablename::text
  FROM pg_catalog.pg_policies p
  WHERE p.schemaname IN ('public', 'storage')
    AND (p.roles @> ARRAY['authenticated']::name[] OR p.roles @> ARRAY['public']::name[])
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies r
      WHERE r.schemaname = p.schemaname
        AND r.tablename = p.tablename
        AND r.policyname = p.tablename || '_require_aal2_for_panel'
        AND r.permissive = 'RESTRICTIVE'
        AND r.cmd = 'ALL'
        AND r.roles @> ARRAY['authenticated']::name[]
        AND r.qual = r.with_check
        AND r.qual LIKE '%aal2%'
    )
  ORDER BY 1, 2;
$$;

REVOKE EXECUTE ON FUNCTION public.panel_tables_missing_aal2() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.panel_tables_missing_aal2() TO service_role;
