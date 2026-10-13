-- Migración …060 — Estado "en pausa" de un tour (spec 0047).
--
-- Va sola: Postgres no deja usar un valor de enum en la misma transacción que lo agrega, y …061
-- no debe depender de cómo agrupe las migraciones quien las aplique.
--
-- Reversión: no hay. Un valor de enum no se puede quitar; sin filas que lo usen es inerte.

ALTER TYPE public.tour_status ADD VALUE IF NOT EXISTS 'paused';
