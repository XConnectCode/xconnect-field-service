-- Director review workflow + incident timeline.
--
-- 1. Adds reviewed_by / reviewed_at to incidents. An incident must carry this
--    stamp before it can be Closed (enforced in incidentWorkflow.ts via
--    REQUIRED_FOR_CLOSED_EXTRA). This makes director review an auditable gate.
-- 2. Adds incident_updates: a threaded timeline of updates per incident so we
--    stop losing history in single text fields (investigation/root_cause/etc).

ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS reviewed_by text;
ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

DROP TABLE IF EXISTS public.incident_updates;
CREATE TABLE public.incident_updates (
  row_id      uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id    text,
  incident_id text,
  update_type text,            -- 'investigation' | 'root_cause' | 'action' | 'review' | 'slack_note' | 'general'
  note        text NOT NULL,
  created_by  text,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX idx_incident_updates_event    ON public.incident_updates (event_id);
CREATE INDEX idx_incident_updates_incident ON public.incident_updates (incident_id);
CREATE INDEX IF NOT EXISTS idx_incidents_date        ON public.incidents (date_incident);
CREATE INDEX IF NOT EXISTS idx_incidents_reviewed_at ON public.incidents (reviewed_at);

-- RLS: authenticated users can read all updates and append new ones.
ALTER TABLE public.incident_updates ENABLE ROW LEVEL SECURITY;
CREATE POLICY incident_updates_read  ON public.incident_updates FOR SELECT TO authenticated USING (true);
CREATE POLICY incident_updates_write ON public.incident_updates FOR INSERT TO authenticated WITH CHECK (true);
