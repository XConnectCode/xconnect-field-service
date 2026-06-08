-- Add customer_district to training checklist sessions.
--
-- Sessions now capture the customer (as a customers.row_id, matching
-- fieldvisits/incidents) and its district (districts.row_id). Older rows may
-- hold a free-text customer name in `customer`; the UI/PDF resolve a row_id to
-- a name when it matches and otherwise fall back to the stored literal, so this
-- change is backward compatible.
ALTER TABLE training_checklist_sessions
  ADD COLUMN IF NOT EXISTS customer_district text;
