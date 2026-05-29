-- =====================================================================
-- Incident Report Send-To-Customer audit trail
-- =====================================================================
--
-- Apply once in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Adds the audit columns that the new "Send Report to Customer" flow
-- writes when an admin emails the final PDF out:
--
--   - report_sent_to       text         comma-separated recipient list
--   - report_sent_by       text         user that triggered the send
--   - report_sent_message  text         optional cover note included in email
--   - report_sent_attempts integer      number of send attempts (audit)
--
-- The existing `report_sent` timestamptz column is reused to record when
-- the most recent send succeeded.
-- =====================================================================

alter table public.incidents
  add column if not exists report_sent_to       text,
  add column if not exists report_sent_by       text,
  add column if not exists report_sent_message  text,
  add column if not exists report_sent_attempts integer default 0;

create index if not exists incidents_report_sent_idx
  on public.incidents(report_sent)
  where report_sent is not null;
