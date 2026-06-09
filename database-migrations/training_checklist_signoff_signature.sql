-- Add a drawn-signature URL column to training_checklist_sessions.
-- The existing signoff_name (typed name) is kept; signoff_sig_url stores the
-- public URL of the SignaturePad PNG uploaded via the polymorphic image route.
ALTER TABLE training_checklist_sessions
  ADD COLUMN IF NOT EXISTS signoff_sig_url text;
