-- Make v_dashboard_summary count only VERIFIED XFire panels (verified = 'Y'),
-- consistent with the Dashboard page and the XFire Panels page. Only the two
-- xfire panel subqueries change; all other columns are unchanged.
CREATE OR REPLACE VIEW public.v_dashboard_summary AS
SELECT
  count(DISTINCT fv.field_visit_id) AS total_visits,
  round(sum(EXTRACT(epoch FROM fv.departure_date - fv.arrival_date) / 3600::numeric), 0) AS total_visit_hours,
  count(DISTINCT i.event_id) AS total_incidents,
  count(DISTINCT CASE WHEN i.incident_status = 'New'::incident_status_enum THEN i.event_id ELSE NULL::text END) AS open_incidents,
  ( SELECT count(*) AS count FROM exodus_panels) AS total_exodus_panels,
  ( SELECT count(*) AS count FROM exodus_panels WHERE exodus_panels.panel_status = 'Leased'::text) AS leased_exodus_panels,
  ( SELECT count(*) AS count FROM panels WHERE panels.verified = 'Y'::text) AS total_xfire_panels,
  ( SELECT count(*) AS count FROM panels WHERE panels.panel_status = 'Leased'::text AND panels.verified = 'Y'::text) AS leased_xfire_panels,
  COALESCE(( SELECT sum(barrels_sold.quantity) AS sum FROM barrels_sold), 0::numeric) AS total_barrels,
  COALESCE(( SELECT sum(stages.quantity) AS sum FROM stages), 0::numeric) AS total_stages
FROM fieldvisits fv
  FULL JOIN incidents i ON false;
