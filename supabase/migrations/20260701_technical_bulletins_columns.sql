-- ============================================================
-- FST APP MIGRATION — technical_bulletins missing columns
-- Adds bulletin_type, customer_file_url, customer_file_label to
-- fst_app.technical_bulletins.
--
-- Background: The TechnicalBulletin setup was only partially applied
-- (only `sections` landed). The frontend TechnicalBulletin.tsx handleSave
-- writes directly via supabase-js and sends bulletin_type, so PostgREST
-- rejected the whole write with "Could not find the 'bulletin_type'
-- column". The customer download link/label are now persisted to the DB
-- (customer_file_url / customer_file_label) with localStorage as fallback.
--
-- Applied to BOTH environments on 2026-07-01:
--   Production (gbllxumuogsncoiaksum) and Testing (qbexqpvzmssmifimlfos).
-- Idempotent via IF NOT EXISTS.
-- ============================================================

ALTER TABLE fst_app.technical_bulletins
  ADD COLUMN IF NOT EXISTS bulletin_type text NOT NULL DEFAULT 'Informational';

ALTER TABLE fst_app.technical_bulletins
  ADD COLUMN IF NOT EXISTS customer_file_url text;

ALTER TABLE fst_app.technical_bulletins
  ADD COLUMN IF NOT EXISTS customer_file_label text;

-- Refresh PostgREST schema cache so the new columns are immediately visible.
NOTIFY pgrst, 'reload schema';
