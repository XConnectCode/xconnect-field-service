-- ============================================================
-- FST APP PRODUCTION MIGRATION
-- Creates fst_app schema and syncs it with public schema data
-- Run this in FST APP (gbllxumuogsncoiaksum) SQL Editor
-- ============================================================

-- STEP 1: Create the fst_app schema
CREATE SCHEMA IF NOT EXISTS fst_app;

-- ============================================================
-- STEP 2: Create views in fst_app that alias the public tables
-- These allow the edge function (which uses fst_app schema)
-- to query the existing production data stored in public schema.
-- ============================================================

-- customers
CREATE OR REPLACE VIEW fst_app.customers AS
SELECT * FROM public.customers;

-- districts
CREATE OR REPLACE VIEW fst_app.districts AS
SELECT * FROM public.districts;

-- fieldvisits
CREATE OR REPLACE VIEW fst_app.fieldvisits AS
SELECT * FROM public.fieldvisits;

-- incidents
CREATE OR REPLACE VIEW fst_app.incidents AS
SELECT * FROM public.incidents;

-- panels
CREATE OR REPLACE VIEW fst_app.panels AS
SELECT * FROM public.panels;

-- kv_store
CREATE OR REPLACE VIEW fst_app.kv_store_64775d98 AS
SELECT * FROM public.kv_store_64775d98;

-- ============================================================
-- STEP 3: Grant permissions on fst_app schema
-- ============================================================
GRANT USAGE ON SCHEMA fst_app TO anon, authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA fst_app TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA fst_app TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA fst_app GRANT SELECT ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA fst_app GRANT ALL ON TABLES TO service_role;

-- ============================================================
-- STEP 4: Add missing columns to incidents (if not present)
-- ============================================================
ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS reviewed_by text;
ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS ai_summary text;
ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS report_generated_at timestamptz;
ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS report_generated_by text;
ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS report_url text;
ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS qc_pallet_id text;
ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS qc_build_no text;
ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS report_sent_to text;
ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS report_sent_by text;
ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS report_sent_message text;

-- ============================================================
-- STEP 5: Add missing columns to panels (if not present)
-- ============================================================
ALTER TABLE public.panels ADD COLUMN IF NOT EXISTS activity jsonb;
ALTER TABLE public.panels ADD COLUMN IF NOT EXISTS returned_date date;
ALTER TABLE public.panels ADD COLUMN IF NOT EXISTS return_notes text;
ALTER TABLE public.panels ADD COLUMN IF NOT EXISTS return_confirmed_by text;
ALTER TABLE public.panels ADD COLUMN IF NOT EXISTS last_seen_date timestamptz;
ALTER TABLE public.panels ADD COLUMN IF NOT EXISTS last_seen_by text;
ALTER TABLE public.panels ADD COLUMN IF NOT EXISTS last_seen_visit_id text;

-- ============================================================
-- STEP 6: Create incident_updates table (director review)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.incident_updates (
  row_id      uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id    text,
  incident_id text,
  update_type text,
  note        text NOT NULL,
  created_by  text,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incident_updates_event    ON public.incident_updates (event_id);
CREATE INDEX IF NOT EXISTS idx_incident_updates_incident ON public.incident_updates (incident_id);
CREATE INDEX IF NOT EXISTS idx_incidents_date            ON public.incidents (date_incident);
CREATE INDEX IF NOT EXISTS idx_incidents_reviewed_at     ON public.incidents (reviewed_at);

ALTER TABLE public.incident_updates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'incident_updates' AND policyname = 'incident_updates_read') THEN
    CREATE POLICY incident_updates_read  ON public.incident_updates FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'incident_updates' AND policyname = 'incident_updates_write') THEN
    CREATE POLICY incident_updates_write ON public.incident_updates FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
END $$;

-- Mirror in fst_app schema
CREATE OR REPLACE VIEW fst_app.incident_updates AS
SELECT * FROM public.incident_updates;

-- ============================================================
-- STEP 7: Create QC tables
-- ============================================================
CREATE TABLE IF NOT EXISTS public.qc_pallets (
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

CREATE TABLE IF NOT EXISTS public.qc_guns (
  row_id          text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  pallet_row_id   text NOT NULL REFERENCES public.qc_pallets(row_id) ON DELETE CASCADE,
  gun_index       integer NOT NULL,
  serial          text,
  result          text DEFAULT 'pending' CHECK (result IN ('pending','pass','fail')),
  inspected_by    text,
  inspected_at    timestamptz,
  notes           text,
  created_at      timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.qc_gun_checks (
  row_id          text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  gun_row_id      text NOT NULL REFERENCES public.qc_guns(row_id) ON DELETE CASCADE,
  item_key        text NOT NULL,
  state           text DEFAULT 'pass' CHECK (state IN ('pass','fail','na')),
  note            text,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qc_guns_pallet_idx     ON public.qc_guns(pallet_row_id);
CREATE INDEX IF NOT EXISTS qc_gun_checks_gun_idx  ON public.qc_gun_checks(gun_row_id);
CREATE INDEX IF NOT EXISTS qc_pallets_sales_order_idx ON public.qc_pallets(sales_order);

ALTER TABLE public.qc_pallets    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qc_guns       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qc_gun_checks ENABLE ROW LEVEL SECURITY;

-- Mirror in fst_app schema
CREATE OR REPLACE VIEW fst_app.qc_pallets    AS SELECT * FROM public.qc_pallets;
CREATE OR REPLACE VIEW fst_app.qc_guns       AS SELECT * FROM public.qc_guns;
CREATE OR REPLACE VIEW fst_app.qc_gun_checks AS SELECT * FROM public.qc_gun_checks;

-- ============================================================
-- STEP 8: Create driver loads tables
-- ============================================================
CREATE TABLE IF NOT EXISTS public.driver_loads (
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

CREATE TABLE IF NOT EXISTS public.driver_load_items (
  row_id               text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  load_row_id          text NOT NULL REFERENCES public.driver_loads(row_id) ON DELETE CASCADE,
  pallet_build_no      text,
  description          text,
  qty_expected         integer DEFAULT 0,
  qty_loaded           integer DEFAULT 0,
  destination          text,
  checked              boolean DEFAULT false,
  note                 text,
  source_pallet_row_id text REFERENCES public.qc_pallets(row_id) ON DELETE SET NULL,
  created_at           timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_driver_load_items_load ON public.driver_load_items(load_row_id);
CREATE INDEX IF NOT EXISTS idx_driver_loads_status    ON public.driver_loads(status);

ALTER TABLE public.driver_loads      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_load_items ENABLE ROW LEVEL SECURITY;

-- Mirror in fst_app schema
CREATE OR REPLACE VIEW fst_app.driver_loads      AS SELECT * FROM public.driver_loads;
CREATE OR REPLACE VIEW fst_app.driver_load_items AS SELECT * FROM public.driver_load_items;

-- ============================================================
-- STEP 9: KPI/Analytics Views in fst_app schema
-- ============================================================

-- districts_with_customer_name (helper view)
CREATE OR REPLACE VIEW fst_app.districts_with_customer_name AS
SELECT
  d.row_id,
  d.customer_district_id,
  d.customer_district,
  d.customer_address,
  d.district_contact,
  d.customer_email,
  d.customer_phone_number,
  d.customer,
  d.customer_logo,
  COALESCE(d.customer_name, c.customer) AS customer_name
FROM public.districts d
LEFT JOIN public.customers c ON c.row_id = d.customer;

-- Also create in public if it doesn't exist
CREATE OR REPLACE VIEW public.districts_with_customer_name AS
SELECT
  d.row_id,
  d.customer_district_id,
  d.customer_district,
  d.customer_address,
  d.district_contact,
  d.customer_email,
  d.customer_phone_number,
  d.customer,
  d.customer_logo,
  COALESCE(d.customer_name, c.customer) AS customer_name
FROM public.districts d
LEFT JOIN public.customers c ON c.row_id = d.customer;

-- v_dashboard_summary
CREATE OR REPLACE VIEW fst_app.v_dashboard_summary AS
SELECT
  count(DISTINCT fv.field_visit_id)                                                              AS total_visits,
  round(sum(EXTRACT(epoch FROM fv.departure_date - fv.arrival_date) / 3600::numeric), 0)         AS total_visit_hours,
  count(DISTINCT i.event_id)                                                                     AS total_incidents,
  count(DISTINCT CASE WHEN i.incident_status = 'New' THEN i.event_id ELSE NULL END)              AS open_incidents,
  ( SELECT count(*) FROM public.panels)                                                          AS total_xfire_panels,
  ( SELECT count(*) FROM public.panels WHERE panel_status = 'Leased')                           AS leased_xfire_panels,
  ( SELECT count(*) FROM public.panels WHERE verified = 'Y')                                    AS total_verified_panels,
  ( SELECT count(*) FROM public.panels WHERE panel_status = 'Leased' AND verified = 'Y')        AS leased_verified_panels
FROM public.fieldvisits fv
FULL JOIN public.incidents i ON false;

-- v_incident_trend_monthly
CREATE OR REPLACE VIEW fst_app.v_incident_trend_monthly AS
SELECT
  date_trunc('month', date_incident)::date          AS month,
  COUNT(*)                                          AS total_incidents,
  COUNT(*) FILTER (WHERE xc_caused = 'Yes')         AS xc_caused_incidents,
  COUNT(*) FILTER (WHERE incident_severity = 'Critical') AS critical_incidents,
  COUNT(*) FILTER (WHERE incident_status = 'Closed')    AS closed_incidents,
  COUNT(*) FILTER (WHERE incident_status <> 'Closed')   AS open_incidents
FROM public.incidents
WHERE date_incident IS NOT NULL
GROUP BY 1
ORDER BY 1;

-- v_incident_open_aging
CREATE OR REPLACE VIEW fst_app.v_incident_open_aging AS
WITH open_inc AS (
  SELECT
    event_id,
    incident_severity,
    xc_caused,
    reviewed_at,
    (CURRENT_DATE - date_incident) AS age_days
  FROM public.incidents
  WHERE incident_status <> 'Closed'
    AND date_incident IS NOT NULL
)
SELECT
  CASE
    WHEN age_days <= 7  THEN '0-7 days'
    WHEN age_days <= 30 THEN '8-30 days'
    WHEN age_days <= 90 THEN '31-90 days'
    ELSE '90+ days'
  END AS age_bucket,
  CASE
    WHEN age_days <= 7  THEN 1
    WHEN age_days <= 30 THEN 2
    WHEN age_days <= 90 THEN 3
    ELSE 4
  END AS bucket_order,
  COUNT(*)                                                  AS open_count,
  COUNT(*) FILTER (WHERE xc_caused = 'Yes')                AS xc_caused_count,
  COUNT(*) FILTER (WHERE incident_severity = 'Critical')    AS critical_count,
  COUNT(*) FILTER (WHERE reviewed_at IS NULL)              AS unreviewed_count
FROM open_inc
GROUP BY 1, 2
ORDER BY 2;

-- v_exec_customer_incidents
CREATE OR REPLACE VIEW fst_app.v_exec_customer_incidents AS
WITH inc AS (
  SELECT customer AS customer_id,
         COUNT(*)                                   AS total_incidents,
         COUNT(*) FILTER (WHERE xc_caused = 'Yes') AS xc_caused_incidents
  FROM public.incidents
  WHERE customer IS NOT NULL
  GROUP BY customer
)
SELECT
  c.row_id                             AS customer_id,
  c.customer                           AS customer_name,
  COALESCE(inc.total_incidents, 0)     AS total_incidents,
  COALESCE(inc.xc_caused_incidents, 0) AS xc_caused_incidents
FROM public.customers c
LEFT JOIN inc ON inc.customer_id = c.row_id
WHERE COALESCE(inc.total_incidents, 0) > 0;

-- v_exec_district_incidents
CREATE OR REPLACE VIEW fst_app.v_exec_district_incidents AS
WITH inc AS (
  SELECT customer_district AS district_id,
         COUNT(*)                                  AS total_incidents,
         COUNT(*) FILTER (WHERE xc_caused = 'Yes') AS xc_caused_incidents
  FROM public.incidents
  WHERE customer_district IS NOT NULL
  GROUP BY customer_district
)
SELECT
  d.row_id            AS district_id,
  d.customer_district AS customer_district,
  d.customer_name     AS customer_name,
  inc.total_incidents,
  inc.xc_caused_incidents,
  CASE WHEN inc.xc_caused_incidents > 0
       THEN ROUND(CAST(0 AS numeric) / inc.xc_caused_incidents, 1)
       ELSE NULL END AS stages_per_xc_incident
FROM inc
JOIN fst_app.districts_with_customer_name d ON d.row_id = inc.district_id;

-- v_sqm_performance
CREATE OR REPLACE VIEW fst_app.v_sqm_performance AS
WITH v AS (
  SELECT xc_rep AS sqm_name,
         COUNT(DISTINCT field_visit_id)  AS total_visits,
         ROUND(SUM(EXTRACT(epoch FROM departure_date - arrival_date) / 3600::numeric), 1) AS total_hours,
         COUNT(DISTINCT CASE WHEN visit_purpose = 'Training'           THEN field_visit_id END) AS training_visits,
         COUNT(DISTINCT CASE WHEN visit_purpose = 'XFire Installation' THEN field_visit_id END) AS installation_visits,
         COUNT(DISTINCT CASE WHEN visit_purpose = 'Incident'           THEN field_visit_id END) AS incident_visits
  FROM public.fieldvisits GROUP BY xc_rep
),
i AS (
  SELECT xc_rep AS sqm_name, COUNT(DISTINCT event_id) AS incidents_handled
  FROM public.incidents GROUP BY xc_rep
)
SELECT
  v.sqm_name,
  v.total_visits,
  v.total_hours,
  v.training_visits,
  v.installation_visits,
  v.incident_visits,
  COALESCE(i.incidents_handled, 0) AS incidents_handled
FROM v
LEFT JOIN i ON i.sqm_name = v.sqm_name;

-- ============================================================
-- STEP 10: Grant permissions on all new fst_app views
-- ============================================================
GRANT SELECT ON ALL TABLES IN SCHEMA fst_app TO anon, authenticated;
GRANT ALL    ON ALL TABLES IN SCHEMA fst_app TO service_role;

-- ============================================================
-- VERIFICATION QUERY
-- Run after migration to confirm everything is set up:
-- ============================================================
/*
SELECT table_schema, table_name, table_type
FROM information_schema.tables
WHERE table_schema IN ('public', 'fst_app')
ORDER BY table_schema, table_name;
*/
