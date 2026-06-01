-- QC sampling (AQL General Inspection Level II)
-- guns_in_pallet = total guns in the physical pallet/lot (e.g. 100)
-- sample_size    = number of guns to inspect (AQL-suggested, inspector-editable)
-- guns_total     = count of gun records actually created for inspection (= sample_size)
ALTER TABLE qc_pallets
  ADD COLUMN IF NOT EXISTS guns_in_pallet integer,
  ADD COLUMN IF NOT EXISTS sample_size integer;

COMMENT ON COLUMN qc_pallets.guns_in_pallet IS 'Total guns in the physical pallet/lot (e.g. 100)';
COMMENT ON COLUMN qc_pallets.sample_size IS 'Number of guns to inspect (AQL Level II suggested, inspector-editable). guns_total = count of gun records actually created.';
