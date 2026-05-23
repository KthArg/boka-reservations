CREATE TABLE tours (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             text UNIQUE NOT NULL,
  name_es          text NOT NULL,
  name_en          text NOT NULL,
  description_es   text NOT NULL,
  description_en   text NOT NULL,
  difficulty       text NOT NULL CHECK (difficulty IN ('easy', 'moderate', 'hard')),
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
  meeting_point_es text NOT NULL,
  meeting_point_en text NOT NULL,
  includes_es      text NOT NULL,
  includes_en      text NOT NULL,
  min_participants integer NOT NULL DEFAULT 1 CHECK (min_participants >= 1),
  max_capacity     integer NOT NULL CHECK (max_capacity >= min_participants),
  cover_image_url  text,
  status           tour_status NOT NULL DEFAULT 'active',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tours_status ON tours (status);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON tours
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

ALTER TABLE tours ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tours_select_authenticated" ON tours
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "tours_insert_admin" ON tours
  FOR INSERT TO authenticated
  WITH CHECK ((auth.jwt() ->> 'user_role') = 'admin');

CREATE POLICY "tours_update_admin" ON tours
  FOR UPDATE TO authenticated
  USING ((auth.jwt() ->> 'user_role') = 'admin');

CREATE POLICY "tours_delete_admin" ON tours
  FOR DELETE TO authenticated
  USING ((auth.jwt() ->> 'user_role') = 'admin');
