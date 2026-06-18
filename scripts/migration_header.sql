-- migration_header.sql
-- Prepended to schema dump before applying to eXodus (fst_app schema)
-- Do NOT edit the quote characters in this file.

CREATE SCHEMA IF NOT EXISTS fst_app;
SET search_path = fst_app, public;

-- Drop old views (from previous migration) if they exist
DO $$ BEGIN
  DROP VIEW IF EXISTS fst_app.customers                    CASCADE;
  DROP VIEW IF EXISTS fst_app.districts                    CASCADE;
  DROP VIEW IF EXISTS fst_app.fieldvisits                  CASCADE;
  DROP VIEW IF EXISTS fst_app.incidents                    CASCADE;
  DROP VIEW IF EXISTS fst_app.panels                       CASCADE;
  DROP VIEW IF EXISTS fst_app.kv_store_64775d98            CASCADE;
  DROP VIEW IF EXISTS fst_app.incident_updates             CASCADE;
  DROP VIEW IF EXISTS fst_app.qc_pallets                   CASCADE;
  DROP VIEW IF EXISTS fst_app.qc_guns                      CASCADE;
  DROP VIEW IF EXISTS fst_app.qc_gun_checks                CASCADE;
  DROP VIEW IF EXISTS fst_app.driver_loads                 CASCADE;
  DROP VIEW IF EXISTS fst_app.driver_load_items            CASCADE;
  DROP VIEW IF EXISTS fst_app.districts_with_customer_name CASCADE;
  DROP VIEW IF EXISTS fst_app.v_dashboard_summary          CASCADE;
  DROP VIEW IF EXISTS fst_app.v_incident_trend_monthly     CASCADE;
  DROP VIEW IF EXISTS fst_app.v_incident_open_aging        CASCADE;
  DROP VIEW IF EXISTS fst_app.v_exec_customer_incidents    CASCADE;
  DROP VIEW IF EXISTS fst_app.v_exec_district_incidents    CASCADE;
  DROP VIEW IF EXISTS fst_app.v_sqm_performance            CASCADE;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
