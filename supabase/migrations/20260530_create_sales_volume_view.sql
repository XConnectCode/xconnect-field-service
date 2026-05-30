-- Unified sales_volume view: merges barrels_sold + stages into one source.
--
-- Background: in AppSheet these were two separate sheets requiring two
-- separate, cumbersome import passes. The tables are structurally identical
-- except barrels_sold has `product_line` and stages has `item`. This view
-- normalizes both into a single shape so the UI reads from one place.
--
-- Zero-risk: this is a VIEW over the existing tables. The originals are
-- untouched. A future migration can promote this into a real table.
--
-- The `date` column is cast to a real DATE (originals store it as text),
-- so timeframe filters compare dates instead of strings. `date_text`
-- preserves the original value for traceability.

CREATE OR REPLACE VIEW public.sales_volume AS
SELECT
  bs.row_id,
  'barrels'::text            AS metric_type,
  bs.date                    AS date_text,
  NULLIF(bs.date, '')::date  AS date,
  bs.customer,
  bs.customer_district,
  bs.product_line            AS category,
  bs.quantity
FROM public.barrels_sold bs
UNION ALL
SELECT
  st.row_id,
  'stages'::text             AS metric_type,
  st.date                    AS date_text,
  NULLIF(st.date, '')::date  AS date,
  st.customer,
  st.customer_district,
  st.item                    AS category,
  st.quantity
FROM public.stages st;
