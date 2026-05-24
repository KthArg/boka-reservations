-- 1. Revocar SELECT de anon en todas las tablas.
--    Supabase otorga ALL por defecto al rol anon en cada tabla nueva.
--    Ninguna política RLS permite a anon leer datos de estas tablas,
--    así que el grant es innecesario y amplía la superficie GraphQL.
--    Etapa 6 volverá a otorgar SELECT en tours/pricing/schedules cuando
--    el portal público lo requiera.
REVOKE SELECT ON public.users FROM anon;
REVOKE SELECT ON public.tours FROM anon;
REVOKE SELECT ON public.tour_pricing FROM anon;
REVOKE SELECT ON public.tour_schedules FROM anon;

-- 2. Corregir Auth RLS Initialization Plan en todas las políticas.
--    auth.jwt() y auth.uid() sin (select ...) se ejecutan como
--    correlated subquery — una vez por fila. Con (select ...) PostgreSQL
--    los convierte en InitPlan y los evalúa una sola vez por query.

-- users: recrear políticas de escritura con el patrón correcto
DROP POLICY "users_insert_admin" ON public.users;
DROP POLICY "users_update_admin" ON public.users;
DROP POLICY "users_update_self" ON public.users;
DROP POLICY "users_delete_admin" ON public.users;

CREATE POLICY "users_insert_admin" ON public.users
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.jwt() ->> 'user_role') = 'admin');

-- 3. Unir users_update_admin + users_update_self en una sola política.
--    Dos políticas permisivas para el mismo rol+acción obligan a PostgreSQL
--    a evaluar ambas en cada query aunque la primera ya sea suficiente.
CREATE POLICY "users_update" ON public.users
  FOR UPDATE TO authenticated
  USING (
    (select auth.jwt() ->> 'user_role') = 'admin'
    OR id = (select auth.uid())
  )
  WITH CHECK (
    (select auth.jwt() ->> 'user_role') = 'admin'
    OR (
      id = (select auth.uid())
      AND role = ((select auth.jwt() ->> 'user_role'))::user_role
    )
  );

CREATE POLICY "users_delete_admin" ON public.users
  FOR DELETE TO authenticated
  USING ((select auth.jwt() ->> 'user_role') = 'admin');

-- tours
DROP POLICY "tours_insert_admin" ON public.tours;
DROP POLICY "tours_update_admin" ON public.tours;
DROP POLICY "tours_delete_admin" ON public.tours;

CREATE POLICY "tours_insert_admin" ON public.tours
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.jwt() ->> 'user_role') = 'admin');

CREATE POLICY "tours_update_admin" ON public.tours
  FOR UPDATE TO authenticated
  USING ((select auth.jwt() ->> 'user_role') = 'admin');

CREATE POLICY "tours_delete_admin" ON public.tours
  FOR DELETE TO authenticated
  USING ((select auth.jwt() ->> 'user_role') = 'admin');

-- tour_pricing
DROP POLICY "tour_pricing_insert_admin" ON public.tour_pricing;
DROP POLICY "tour_pricing_update_admin" ON public.tour_pricing;
DROP POLICY "tour_pricing_delete_admin" ON public.tour_pricing;

CREATE POLICY "tour_pricing_insert_admin" ON public.tour_pricing
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.jwt() ->> 'user_role') = 'admin');

CREATE POLICY "tour_pricing_update_admin" ON public.tour_pricing
  FOR UPDATE TO authenticated
  USING ((select auth.jwt() ->> 'user_role') = 'admin');

CREATE POLICY "tour_pricing_delete_admin" ON public.tour_pricing
  FOR DELETE TO authenticated
  USING ((select auth.jwt() ->> 'user_role') = 'admin');

-- tour_schedules
DROP POLICY "tour_schedules_insert_admin" ON public.tour_schedules;
DROP POLICY "tour_schedules_update_admin" ON public.tour_schedules;
DROP POLICY "tour_schedules_delete_admin" ON public.tour_schedules;

CREATE POLICY "tour_schedules_insert_admin" ON public.tour_schedules
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.jwt() ->> 'user_role') = 'admin');

CREATE POLICY "tour_schedules_update_admin" ON public.tour_schedules
  FOR UPDATE TO authenticated
  USING ((select auth.jwt() ->> 'user_role') = 'admin');

CREATE POLICY "tour_schedules_delete_admin" ON public.tour_schedules
  FOR DELETE TO authenticated
  USING ((select auth.jwt() ->> 'user_role') = 'admin');
