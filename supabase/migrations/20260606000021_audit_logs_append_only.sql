-- 0011 (fix, Checkpoint 6): audit_logs realmente append-only.
--
-- (#8) La tabla audit_logs era "append-only" solo por convención de la capa de
-- app: nada impedía UPDATE/DELETE, y como service_role bypassa RLS, cualquier
-- ruta con esa clave podía editar o borrar la bitácora. Para una bitácora de
-- eventos sensibles (cancelaciones, movimientos de dinero) eso la hace inútil
-- como prueba. Un trigger que rechaza UPDATE y DELETE la vuelve inmutable para
-- todos los roles, incluido service_role (los triggers se disparan siempre).
--
-- Reversibilidad: forward-only. Para revertir: DROP TRIGGER ... ; DROP FUNCTION
-- public.reject_audit_logs_mutation();

CREATE OR REPLACE FUNCTION public.reject_audit_logs_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs es append-only: % no está permitido', TG_OP;
END;
$$;

CREATE TRIGGER audit_logs_block_update
  BEFORE UPDATE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.reject_audit_logs_mutation();

CREATE TRIGGER audit_logs_block_delete
  BEFORE DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.reject_audit_logs_mutation();
