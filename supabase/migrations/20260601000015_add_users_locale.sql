-- Migration: agrega users.locale
-- Spec: 0009-gestion-asignacion-guias
--
-- Idioma preferido del usuario interno. Determina el idioma de los emails
-- que el sistema le envía (p. ej. la asignación de una salida a un guía).
-- Default 'es' por ser personal local en Costa Rica; el admin puede cambiarlo.

ALTER TABLE public.users
  ADD COLUMN locale text NOT NULL DEFAULT 'es'
  CHECK (locale IN ('es', 'en'));
