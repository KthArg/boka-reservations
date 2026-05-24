-- Migration: create tour_instances + RLS anon policies para el portal público
-- Spec: 0004-portal-publico-tours

-- Tabla de instancias concretas de tours (generadas desde tour_schedules)
CREATE TABLE public.tour_instances (
  id               uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tour_id          uuid        NOT NULL REFERENCES public.tours(id) ON DELETE CASCADE,
  schedule_id      uuid        NOT NULL REFERENCES public.tour_schedules(id) ON DELETE CASCADE,
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  capacity_total   integer     NOT NULL CHECK (capacity_total > 0),
  capacity_reserved integer    NOT NULL DEFAULT 0 CHECK (capacity_reserved >= 0),
  status           text        NOT NULL DEFAULT 'available'
                               CHECK (status IN ('available', 'full', 'cancelled')),
  created_at       timestamptz NOT NULL DEFAULT NOW(),
  updated_at       timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (schedule_id, starts_at)
);

-- Índices
CREATE INDEX tour_instances_tour_starts_idx
  ON public.tour_instances (tour_id, starts_at);

CREATE INDEX tour_instances_available_idx
  ON public.tour_instances (starts_at)
  WHERE status = 'available';

-- Trigger updated_at
CREATE TRIGGER set_tour_instances_updated_at
  BEFORE UPDATE ON public.tour_instances
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.tour_instances ENABLE ROW LEVEL SECURITY;

-- anon: solo instancias disponibles y futuras
CREATE POLICY tour_instances_select_anon
  ON public.tour_instances
  FOR SELECT
  TO anon
  USING (status = 'available' AND starts_at > NOW());

-- authenticated: puede leer todas
CREATE POLICY tour_instances_select_authenticated
  ON public.tour_instances
  FOR SELECT
  TO authenticated
  USING (true);

-- service_role maneja writes (job usa service_role)

-- Grants de lectura para anon y authenticated
GRANT SELECT ON public.tour_instances TO anon;
GRANT SELECT ON public.tour_instances TO authenticated;

-- ----------------------------------------------------------------
-- RLS anon en tablas existentes (portal público sin auth)
-- ----------------------------------------------------------------

-- tours: anon puede leer tours activos
CREATE POLICY tours_select_anon
  ON public.tours
  FOR SELECT
  TO anon
  USING (status = 'active');

GRANT SELECT ON public.tours TO anon;

-- tour_pricing: anon puede leer todos los precios
CREATE POLICY tour_pricing_select_anon
  ON public.tour_pricing
  FOR SELECT
  TO anon
  USING (true);

GRANT SELECT ON public.tour_pricing TO anon;

-- tour_schedules: anon puede leer schedules activos
CREATE POLICY tour_schedules_select_anon
  ON public.tour_schedules
  FOR SELECT
  TO anon
  USING (active = true);

GRANT SELECT ON public.tour_schedules TO anon;
