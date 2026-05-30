-- WS3 perf fix: lean executive ranking views.
-- The existing v_customer_kpis / v_district_kpis flat-join fieldvisits + barrels +
-- stages + incidents in one GROUP BY, producing a cartesian blow-up that times out.
-- These purpose-built views aggregate each source separately, then join small results.

-- Top customers by incidents (with stages joined from a pre-aggregated subquery).
CREATE OR REPLACE VIEW public.v_exec_customer_incidents AS
WITH inc AS (
  SELECT customer AS customer_id,
         COUNT(*)                                   AS total_incidents,
         COUNT(*) FILTER (WHERE xc_caused = 'Yes')  AS xc_caused_incidents
  FROM public.incidents
  WHERE customer IS NOT NULL
  GROUP BY customer
),
stg AS (
  SELECT customer AS customer_name,
         SUM(quantity) AS total_stages
  FROM public.stages
  GROUP BY customer
)
SELECT
  c.row_id                                  AS customer_id,
  c.customer                                AS customer_name,
  COALESCE(inc.total_incidents, 0)          AS total_incidents,
  COALESCE(inc.xc_caused_incidents, 0)      AS xc_caused_incidents,
  COALESCE(stg.total_stages, 0)             AS total_stages
FROM public.customers c
LEFT JOIN inc ON inc.customer_id = c.row_id
LEFT JOIN stg ON stg.customer_name = c.customer
WHERE COALESCE(inc.total_incidents, 0) > 0;

-- Districts by incidents + stages-per-XC-incident.
-- incidents.customer_district = districts.row_id (an ID);
-- stages.customer_district    = district NAME (joins to d.customer_district).
CREATE OR REPLACE VIEW public.v_exec_district_incidents AS
WITH inc AS (
  SELECT customer_district AS district_id,
         COUNT(*)                                  AS total_incidents,
         COUNT(*) FILTER (WHERE xc_caused = 'Yes') AS xc_caused_incidents
  FROM public.incidents
  WHERE customer_district IS NOT NULL
  GROUP BY customer_district
),
stg AS (
  SELECT customer_district AS district_name,
         SUM(quantity) AS total_stages
  FROM public.stages
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
       THEN ROUND(COALESCE(stg.total_stages, 0) / inc.xc_caused_incidents, 1)
       ELSE NULL END AS stages_per_xc_incident
FROM inc
JOIN districts_with_customer_name d ON d.row_id = inc.district_id
LEFT JOIN stg ON stg.district_name = d.customer_district;
