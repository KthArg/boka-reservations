CREATE TABLE tour_schedules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id     uuid NOT NULL REFERENCES tours (id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time  time NOT NULL,
  capacity    integer NOT NULL CHECK (capacity > 0),
  valid_from  date NOT NULL DEFAULT current_date,
  valid_until date,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT unique_schedule UNIQUE (tour_id, day_of_week, start_time)
);

CREATE INDEX idx_tour_schedules_tour_active ON tour_schedules (tour_id, active);
CREATE INDEX idx_tour_schedules_day_active ON tour_schedules (day_of_week, active);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON tour_schedules
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

ALTER TABLE tour_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tour_schedules_select_authenticated" ON tour_schedules
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "tour_schedules_insert_admin" ON tour_schedules
  FOR INSERT TO authenticated
  WITH CHECK ((auth.jwt() ->> 'user_role') = 'admin');

CREATE POLICY "tour_schedules_update_admin" ON tour_schedules
  FOR UPDATE TO authenticated
  USING ((auth.jwt() ->> 'user_role') = 'admin');

CREATE POLICY "tour_schedules_delete_admin" ON tour_schedules
  FOR DELETE TO authenticated
  USING ((auth.jwt() ->> 'user_role') = 'admin');
