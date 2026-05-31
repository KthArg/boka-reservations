-- Migration: check-in de reservas + RLS de lectura para staff/admin
-- Spec: 0008-panel-reservas-checkin
--
-- Cambios:
--   1. Columnas checked_in_at / checked_in_by en bookings (check-in a nivel reserva).
--   2. Índice parcial para agregados de la vista "Hoy".
--   3. Políticas SELECT para authenticated (admin/staff) sobre bookings,
--      payments y notifications, que hoy solo eran accesibles por service_role.
--      El panel (spec 0008) lee como usuario autenticado, no como service_role.
--
-- Reversibilidad: aditiva. Revertir = DROP de columnas/índice/políticas; no
-- destruye datos preexistentes (las columnas nacen NULL).

-- ----------------------------------------------------------------
-- 1. Columnas de check-in
-- ----------------------------------------------------------------
ALTER TABLE public.bookings
  ADD COLUMN checked_in_at timestamptz,
  ADD COLUMN checked_in_by uuid REFERENCES public.users(id);

-- ----------------------------------------------------------------
-- 2. Índice parcial: solo filas con check-in (vista "Hoy" y agregados)
-- ----------------------------------------------------------------
CREATE INDEX bookings_checked_in_idx
  ON public.bookings (checked_in_at)
  WHERE checked_in_at IS NOT NULL;

-- ----------------------------------------------------------------
-- 3. RLS: lectura para staff/admin
--    El claim user_role lo inyecta el auth hook (migración 0007).
--    Se usa (select auth.jwt() ...) para evaluación InitPlan, patrón
--    establecido en la migración 0009.
-- ----------------------------------------------------------------
CREATE POLICY bookings_select_admin_staff
  ON public.bookings
  FOR SELECT
  TO authenticated
  USING ((select auth.jwt() ->> 'user_role') IN ('admin', 'staff'));

CREATE POLICY payments_select_admin_staff
  ON public.payments
  FOR SELECT
  TO authenticated
  USING ((select auth.jwt() ->> 'user_role') IN ('admin', 'staff'));

CREATE POLICY notifications_select_admin_staff
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING ((select auth.jwt() ->> 'user_role') IN ('admin', 'staff'));

GRANT SELECT ON public.bookings TO authenticated;
GRANT SELECT ON public.payments TO authenticated;
GRANT SELECT ON public.notifications TO authenticated;
