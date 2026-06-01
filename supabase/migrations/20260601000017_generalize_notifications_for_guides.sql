-- Migration: generaliza notifications para soportar el email de asignación al guía
-- Spec: 0009-gestion-asignacion-guias
--
-- Hasta ahora notifications era booking-céntrica (toda fila referencia un
-- booking). El email de asignación de guía no tiene booking: refiere a una
-- tour_instance + un guía. Se generaliza la tabla manteniendo retrocompat:
-- las filas existentes tienen booking_id no nulo y siguen siendo válidas.

-- booking_id deja de ser obligatorio.
ALTER TABLE public.notifications
  ALTER COLUMN booking_id DROP NOT NULL;

-- Referencias del nuevo tipo de notificación.
ALTER TABLE public.notifications
  ADD COLUMN tour_instance_id uuid REFERENCES public.tour_instances(id) ON DELETE CASCADE,
  ADD COLUMN guide_id         uuid REFERENCES public.users(id) ON DELETE CASCADE;

-- Extiende el conjunto de kinds permitidos.
ALTER TABLE public.notifications
  DROP CONSTRAINT notifications_kind_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('booking_confirmation', 'reminder_24h', 'guide_assignment'));

-- Coherencia: una notificación de guía refiere a (instancia, guía) y NO a un
-- booking; las demás (booking_confirmation, reminder_24h) sí refieren a booking.
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_target_coherence
  CHECK (
    (kind = 'guide_assignment'
      AND tour_instance_id IS NOT NULL AND guide_id IS NOT NULL AND booking_id IS NULL)
    OR
    (kind <> 'guide_assignment' AND booking_id IS NOT NULL)
  );

-- Se conserva el UNIQUE(booking_id, kind) original: con booking_id nullable,
-- los NULL son distintos (NULLS DISTINCT por defecto), así que las filas de
-- guía no colisionan entre sí y `confirm_booking` sigue usando su
-- `ON CONFLICT (booking_id, kind)` sin cambios (un índice parcial NO sirve
-- como arbiter de ese ON CONFLICT). La unicidad de la asignación de guía la
-- aporta un índice único parcial propio.
CREATE UNIQUE INDEX notifications_assignment_uniq
  ON public.notifications (tour_instance_id, guide_id, kind)
  WHERE kind = 'guide_assignment';
