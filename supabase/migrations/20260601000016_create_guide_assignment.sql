-- Migration: tour_instance_guides + guide_access_tokens
-- Spec: 0009-gestion-asignacion-guias
--
-- Relación instancia<->guía y tokens de acceso del magic link del guía.

-- ----------------------------------------------------------------
-- tour_instance_guides
-- Tabla puente entre tour_instances y users (role='guide').
-- El MVP opera con un guía por instancia (lo garantiza la capa de
-- aplicación: la Server Action borra la asignación previa antes de
-- insertar). La tabla puente deja la puerta abierta a multi-guía sin
-- migración futura.
-- ----------------------------------------------------------------
CREATE TABLE public.tour_instance_guides (
  tour_instance_id uuid        NOT NULL REFERENCES public.tour_instances(id) ON DELETE CASCADE,
  guide_id         uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  assigned_at      timestamptz NOT NULL DEFAULT NOW(),
  assigned_by      uuid        REFERENCES public.users(id),
  PRIMARY KEY (tour_instance_id, guide_id)
);

-- Consulta caliente: "próximas salidas del guía X".
CREATE INDEX tour_instance_guides_guide_idx
  ON public.tour_instance_guides (guide_id);

ALTER TABLE public.tour_instance_guides ENABLE ROW LEVEL SECURITY;

-- Lectura para el panel (admin/staff). La vista pública del guía no usa
-- RLS: lee server-side con service_role tras validar el token.
CREATE POLICY tour_instance_guides_select_panel
  ON public.tour_instance_guides
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.jwt() ->> 'user_role') IN ('admin', 'staff'));

-- Writes los hace la Server Action con service_role.

-- ----------------------------------------------------------------
-- guide_access_tokens
-- Token propio (NO Supabase Auth) para el magic link del guía. Se guarda
-- solo el hash SHA-256; el texto plano viaja únicamente en el email.
-- Un token por guía, válido 30 días. Lo gestiona el server con service_role.
-- ----------------------------------------------------------------
CREATE TABLE public.guide_access_tokens (
  id           uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  guide_id     uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash   text        NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT NOW(),
  last_used_at timestamptz
);

-- Buscar el token vigente de un guía al momento de asignar.
CREATE INDEX guide_access_tokens_guide_idx
  ON public.guide_access_tokens (guide_id, expires_at);

ALTER TABLE public.guide_access_tokens ENABLE ROW LEVEL SECURITY;
-- Sin políticas: solo service_role accede. Nunca se expone a clientes.
