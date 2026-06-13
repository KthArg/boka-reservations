-- Migration: agrega columnas de consentimiento a bookings (spec 0021, P1-3)
--
-- HALLAZGO (auditoría final del Security Council, PRIV-01) — La página de checkout recolecta
-- PII del turista (nombre, email) sin punto de consentimiento ni aviso de privacidad. La Ley
-- 8968 de Costa Rica (PRODHAB) exige consentimiento informado para el tratamiento de datos
-- personales. El cumplimiento legal pleno es del cliente; el sistema debe registrar la evidencia.
--
-- FIX: se registra, al crear la reserva, la fecha/hora del consentimiento y la versión del aviso
-- de privacidad que el turista aceptó (PRIVACY_NOTICE_VERSION, estampada server-side). La versión
-- permite trazar QUÉ texto consintió cada turista si el aviso cambia en el futuro.
--
-- POR QUÉ NULLABLE: el consentimiento se exige en la capa de aplicación (server action) para
-- reservas nuevas, no con un constraint de DB. Las filas previas a la feature quedan en NULL
-- (sin backfill); no se impone NOT NULL para no romperlas ni acoplar la evidencia legal al schema.
--
-- Forward-only; revertir = DROP de ambas columnas.

ALTER TABLE public.bookings
  ADD COLUMN consent_at      timestamptz NULL,
  ADD COLUMN consent_version text        NULL;
