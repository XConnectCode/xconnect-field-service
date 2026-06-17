-- ==============================================================
-- PART C — Run this in FST APP project SQL Editor
-- Project: FST APP (gbllxumuogsncoiaksum)
-- Schema:  public
--
-- Generates INSERT statements for all rows in each table.
-- Copy the full output and paste into eXodus SQL Editor
-- (or save as migration_partC_data.sql and run via psql).
--
-- TIP: Run one table at a time if the dataset is large.
-- ==============================================================

-- ── customers ─────────────────────────────────────────────────
SELECT 'INSERT INTO fst_app.customers (' ||
  string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) || ')'
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'customers';

-- Copy rows:
SELECT 'VALUES (' ||
  quote_nullable(row_id) || ',' ||
  quote_nullable(customer) || ',' ||
  quote_nullable(customer_logo) || ',' ||
  quote_nullable(created_at::text) || ',' ||
  quote_nullable(updated_at::text) ||
');'
FROM public.customers;

-- ── districts ─────────────────────────────────────────────────
SELECT 'VALUES (' ||
  quote_nullable(row_id) || ',' ||
  quote_nullable(customer_district_id) || ',' ||
  quote_nullable(customer_district) || ',' ||
  quote_nullable(customer_address) || ',' ||
  quote_nullable(district_contact) || ',' ||
  quote_nullable(customer_email) || ',' ||
  quote_nullable(customer_phone_number) || ',' ||
  quote_nullable(customer) || ',' ||
  quote_nullable(customer_logo) || ',' ||
  quote_nullable(customer_name) || ',' ||
  quote_nullable(created_at::text) || ',' ||
  quote_nullable(updated_at::text) ||
');'
FROM public.districts;

-- ── fieldvisits ───────────────────────────────────────────────
SELECT 'INSERT INTO fst_app.fieldvisits (field_visit_id,xc_rep,customer,customer_district,visit_purpose,arrival_date,departure_date,visit_notes,activities,created_at,updated_at) VALUES (' ||
  quote_nullable(field_visit_id) || ',' ||
  quote_nullable(xc_rep) || ',' ||
  quote_nullable(customer) || ',' ||
  quote_nullable(customer_district) || ',' ||
  quote_nullable(visit_purpose) || ',' ||
  quote_nullable(arrival_date::text) || ',' ||
  quote_nullable(departure_date::text) || ',' ||
  quote_nullable(visit_notes) || ',' ||
  quote_nullable(activities::text) || ',' ||
  quote_nullable(created_at::text) || ',' ||
  quote_nullable(updated_at::text) ||
');'
FROM public.fieldvisits;

-- ── incidents ─────────────────────────────────────────────────
SELECT 'INSERT INTO fst_app.incidents (event_id,xc_rep,customer,customer_district,date_incident,incident_type,incident_severity,incident_status,xc_caused,incident_description,incident_notes,actions_taken,field_visit_id,reviewed_by,reviewed_at,ai_summary,report_generated_at,report_generated_by,report_url,qc_pallet_id,qc_build_no,report_sent_to,report_sent_by,report_sent_message,created_at,updated_at) VALUES (' ||
  quote_nullable(event_id) || ',' ||
  quote_nullable(xc_rep) || ',' ||
  quote_nullable(customer) || ',' ||
  quote_nullable(customer_district) || ',' ||
  quote_nullable(date_incident::text) || ',' ||
  quote_nullable(incident_type) || ',' ||
  quote_nullable(incident_severity) || ',' ||
  quote_nullable(incident_status) || ',' ||
  quote_nullable(xc_caused) || ',' ||
  quote_nullable(incident_description) || ',' ||
  quote_nullable(incident_notes) || ',' ||
  quote_nullable(actions_taken) || ',' ||
  quote_nullable(field_visit_id) || ',' ||
  quote_nullable(reviewed_by) || ',' ||
  quote_nullable(reviewed_at::text) || ',' ||
  quote_nullable(ai_summary) || ',' ||
  quote_nullable(report_generated_at::text) || ',' ||
  quote_nullable(report_generated_by) || ',' ||
  quote_nullable(report_url) || ',' ||
  quote_nullable(qc_pallet_id) || ',' ||
  quote_nullable(qc_build_no) || ',' ||
  quote_nullable(report_sent_to) || ',' ||
  quote_nullable(report_sent_by) || ',' ||
  quote_nullable(report_sent_message) || ',' ||
  quote_nullable(created_at::text) || ',' ||
  quote_nullable(updated_at::text) ||
');'
FROM public.incidents;

-- ── panels ────────────────────────────────────────────────────
SELECT 'INSERT INTO fst_app.panels (row_id,panel_id,serial_number,panel_status,customer,customer_district,verified,install_date,last_service_date,notes,activity,returned_date,return_notes,return_confirmed_by,last_seen_date,last_seen_by,last_seen_visit_id,created_at,updated_at) VALUES (' ||
  quote_nullable(row_id) || ',' ||
  quote_nullable(panel_id) || ',' ||
  quote_nullable(serial_number) || ',' ||
  quote_nullable(panel_status) || ',' ||
  quote_nullable(customer) || ',' ||
  quote_nullable(customer_district) || ',' ||
  quote_nullable(verified) || ',' ||
  quote_nullable(install_date::text) || ',' ||
  quote_nullable(last_service_date::text) || ',' ||
  quote_nullable(notes) || ',' ||
  quote_nullable(activity::text) || ',' ||
  quote_nullable(returned_date::text) || ',' ||
  quote_nullable(return_notes) || ',' ||
  quote_nullable(return_confirmed_by) || ',' ||
  quote_nullable(last_seen_date::text) || ',' ||
  quote_nullable(last_seen_by) || ',' ||
  quote_nullable(last_seen_visit_id) || ',' ||
  quote_nullable(created_at::text) || ',' ||
  quote_nullable(updated_at::text) ||
');'
FROM public.panels;

-- ── kv_store_64775d98 ─────────────────────────────────────────
SELECT 'INSERT INTO fst_app.kv_store_64775d98 (key,value,updated_at) VALUES (' ||
  quote_nullable(key) || ',' ||
  quote_nullable(value::text) || ',' ||
  quote_nullable(updated_at::text) ||
') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;'
FROM public.kv_store_64775d98;

-- ── incident_updates ──────────────────────────────────────────
SELECT 'INSERT INTO fst_app.incident_updates (row_id,event_id,incident_id,update_type,note,created_by,created_at) VALUES (' ||
  quote_nullable(row_id::text) || ',' ||
  quote_nullable(event_id) || ',' ||
  quote_nullable(incident_id) || ',' ||
  quote_nullable(update_type) || ',' ||
  quote_nullable(note) || ',' ||
  quote_nullable(created_by) || ',' ||
  quote_nullable(created_at::text) ||
');'
FROM public.incident_updates;

-- ── qc_pallets ────────────────────────────────────────────────
SELECT 'INSERT INTO fst_app.qc_pallets (row_id,build_no,customer,destination,load_type,guns_total,guns_in_pallet,sample_size,sales_order,fulfillment_id,operator,status,signed_off_by,signed_off_at,notes,updated_by,created_at,updated_at) VALUES (' ||
  quote_nullable(row_id) || ',' ||
  quote_nullable(build_no) || ',' ||
  quote_nullable(customer) || ',' ||
  quote_nullable(destination) || ',' ||
  quote_nullable(load_type) || ',' ||
  quote_nullable(guns_total::text) || ',' ||
  quote_nullable(guns_in_pallet::text) || ',' ||
  quote_nullable(sample_size::text) || ',' ||
  quote_nullable(sales_order) || ',' ||
  quote_nullable(fulfillment_id) || ',' ||
  quote_nullable(operator) || ',' ||
  quote_nullable(status) || ',' ||
  quote_nullable(signed_off_by) || ',' ||
  quote_nullable(signed_off_at::text) || ',' ||
  quote_nullable(notes) || ',' ||
  quote_nullable(updated_by) || ',' ||
  quote_nullable(created_at::text) || ',' ||
  quote_nullable(updated_at::text) ||
');'
FROM public.qc_pallets;

-- ── qc_guns ───────────────────────────────────────────────────
SELECT 'INSERT INTO fst_app.qc_guns (row_id,pallet_row_id,gun_index,serial,result,inspected_by,inspected_at,notes,created_at) VALUES (' ||
  quote_nullable(row_id) || ',' ||
  quote_nullable(pallet_row_id) || ',' ||
  quote_nullable(gun_index::text) || ',' ||
  quote_nullable(serial) || ',' ||
  quote_nullable(result) || ',' ||
  quote_nullable(inspected_by) || ',' ||
  quote_nullable(inspected_at::text) || ',' ||
  quote_nullable(notes) || ',' ||
  quote_nullable(created_at::text) ||
');'
FROM public.qc_guns;

-- ── qc_gun_checks ─────────────────────────────────────────────
SELECT 'INSERT INTO fst_app.qc_gun_checks (row_id,gun_row_id,item_key,state,note,created_at) VALUES (' ||
  quote_nullable(row_id) || ',' ||
  quote_nullable(gun_row_id) || ',' ||
  quote_nullable(item_key) || ',' ||
  quote_nullable(state) || ',' ||
  quote_nullable(note) || ',' ||
  quote_nullable(created_at::text) ||
');'
FROM public.qc_gun_checks;

-- ── driver_loads ──────────────────────────────────────────────
SELECT 'INSERT INTO fst_app.driver_loads (row_id,load_number,delivery_date,origin_district,customer,customer_district,destination,packing_slip_no,mode_of_delivery,trailer_connected,driver_type,driver,driver_name,driver_company,hazmat_load,hardware_present,ancillary_explosives,explosive_types,document_correlation,items_secure,driver_sig_url,inspector_name,inspector_sig_url,manager_name,manager_sig_url,status,departed_by,departed_at,notes,updated_by,created_at,updated_at) VALUES (' ||
  quote_nullable(row_id) || ',' ||
  quote_nullable(load_number) || ',' ||
  quote_nullable(delivery_date::text) || ',' ||
  quote_nullable(origin_district) || ',' ||
  quote_nullable(customer) || ',' ||
  quote_nullable(customer_district) || ',' ||
  quote_nullable(destination) || ',' ||
  quote_nullable(packing_slip_no) || ',' ||
  quote_nullable(mode_of_delivery) || ',' ||
  quote_nullable(trailer_connected::text) || ',' ||
  quote_nullable(driver_type) || ',' ||
  quote_nullable(driver) || ',' ||
  quote_nullable(driver_name) || ',' ||
  quote_nullable(driver_company) || ',' ||
  quote_nullable(hazmat_load::text) || ',' ||
  quote_nullable(hardware_present::text) || ',' ||
  quote_nullable(ancillary_explosives::text) || ',' ||
  quote_nullable(array_to_string(explosive_types, ',')) || ',' ||
  quote_nullable(document_correlation::text) || ',' ||
  quote_nullable(items_secure::text) || ',' ||
  quote_nullable(driver_sig_url) || ',' ||
  quote_nullable(inspector_name) || ',' ||
  quote_nullable(inspector_sig_url) || ',' ||
  quote_nullable(manager_name) || ',' ||
  quote_nullable(manager_sig_url) || ',' ||
  quote_nullable(status) || ',' ||
  quote_nullable(departed_by) || ',' ||
  quote_nullable(departed_at::text) || ',' ||
  quote_nullable(notes) || ',' ||
  quote_nullable(updated_by) || ',' ||
  quote_nullable(created_at::text) || ',' ||
  quote_nullable(updated_at::text) ||
');'
FROM public.driver_loads;

-- ── driver_load_items ─────────────────────────────────────────
SELECT 'INSERT INTO fst_app.driver_load_items (row_id,load_row_id,pallet_build_no,description,qty_expected,qty_loaded,destination,checked,note,source_pallet_row_id,created_at) VALUES (' ||
  quote_nullable(row_id) || ',' ||
  quote_nullable(load_row_id) || ',' ||
  quote_nullable(pallet_build_no) || ',' ||
  quote_nullable(description) || ',' ||
  quote_nullable(qty_expected::text) || ',' ||
  quote_nullable(qty_loaded::text) || ',' ||
  quote_nullable(destination) || ',' ||
  quote_nullable(checked::text) || ',' ||
  quote_nullable(note) || ',' ||
  quote_nullable(source_pallet_row_id) || ',' ||
  quote_nullable(created_at::text) ||
');'
FROM public.driver_load_items;
