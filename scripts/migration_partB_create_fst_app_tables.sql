-- ==============================================================
-- PART B — Run this in eXodus project SQL Editor
-- Project: eXodus (qbexqpvzmssmifimlfos)
-- Schema:  fst_app
--
-- SAFE TO RE-RUN: uses CREATE TABLE IF NOT EXISTS throughout.
-- If tables already exist they are left untouched.
-- ==============================================================

-- ── 0. Create schema ──────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS fst_app;
SET search_path = fst_app, public;

-- ── 1. customers ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fst_app.customers (
  row_id          text PRIMARY KEY,
  customer        text,
  customer_logo   text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- ── 2. districts ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fst_app.districts (
  row_id                  text PRIMARY KEY,
  customer_district_id    text,
  customer_district       text,
  customer_address        text,
  district_contact        text,
  customer_email          text,
  customer_phone_number   text,
  customer                text REFERENCES fst_app.customers(row_id) ON DELETE SET NULL,
  customer_logo           text,
  customer_name           text,
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now()
);

-- ── 3. fieldvisits ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fst_app.fieldvisits (
  field_visit_id          text PRIMARY KEY,
  xc_rep                  text,
  customer                text,
  customer_district       text,
  visit_purpose           text,
  arrival_date            timestamptz,
  departure_date          timestamptz,
  visit_notes             text,
  activities              jsonb,
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now()
);

-- ── 4. incidents ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fst_app.incidents (
  event_id                text PRIMARY KEY,
  xc_rep                  text,
  customer                text,
  customer_district       text,
  date_incident           date,
  incident_type           text,
  incident_severity       text,
  incident_status         text,
  xc_caused               text,
  incident_description    text,
  incident_notes          text,
  actions_taken           text,
  field_visit_id          text,
  reviewed_by             text,
  reviewed_at             timestamptz,
  ai_summary              text,
  report_generated_at     timestamptz,
  report_generated_by     text,
  report_url              text,
  qc_pallet_id            text,
  qc_build_no             text,
  report_sent_to          text,
  report_sent_by          text,
  report_sent_message     text,
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now()
);

-- ── 5. panels ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fst_app.panels (
  row_id                  text PRIMARY KEY,
  panel_id                text,
  serial_number           text,
  panel_status            text,
  customer                text,
  customer_district       text,
  verified                text,
  install_date            date,
  last_service_date       date,
  notes                   text,
  activity                jsonb,
  returned_date           date,
  return_notes            text,
  return_confirmed_by     text,
  last_seen_date          timestamptz,
  last_seen_by            text,
  last_seen_visit_id      text,
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now()
);

-- ── 6. kv_store_64775d98 ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS fst_app.kv_store_64775d98 (
  key                     text PRIMARY KEY,
  value                   jsonb,
  updated_at              timestamptz DEFAULT now()
);

-- ── 7. incident_updates ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS fst_app.incident_updates (
  row_id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id                text,
  incident_id             text,
  update_type             text,
  note                    text NOT NULL,
  created_by              text,
  created_at              timestamptz DEFAULT now()
);

-- ── 8. qc_pallets ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fst_app.qc_pallets (
  row_id          text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  build_no        text,
  customer        text,
  destination     text,
  load_type       text DEFAULT 'loaded' CHECK (load_type IN ('loaded','unloaded')),
  guns_total      integer DEFAULT 0,
  guns_in_pallet  integer,
  sample_size     integer,
  sales_order     text,
  fulfillment_id  text,
  operator        text,
  status          text DEFAULT 'open' CHECK (status IN ('open','in_progress','passed','failed')),
  signed_off_by   text,
  signed_off_at   timestamptz,
  notes           text,
  updated_by      text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- ── 9. qc_guns ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fst_app.qc_guns (
  row_id          text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  pallet_row_id   text NOT NULL REFERENCES fst_app.qc_pallets(row_id) ON DELETE CASCADE,
  gun_index       integer NOT NULL,
  serial          text,
  result          text DEFAULT 'pending' CHECK (result IN ('pending','pass','fail')),
  inspected_by    text,
  inspected_at    timestamptz,
  notes           text,
  created_at      timestamptz DEFAULT now()
);

-- ── 10. qc_gun_checks ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fst_app.qc_gun_checks (
  row_id          text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  gun_row_id      text NOT NULL REFERENCES fst_app.qc_guns(row_id) ON DELETE CASCADE,
  item_key        text NOT NULL,
  state           text DEFAULT 'pass' CHECK (state IN ('pass','fail','na')),
  note            text,
  created_at      timestamptz DEFAULT now()
);

-- ── 11. driver_loads ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fst_app.driver_loads (
  row_id               text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  load_number          text,
  delivery_date        date,
  origin_district      text,
  customer             text,
  customer_district    text,
  destination          text,
  packing_slip_no      text,
  mode_of_delivery     text,
  trailer_connected    boolean DEFAULT false,
  driver_type          text DEFAULT 'internal',
  driver               text,
  driver_name          text,
  driver_company       text,
  hazmat_load          boolean DEFAULT false,
  hardware_present     boolean DEFAULT false,
  ancillary_explosives boolean DEFAULT false,
  explosive_types      text[] DEFAULT '{}',
  document_correlation boolean DEFAULT false,
  items_secure         boolean DEFAULT false,
  driver_sig_url       text,
  inspector_name       text,
  inspector_sig_url    text,
  manager_name         text,
  manager_sig_url      text,
  status               text DEFAULT 'draft',
  departed_by          text,
  departed_at          timestamptz,
  notes                text,
  updated_by           text,
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now()
);

-- ── 12. driver_load_items ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS fst_app.driver_load_items (
  row_id               text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  load_row_id          text NOT NULL REFERENCES fst_app.driver_loads(row_id) ON DELETE CASCADE,
  pallet_build_no      text,
  description          text,
  qty_expected         integer DEFAULT 0,
  qty_loaded           integer DEFAULT 0,
  destination          text,
  checked              boolean DEFAULT false,
  note                 text,
  source_pallet_row_id text REFERENCES fst_app.qc_pallets(row_id) ON DELETE SET NULL,
  created_at           timestamptz DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_fst_incidents_date         ON fst_app.incidents (date_incident);
CREATE INDEX IF NOT EXISTS idx_fst_incidents_reviewed_at  ON fst_app.incidents (reviewed_at);
CREATE INDEX IF NOT EXISTS idx_fst_incident_updates_event ON fst_app.incident_updates (event_id);
CREATE INDEX IF NOT EXISTS idx_fst_incident_updates_inc   ON fst_app.incident_updates (incident_id);
CREATE INDEX IF NOT EXISTS idx_fst_qc_guns_pallet         ON fst_app.qc_guns (pallet_row_id);
CREATE INDEX IF NOT EXISTS idx_fst_qc_gun_checks_gun      ON fst_app.qc_gun_checks (gun_row_id);
CREATE INDEX IF NOT EXISTS idx_fst_qc_pallets_sales_order ON fst_app.qc_pallets (sales_order);
CREATE INDEX IF NOT EXISTS idx_fst_driver_load_items_load ON fst_app.driver_load_items (load_row_id);
CREATE INDEX IF NOT EXISTS idx_fst_driver_loads_status    ON fst_app.driver_loads (status);

-- ── Row Level Security ────────────────────────────────────────
ALTER TABLE fst_app.customers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE fst_app.districts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE fst_app.fieldvisits        ENABLE ROW LEVEL SECURITY;
ALTER TABLE fst_app.incidents          ENABLE ROW LEVEL SECURITY;
ALTER TABLE fst_app.panels             ENABLE ROW LEVEL SECURITY;
ALTER TABLE fst_app.kv_store_64775d98  ENABLE ROW LEVEL SECURITY;
ALTER TABLE fst_app.incident_updates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE fst_app.qc_pallets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE fst_app.qc_guns            ENABLE ROW LEVEL SECURITY;
ALTER TABLE fst_app.qc_gun_checks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE fst_app.driver_loads       ENABLE ROW LEVEL SECURITY;
ALTER TABLE fst_app.driver_load_items  ENABLE ROW LEVEL SECURITY;

-- RLS policies (read/write for authenticated, read for anon)
DO $$ 
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'customers','districts','fieldvisits','incidents','panels',
    'kv_store_64775d98','incident_updates','qc_pallets','qc_guns',
    'qc_gun_checks','driver_loads','driver_load_items'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %1$I ON fst_app.%2$I; CREATE POLICY %1$I ON fst_app.%2$I FOR SELECT TO anon, authenticated USING (true);', tbl||'_select', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %1$I ON fst_app.%2$I; CREATE POLICY %1$I ON fst_app.%2$I FOR INSERT TO authenticated WITH CHECK (true);', tbl||'_insert', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %1$I ON fst_app.%2$I; CREATE POLICY %1$I ON fst_app.%2$I FOR UPDATE TO authenticated USING (true);', tbl||'_update', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %1$I ON fst_app.%2$I; CREATE POLICY %1$I ON fst_app.%2$I FOR DELETE TO authenticated USING (true);', tbl||'_delete', tbl);
  END LOOP;
END $$;


-- ── Grants ────────────────────────────────────────────────────
GRANT USAGE  ON SCHEMA fst_app TO anon, authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA fst_app TO anon, authenticated;
GRANT ALL    ON ALL TABLES IN SCHEMA fst_app TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA fst_app GRANT SELECT ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA fst_app GRANT ALL    ON TABLES TO service_role;

-- ── Verify ────────────────────────────────────────────────────
SELECT table_name, table_type
FROM information_schema.tables
WHERE table_schema = 'fst_app'
ORDER BY table_name;
