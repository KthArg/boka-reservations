CREATE TABLE tour_pricing (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id      uuid NOT NULL REFERENCES tours (id) ON DELETE CASCADE,
  ticket_type  ticket_type NOT NULL,
  price_usd    numeric(10, 2) NOT NULL CHECK (price_usd >= 0),
  season_label text,
  valid_from   date,
  valid_until  date,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT valid_season_range CHECK (
    (valid_from IS NULL AND valid_until IS NULL)
    OR (valid_from IS NOT NULL AND valid_until IS NOT NULL AND valid_from < valid_until)
  ),
  CONSTRAINT season_label_required_with_dates CHECK (
    valid_from IS NULL OR season_label IS NOT NULL
  )
);

CREATE INDEX idx_tour_pricing_tour_ticket_active ON tour_pricing (tour_id, ticket_type, active);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON tour_pricing
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

ALTER TABLE tour_pricing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tour_pricing_select_authenticated" ON tour_pricing
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "tour_pricing_insert_admin" ON tour_pricing
  FOR INSERT TO authenticated
  WITH CHECK ((auth.jwt() ->> 'user_role') = 'admin');

CREATE POLICY "tour_pricing_update_admin" ON tour_pricing
  FOR UPDATE TO authenticated
  USING ((auth.jwt() ->> 'user_role') = 'admin');

CREATE POLICY "tour_pricing_delete_admin" ON tour_pricing
  FOR DELETE TO authenticated
  USING ((auth.jwt() ->> 'user_role') = 'admin');
