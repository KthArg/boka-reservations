-- Migration: restringe la lectura de public.users por RLS (spec 0016, B-4)
--
-- Antes: la política users_select_authenticated era USING (true), así que CUALQUIER
-- sesión autenticada (incluido staff) podía leer email/teléfono/rol de TODOS los usuarios
-- internos (admins incluidos). Ahora:
--   - admin ve todas las filas (panel de usuarios admin-only),
--   - cada usuario ve su propia fila (getCurrentUser),
--   - los guías (role='guide') son visibles a admin y staff (el panel de salidas los
--     lista y embebe el guía asignado vía cliente autenticado — sin este término se
--     rompería /dashboard/departures para staff).
-- staff ya NO puede enumerar la PII de otros admin/staff.
--
-- Patrón InitPlan ((select ...)) como en 20260523000009 (se evalúa una vez por query).
-- Forward-only; revertir = recrear la política con USING (true).

DROP POLICY IF EXISTS "users_select_authenticated" ON public.users;

CREATE POLICY "users_select_authenticated" ON public.users
  FOR SELECT TO authenticated
  USING (
    (select auth.jwt() ->> 'user_role') = 'admin'
    OR id = (select auth.uid())
    OR role = 'guide'
  );
