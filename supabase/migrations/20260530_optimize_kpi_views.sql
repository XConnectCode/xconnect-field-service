-- Perf fix at the source: rewrite v_customer_kpis, v_district_kpis, v_sqm_performance
-- to pre-aggregate each source table in CTEs instead of flat-joining everything in one
-- GROUP BY. The old definitions produced a cartesian blow-up (barrels x stages x visits
-- rows per group) that timed out, and inflated SUM-based columns. Column signatures are
-- preserved exactly so all downstream consumers are unaffected.

-- ── v_customer_kpis ────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_customer_kpis AS
WITH visits AS (
  SELECT customer AS cid,
         COUNT(DISTINCT field_visit_id) AS total_visits,
         ROUND(SUM(EXTRACT(epoch FROM departure_date - arrival_date) / 3600::numeric), 1) AS total_visit_hours
  FROM fieldvisits GROUP BY customer
),
inc AS (
  SELECT customer AS cid,
         COUNT(DISTINCT event_id) AS total_incidents,
         COUNT(DISTINCT CASE WHEN xc_caused = 'Yes'::"XC Caused" THEN event_id END) AS xc_caused_incidents
  FROM incidents GROUP BY customer
),
panels AS (
  SELECT customer AS cid, COUNT(DISTINCT serial_number) AS exodus_panels_deployed
  FROM exodus_panels WHERE panel_status = 'Leased'::text GROUP BY customer
),
barrels AS (
  SELECT customer AS cname, SUM(quantity) AS total_barrels FROM barrels_sold GROUP BY customer
),
stg AS (
  SELECT customer AS cname, SUM(quantity) AS total_stages FROM stages GROUP BY customer
)
SELECT
  c.row_id   AS customer_id,
  c.customer AS customer_name,
  COALESCE(visits.total_visits, 0)        AS total_visits,
  visits.total_visit_hours                AS total_visit_hours,
  COALESCE(inc.total_incidents, 0)        AS total_incidents,
  COALESCE(inc.xc_caused_incidents, 0)    AS xc_caused_incidents,
  COALESCE(panels.exodus_panels_deployed, 0) AS exodus_panels_deployed,
  COALESCE(barrels.total_barrels, 0::numeric) AS total_barrels,
  COALESCE(stg.total_stages, 0::numeric)      AS total_stages
FROM customers c
LEFT JOIN visits  ON visits.cid  = c.row_id
LEFT JOIN inc     ON inc.cid     = c.row_id
LEFT JOIN panels  ON panels.cid  = c.row_id
LEFT JOIN barrels ON barrels.cname = c.customer
LEFT JOIN stg     ON stg.cname   = c.customer;

-- ── v_district_kpis ────────────────────────────────────────────────────────────
-- district key bridging: incidents/fieldvisits.customer_district = districts.row_id (ID);
-- barrels_sold/stages.customer_district = district NAME (= d.customer_district).
CREATE OR REPLACE VIEW public.v_district_kpis AS
WITH visits AS (
  SELECT customer_district AS did,
         COUNT(DISTINCT field_visit_id) AS total_visits,
         ROUND(SUM(EXTRACT(epoch FROM departure_date - arrival_date) / 3600::numeric), 1) AS total_visit_hours
  FROM fieldvisits GROUP BY customer_district
),
inc AS (
  SELECT customer_district AS did,
         COUNT(DISTINCT event_id) AS total_incidents,
         COUNT(DISTINCT CASE WHEN xc_caused = 'Yes'::"XC Caused" THEN event_id END) AS xc_caused_incidents
  FROM incidents GROUP BY customer_district
),
barrels AS (
  SELECT customer_district AS dname, SUM(quantity) AS total_barrels FROM barrels_sold GROUP BY customer_district
),
stg AS (
  SELECT customer_district AS dname, SUM(quantity) AS total_stages FROM stages GROUP BY customer_district
)
SELECT
  d.row_id            AS district_id,
  d.customer_district AS customer_district,
  d.customer_name     AS customer_name,
  COALESCE(visits.total_visits, 0)     AS total_visits,
  visits.total_visit_hours             AS total_visit_hours,
  COALESCE(inc.total_incidents, 0)     AS total_incidents,
  COALESCE(inc.xc_caused_incidents, 0) AS xc_caused_incidents,
  COALESCE(barrels.total_barrels, 0::numeric) AS total_barrels,
  COALESCE(stg.total_stages, 0::numeric)      AS total_stages,
  CASE
    WHEN COALESCE(stg.total_stages, 0::numeric) > 0 AND COALESCE(inc.xc_caused_incidents, 0) > 0
    THEN ROUND(stg.total_stages / NULLIF(inc.xc_caused_incidents, 0)::numeric)
    ELSE NULL::numeric
  END AS stages_per_xc_incident
FROM districts_with_customer_name d
LEFT JOIN visits  ON visits.did  = d.row_id
LEFT JOIN inc     ON inc.did     = d.row_id
LEFT JOIN barrels ON barrels.dname = d.customer_district
LEFT JOIN stg     ON stg.dname   = d.customer_district;

-- ── v_sqm_performance ──────────────────────────────────────────────────────────
-- Old version LEFT JOIN incidents ON xc_rep multiplied visit rows by incidents, which
-- inflated total_hours (a non-DISTINCT SUM). Pre-aggregate both sides separately.
CREATE OR REPLACE VIEW public.v_sqm_performance AS
WITH v AS (
  SELECT xc_rep AS sqm_name,
         COUNT(DISTINCT field_visit_id) AS total_visits,
         ROUND(SUM(EXTRACT(epoch FROM departure_date - arrival_date) / 3600::numeric), 1) AS total_hours,
         COUNT(DISTINCT CASE WHEN visit_purpose = 'Training'::"Visit Type" THEN field_visit_id END) AS training_visits,
         COUNT(DISTINCT CASE WHEN visit_purpose = 'XFire Installation'::"Visit Type" THEN field_visit_id END) AS installation_visits,
         COUNT(DISTINCT CASE WHEN visit_purpose = 'Incident'::"Visit Type" THEN field_visit_id END) AS incident_visits
  FROM fieldvisits GROUP BY xc_rep
),
i AS (
  SELECT xc_rep AS sqm_name, COUNT(DISTINCT event_id) AS incidents_handled
  FROM incidents GROUP BY xc_rep
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
