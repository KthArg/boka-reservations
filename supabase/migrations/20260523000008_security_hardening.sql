-- 1. Deshabilitar acceso al API GraphQL.
--    Este proyecto usa únicamente PostgREST (REST API). Revocar USAGE en
--    graphql_public elimina la superficie de ataque de introspección GraphQL
--    sin afectar ninguna funcionalidad existente.
REVOKE USAGE ON SCHEMA graphql_public FROM anon, authenticated;

-- 2. Fijar search_path en trigger_set_updated_at.
--    Sin SET search_path, un actor con permisos para crear objetos en otros
--    schemas podría hacer que la función resuelva now() u otras funciones
--    hacia versiones maliciosas. Con search_path = '' solo se accede a
--    funciones completamente calificadas o built-ins del sistema.
CREATE OR REPLACE FUNCTION public.trigger_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
