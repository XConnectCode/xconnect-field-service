-- =====================================================================
-- Incident Reports — shared PDF storage in Supabase Storage
-- =====================================================================
--
-- Apply once in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Goals:
--   1. Track storage-backed PDFs on the existing `incident_reports` table
--      via a new `file_path` column (the object path inside the
--      `incident-reports` bucket). Existing rows that point at public
--      `file_url`s (AppSheet originals) keep working.
--   2. Create the private `incident-reports` bucket if it does not exist.
--   3. Allow any authenticated user to read/write objects in that bucket
--      so generated PDFs are shared across users/devices. Anonymous
--      access stays blocked because the bucket is private and policies
--      gate on `auth.role()`.
--
-- Customer-facing expiring share links can be layered on later by
-- generating signed URLs server-side; nothing in this migration exposes
-- the bucket publicly.
-- =====================================================================

-- 1. incident_reports table — add file_path column ---------------------
alter table public.incident_reports
  add column if not exists file_path text;

create index if not exists incident_reports_event_id_idx
  on public.incident_reports(event_id);

create index if not exists incident_reports_report_type_idx
  on public.incident_reports(report_type);

-- 2. Storage bucket -----------------------------------------------------
insert into storage.buckets (id, name, public)
values ('incident-reports', 'incident-reports', false)
on conflict (id) do nothing;

-- 3. Storage policies — authenticated users only -----------------------
do $$
begin
  -- Read
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename  = 'objects'
      and policyname = 'incident_reports_authenticated_read'
  ) then
    create policy incident_reports_authenticated_read
      on storage.objects for select
      using (bucket_id = 'incident-reports' and auth.role() = 'authenticated');
  end if;

  -- Insert
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename  = 'objects'
      and policyname = 'incident_reports_authenticated_insert'
  ) then
    create policy incident_reports_authenticated_insert
      on storage.objects for insert
      with check (bucket_id = 'incident-reports' and auth.role() = 'authenticated');
  end if;

  -- Update (upsert generated PDFs)
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename  = 'objects'
      and policyname = 'incident_reports_authenticated_update'
  ) then
    create policy incident_reports_authenticated_update
      on storage.objects for update
      using (bucket_id = 'incident-reports' and auth.role() = 'authenticated')
      with check (bucket_id = 'incident-reports' and auth.role() = 'authenticated');
  end if;

  -- Delete (replace prior version of a report)
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename  = 'objects'
      and policyname = 'incident_reports_authenticated_delete'
  ) then
    create policy incident_reports_authenticated_delete
      on storage.objects for delete
      using (bucket_id = 'incident-reports' and auth.role() = 'authenticated');
  end if;
end $$;
