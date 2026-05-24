-- Auth hook: inyecta user_role como custom claim en cada JWT generado por Supabase.
-- Después de aplicar esta migración, registrar manualmente en Supabase Dashboard:
--   Authentication → Hooks → Custom Access Token → public.custom_access_token_hook
-- Local: http://127.0.0.1:54323 → Authentication → Hooks
-- Ver: docs/ops/supabase-hooks.md

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claims      jsonb;
  role_value  text;
BEGIN
  BEGIN
    SELECT role::text INTO role_value
    FROM public.users
    WHERE id = (event->>'user_id')::uuid;
  EXCEPTION WHEN OTHERS THEN
    role_value := NULL;
  END;

  claims := event->'claims';

  IF role_value IS NOT NULL THEN
    claims := jsonb_set(claims, '{user_role}', to_jsonb(role_value));
  END IF;

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT SELECT ON TABLE public.users TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;
