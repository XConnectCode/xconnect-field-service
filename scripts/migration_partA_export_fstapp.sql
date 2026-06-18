-- ==============================================================
-- PART A — Run this in FST APP project SQL Editor
-- Project: FST APP (gbllxumuogsncoiaksum)
-- Schema:  public
--
-- This generates INSERT statements you can copy and run in
-- Part B on the eXodus project.
-- ==============================================================

-- Run each block separately and copy the output.
-- Or use pg_dump (see migrate_fstapp_to_exodus.ps1) for bulk export.

-- ── customers ─────────────────────────────────────────────────
SELECT 'INSERT INTO fst_app.customers (' ||
  string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) ||
  ') VALUES'
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'customers';

-- Then run this to get the actual row data:
-- (copy result rows and paste after the INSERT header above)
TABLE public.customers;

-- ── districts ─────────────────────────────────────────────────
TABLE public.districts;

-- ── fieldvisits ───────────────────────────────────────────────
TABLE public.fieldvisits;

-- ── incidents ─────────────────────────────────────────────────
TABLE public.incidents;

-- ── panels ────────────────────────────────────────────────────
TABLE public.panels;

-- ── kv_store_64775d98 ─────────────────────────────────────────
TABLE public.kv_store_64775d98;

-- ── incident_updates ──────────────────────────────────────────
TABLE public.incident_updates;

-- ── qc_pallets ────────────────────────────────────────────────
TABLE public.qc_pallets;

-- ── qc_guns ───────────────────────────────────────────────────
TABLE public.qc_guns;

-- ── qc_gun_checks ─────────────────────────────────────────────
TABLE public.qc_gun_checks;

-- ── driver_loads ──────────────────────────────────────────────
TABLE public.driver_loads;

-- ── driver_load_items ─────────────────────────────────────────
TABLE public.driver_load_items;
