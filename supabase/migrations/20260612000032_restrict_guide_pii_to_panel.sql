-- Migration: restringe la lectura de filas de guías a sesiones del panel (spec 0020, M-1(B))
--
-- HALLAZGO (4ta auditoría, 2026-06-12) — MEDIA. La política users_select_authenticated
-- (migración 20260611000026, B-4) expone TODA fila role='guide' a CUALQUIER sesión
-- `authenticated`, no solo a admin/staff:
--
--   USING ( user_role='admin' OR id=auth.uid() OR role='guide' )
--
-- El término `OR role='guide'` (sin condición sobre el rol del LECTOR) hace world-readable
-- la PII de los guías (nombre, email, teléfono) para cualquier principal autenticado.
-- Combinado con el auto-registro de Supabase Auth (M-1(A), cerrado en config.toml), un
-- atacante anónimo podía: POST /auth/v1/signup -> sesión authenticated sin user_role ->
-- GET /rest/v1/users?role=eq.guide -> leer la PII de los guías vía PostgREST. Verificado en
-- vivo en la auditoría.
--
-- FIX: el término de guía se condiciona al rol del lector. Se conservan EXACTAMENTE los tres
-- accesos legítimos y se cierra el único ilegítimo:
--   - admin ve todas las filas                          -> user_role='admin'
--   - cada usuario ve su propia fila                    -> id=auth.uid()
--   - admin/staff ven guías (panel de salidas, lee con  -> role='guide' AND user_role IN
--     sesión autenticada, web/lib/guides/repository.ts)     ('admin','staff')
--
-- POR QUÉ NO ROMPE NADA: el único consumidor que lee `users` como `authenticated` es el panel
-- (admin/staff). La vista pública del guía (getGuideUpcomingTours) usa service_role (bypassa
-- RLS) tras validar el token, así que no depende de esta política. Un eventual guía con login
-- propio vería solo su fila (id=auth.uid()) — mejora respecto del estado actual.
--
-- Patrón InitPlan ((select auth.jwt() ...)) como el resto de las políticas (se evalúa una vez
-- por query). Forward-only; revertir = recrear la política con el `OR role='guide'` amplio.

DROP POLICY IF EXISTS "users_select_authenticated" ON public.users;

CREATE POLICY "users_select_authenticated" ON public.users
  FOR SELECT TO authenticated
  USING (
    (select auth.jwt() ->> 'user_role') = 'admin'
    OR id = (select auth.uid())
    OR (
      role = 'guide'
      AND (select auth.jwt() ->> 'user_role') IN ('admin', 'staff')
    )
  );
