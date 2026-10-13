-- Migración …061 — Dos tours fijos: diurno y nocturno (spec 0047).
--
--   1. tours.kind ('day' | 'night', nulo en los tours viejos), único entre las filas que lo
--      tienen. Los dos tours fijos son las dos filas con kind.
--   2. Un tour fijo no se archiva (CHECK), no cambia de kind ni de slug y no se borra (disparador,
--      para todos los roles).
--   3. Nadie crea ni borra tours por PostgREST: fuera las políticas y los grants de INSERT y
--      DELETE de authenticated. service_role conserva todo (los tests insertan tours de kind nulo).
--   4. anon lee también los tours en pausa, para que el sitio pueda mostrar el aviso.
--   5. Los tours que existan se archivan con las reglas de la acción "archivar" que se retira, y
--      se insertan los dos fijos, activos y sin horarios ni precios.
--
-- La política de anon se escribe como `status <> 'archived'` y no nombra 'paused': así esta
-- migración no usa el valor que agrega …060 y no depende de que corran en transacciones distintas.
--
-- Reversión: no basta con revertir el deploy (el panel viejo no puede crear ni archivar sobre este
-- esquema). Para volver al catálogo abierto: recrear tours_insert_admin y tours_delete_admin con
-- el cuerpo de …009, GRANT INSERT, DELETE ON public.tours TO authenticated, devolver las dos
-- ternas a la allowlist de audit_table_grants_to_public_roles, volver tours_select_anon a
-- `status = 'active'`, DROP TRIGGER tours_fixed_guard y reactivar por SQL los tours archivados. Las
-- salidas futuras que canceló el paso 5 no vuelven solas: hay que pasarlas a 'available' por SQL.
-- La columna kind, el tipo tour_kind, el índice, el CHECK y guard_fixed_tour() pueden quedar: sin
-- el disparador son inertes. Las dos filas fijas no se borran mientras exista el disparador.
--
-- Al aplicar en producción: con el worker detenido o fuera de su corrida de generate-tour-instances
-- (su upsert y este ALTER se cruzarían y uno de los dos abortaría por lock), y después de comprobar
-- que ningún tour activo tenga reservas vivas, un ciclo de cobro abierto ni un apartado en curso
-- en salidas futuras: en cualquiera de esos casos el paso 5 aborta la migración.

SET lock_timeout = '5s';

-- ================================================================
-- 1. kind
-- ================================================================
CREATE TYPE public.tour_kind AS ENUM ('day', 'night');

ALTER TABLE public.tours
  ADD COLUMN kind public.tour_kind NULL,
  ADD CONSTRAINT tours_fixed_not_archived CHECK (kind IS NULL OR status <> 'archived');

CREATE UNIQUE INDEX tours_kind_unique ON public.tours (kind) WHERE kind IS NOT NULL;

COMMENT ON COLUMN public.tours.kind IS
  'Tour fijo: day o night, uno de cada uno (spec 0047). NULL en los tours anteriores, archivados.';

-- ================================================================
-- 2. Guarda de los tours fijos
-- ================================================================
CREATE FUNCTION public.guard_fixed_tour()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'FIXED_TOUR_LOCKED'
      USING HINT = 'Un tour fijo no se borra (spec 0047)';
  END IF;
  IF NEW.kind IS DISTINCT FROM OLD.kind OR NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION 'FIXED_TOUR_LOCKED'
      USING HINT = 'Un tour fijo no cambia de kind ni de slug (spec 0047)';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.guard_fixed_tour()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER tours_fixed_guard
  BEFORE UPDATE OR DELETE ON public.tours
  FOR EACH ROW
  WHEN (OLD.kind IS NOT NULL)
  EXECUTE FUNCTION public.guard_fixed_tour();

COMMENT ON FUNCTION public.guard_fixed_tour() IS
  'Rechaza borrar un tour fijo o cambiarle kind o slug, para todos los roles (spec 0047).';

-- ================================================================
-- 3. Sin crear ni borrar tours por PostgREST
-- ================================================================
DROP POLICY "tours_insert_admin" ON public.tours;
DROP POLICY "tours_delete_admin" ON public.tours;
REVOKE INSERT, DELETE ON public.tours FROM authenticated;

-- Cuerpo vigente de …043 sin las ternas (tours, authenticated, INSERT | DELETE).
CREATE OR REPLACE FUNCTION public.audit_table_grants_to_public_roles()
RETURNS TABLE(table_name text, role_name text, privilege_type text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT g.table_name::text, g.grantee::text, g.privilege_type::text
  FROM information_schema.role_table_grants g
  WHERE g.table_schema = 'public'
    AND g.grantee IN ('anon', 'authenticated')
    -- Excluir la allowlist explícita de ternas (tabla, rol, privilegio) intencionales.
    AND NOT EXISTS (
      SELECT 1
      FROM (VALUES
        -- anon: solo SELECT en las tablas del portal público.
        ('tours',                'anon',          'SELECT'),
        ('tour_pricing',         'anon',          'SELECT'),
        ('tour_schedules',       'anon',          'SELECT'),
        ('tour_instances',       'anon',          'SELECT'),
        -- authenticated: los tours se editan, no se crean ni se borran (spec 0047).
        ('tours',                'authenticated', 'SELECT'),
        ('tours',                'authenticated', 'UPDATE'),
        ('tour_pricing',         'authenticated', 'SELECT'),
        ('tour_pricing',         'authenticated', 'INSERT'),
        ('tour_pricing',         'authenticated', 'UPDATE'),
        ('tour_pricing',         'authenticated', 'DELETE'),
        ('tour_schedules',       'authenticated', 'SELECT'),
        ('tour_schedules',       'authenticated', 'INSERT'),
        ('tour_schedules',       'authenticated', 'UPDATE'),
        ('tour_schedules',       'authenticated', 'DELETE'),
        -- authenticated: solo SELECT en el resto de las tablas de la app.
        ('tour_instances',       'authenticated', 'SELECT'),
        ('bookings',             'authenticated', 'SELECT'),
        ('payments',             'authenticated', 'SELECT'),
        ('notifications',        'authenticated', 'SELECT'),
        ('refunds',              'authenticated', 'SELECT'),
        ('users',                'authenticated', 'SELECT'),
        -- (users NO lleva UPDATE acá: el self-update de perfil es un grant de COLUMNA
        --  full_name/phone/locale, que no figura en role_table_grants — ver nota en …038.)
        ('tour_instance_guides', 'authenticated', 'SELECT'),
        -- (business_settings: el UPDATE del admin también es de COLUMNA, spec 0029.)
        ('business_settings',    'authenticated', 'SELECT')
      ) AS allow(tbl, role, priv)
      WHERE allow.tbl  = g.table_name
        AND allow.role = g.grantee
        AND allow.priv = g.privilege_type
    )
  ORDER BY 1, 2, 3;
$$;

REVOKE EXECUTE ON FUNCTION public.audit_table_grants_to_public_roles()
  FROM PUBLIC, anon, authenticated;

-- ================================================================
-- 4. anon lee los tours en pausa
-- ================================================================
-- Ojo: es una lista de exclusión. Un valor nuevo de tour_status quedaría legible por anon; quien
-- lo agregue tiene que revisar esta política.
DROP POLICY tours_select_anon ON public.tours;
CREATE POLICY tours_select_anon
  ON public.tours
  FOR SELECT
  TO anon
  USING (status <> 'archived');

-- ================================================================
-- 5. Datos: archivar lo que exista e insertar los dos fijos
-- ================================================================
-- Mismas reglas que la acción archiveTour que este spec retira: con reservas vivas en salidas
-- futuras o un ciclo de cobro abierto no se archiva. Acá eso aborta la migración, nombrando el
-- tour, para que se cierre desde el panel antes de volver a aplicarla.
DO $$
DECLARE
  v_tour record;
BEGIN
  FOR v_tour IN
    SELECT id, slug FROM public.tours WHERE status = 'active' ORDER BY created_at
  LOOP
    -- Mismo lock que toma create_hold_atomic: ningún checkout crea un apartado sobre estas
    -- salidas entre los chequeos y la cancelación (la acción lo resolvía con un re-chequeo).
    PERFORM 1 FROM public.tour_instances
      WHERE tour_id = v_tour.id AND starts_at >= now()
      FOR UPDATE;

    IF EXISTS (
      SELECT 1
      FROM public.bookings b
      JOIN public.tour_instances ti ON ti.id = b.tour_instance_id
      WHERE ti.tour_id = v_tour.id
        AND ti.starts_at >= now()
        AND b.status IN ('pending_minimum', 'pending_payment', 'confirmed')
    ) THEN
      RAISE EXCEPTION 'El tour "%" tiene reservas vivas en salidas futuras; cerralas antes de migrar (spec 0047)', v_tour.slug;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.tour_instances ti
      WHERE ti.tour_id = v_tour.id
        AND ti.starts_at >= now()
        AND ti.minimum_charge_triggered_at IS NOT NULL
        AND ti.minimum_resolved_at IS NULL
        AND ti.minimum_charge_closed_at IS NULL
    ) THEN
      RAISE EXCEPTION 'El tour "%" tiene un ciclo de cobro abierto; cerralo antes de migrar (spec 0047)', v_tour.slug;
    END IF;

    -- Un apartado vivo puede terminar en reserva (el paso 2 del cobro diferido no vuelve a mirar
    -- el tour): cancelar su salida la dejaría con una reserva viva.
    IF EXISTS (
      SELECT 1
      FROM public.tour_holds h
      JOIN public.tour_instances ti ON ti.id = h.tour_instance_id
      WHERE ti.tour_id = v_tour.id
        AND ti.starts_at >= now()
        AND ((h.status = 'active' AND h.expires_at > now()) OR h.status = 'paying')
    ) THEN
      RAISE EXCEPTION 'El tour "%" tiene un apartado en curso; reintentá en unos minutos (spec 0047)', v_tour.slug;
    END IF;

    UPDATE public.tour_instances
      SET status = 'cancelled'
      WHERE tour_id = v_tour.id AND status = 'available' AND starts_at >= now();

    UPDATE public.tours SET status = 'archived' WHERE id = v_tour.id;

    INSERT INTO public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
    VALUES ('system', NULL, 'tour.archived', 'tour', v_tour.id,
            jsonb_build_object('reason', 'fixed_tours_migration', 'slug', v_tour.slug));
  END LOOP;
END;
$$;

-- Nacen activos (decisión del usuario al aprobar el spec): sin horarios ni precios el sitio los
-- muestra sin fechas reservables. Los textos son provisionales; el admin los reemplaza en el panel.
-- ON CONFLICT cubre el índice de kind, no el UNIQUE de slug: un tour viejo con slug 'day' o 'night'
-- abortaría el INSERT con 23505 (no existe ninguno en producción).
INSERT INTO public.tours (
  kind, slug, name_es, name_en, description_es, description_en, difficulty, duration_minutes,
  meeting_point_es, meeting_point_en, includes_es, includes_en, min_participants, max_capacity,
  status
) VALUES
  ('day', 'day', 'Tour diurno', 'Day tour',
   'Recorrido guiado de día. Pronto publicamos los detalles.',
   'Guided daytime tour. Details coming soon.',
   'easy', 120, 'Por confirmar', 'To be confirmed', 'Por confirmar', 'To be confirmed',
   1, 10, 'active'),
  ('night', 'night', 'Tour nocturno', 'Night tour',
   'Recorrido guiado de noche. Pronto publicamos los detalles.',
   'Guided night tour. Details coming soon.',
   'easy', 120, 'Por confirmar', 'To be confirmed', 'Por confirmar', 'To be confirmed',
   1, 10, 'active')
ON CONFLICT (kind) WHERE kind IS NOT NULL DO NOTHING;
