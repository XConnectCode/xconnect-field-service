-- Add a cached AI-generated prose summary to incidents.
-- Populated (non-blocking) by the ai-assist edge function on create/edit and
-- read by the Dashboard incident cards / Monday-meeting list. Nullable so rows
-- without a summary fall back to the raw notes preview in the UI.
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS ai_summary text;
