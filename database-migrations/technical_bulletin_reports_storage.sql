-- =====================================================================
-- Technical Bulletin Reports — shared PDF storage in Supabase Storage
-- =====================================================================
--
-- Apply once in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Mirrors the incident_reports storage flow so a generated bulletin PDF
-- (Standard or Compact) is uploaded to a private bucket and tracked in a
-- table, letting every authenticated user grab the already-generated
-- document straight from the saved bulletin entry.
--
-- Goals:
--   1. Track storage-backed PDFs in a new `technical_bulletin_reports`
--      table. `bulletin_id` references the technical_bulletins row; the
--      object path inside the `technical-bulletins` bucket lives in
--      `file_path`.
--   2. Create the private `technical-bulletins` bucket if it does not
--      exist.
--   3. Allow any authenticated user to read/write objects in that bucket
--      so generated PDFs are shared across users/devices. Anonymous
--      access stays blocked (bucket is private + policies gate on
--      auth.role()).
-- =====================================================================

-- 1. technical_bulletin_reports table ----------------------------------
create table if not exists public.technical_bulletin_reports (
  row_id        uuid primary key default gen_random_uuid(),
  bulletin_id   uuid not null references public.technical_bulletins(id) on delete cascade,
  -- 'Standard' | 'Compact' — one current row per (bulletin_id, report_type)
  report_type   text not null,
  file_path     text,
  file_name     text,
  generated_at  timestamptz default now(),
  generated_by  text
);

create index if not exists technical_bulletin_reports_bulletin_id_idx
  on public.technical_bulletin_reports(bulletin_id);

create index if not exists technical_bulletin_reports_report_type_idx
  on public.technical_bulletin_reports(report_type);

-- Keep the table in sync with the app's "one current per type" model.
create unique index if not exists technical_bulletin_reports_unique_type_idx
  on public.technical_bulletin_reports(bulletin_id, report_type);

-- RLS: the app runs with RLS disabled on technical_bulletins; keep this
-- table consistent so saves/reads aren't blocked.
alter table public.technical_bulletin_reports disable row level security;

-- 2. Storage bucket -----------------------------------------------------
insert into storage.buckets (id, name, public)
values ('technical-bulletins', 'technical-bulletins', false)
on conflict (id) do nothing;

-- 3. Storage policies — authenticated users only -----------------------
do $$
begin
  -- Read
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename  = 'objects'
      and policyname = 'technical_bulletins_authenticated_read'
  ) then
    create policy technical_bulletins_authenticated_read
      on storage.objects for select
      using (bucket_id = 'technical-bulletins' and auth.role() = 'authenticated');
  end if;

  -- Insert
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename  = 'objects'
      and policyname = 'technical_bulletins_authenticated_insert'
  ) then
    create policy technical_bulletins_authenticated_insert
      on storage.objects for insert
      with check (bucket_id = 'technical-bulletins' and auth.role() = 'authenticated');
  end if;

  -- Update (upsert generated PDFs)
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename  = 'objects'
      and policyname = 'technical_bulletins_authenticated_update'
  ) then
    create policy technical_bulletins_authenticated_update
      on storage.objects for update
      using (bucket_id = 'technical-bulletins' and auth.role() = 'authenticated')
      with check (bucket_id = 'technical-bulletins' and auth.role() = 'authenticated');
  end if;

  -- Delete (replace prior version of a report)
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename  = 'objects'
      and policyname = 'technical_bulletins_authenticated_delete'
  ) then
    create policy technical_bulletins_authenticated_delete
      on storage.objects for delete
      using (bucket_id = 'technical-bulletins' and auth.role() = 'authenticated');
  end if;
end $$;
