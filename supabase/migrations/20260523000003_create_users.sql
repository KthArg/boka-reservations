CREATE TABLE users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text UNIQUE NOT NULL,
  role       user_role NOT NULL DEFAULT 'staff',
  full_name  text NOT NULL,
  phone      text,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT guide_requires_phone CHECK (role != 'guide' OR phone IS NOT NULL)
);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_select_authenticated" ON users
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "users_insert_admin" ON users
  FOR INSERT TO authenticated
  WITH CHECK ((auth.jwt() ->> 'user_role') = 'admin');

CREATE POLICY "users_update_admin_or_self" ON users
  FOR UPDATE TO authenticated
  USING (
    (auth.jwt() ->> 'user_role') = 'admin'
    OR id = auth.uid()
  );

CREATE POLICY "users_delete_admin" ON users
  FOR DELETE TO authenticated
  USING ((auth.jwt() ->> 'user_role') = 'admin');
