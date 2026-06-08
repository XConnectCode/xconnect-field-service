-- =====================================================================
-- Document Library — shared file storage (Manuals / Diagrams / How-To's /
-- Best Practices) in Supabase Storage + tracking table.
-- =====================================================================
--
-- Apply once in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Goals:
--   1. Track uploaded reference documents in `document_library` so every
--      authenticated user sees the same library across devices.
--   2. Create the private `document-library` bucket if it does not exist.
--   3. Allow any authenticated user to READ objects, and admin/sqm to
--      write. (App-level role gates uploads; storage policies keep the
--      bucket private so only authenticated users can read.)
--
-- Customer-facing share links are long-lived signed URLs minted client
-- side; the bucket itself stays private.
-- =====================================================================

-- 1. Tracking table -----------------------------------------------------
create table if not exists public.document_library (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  description   text,
  category      text not null default 'Manuals',     -- Manuals | Diagrams | How-To's | Best Practices
  product_line  text,                                -- optional tag (XC, RAIL, DSX, ... or XFire)
  file_path     text not null,                        -- object path inside document-library bucket
  file_name     text not null,
  file_size     bigint,
  content_type  text,
  uploaded_by   text,
  uploaded_by_name text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists document_library_category_idx
  on public.document_library(category);
create index if not exists document_library_product_line_idx
  on public.document_library(product_line);
create index if not exists document_library_created_at_idx
  on public.document_library(created_at desc);

-- Keep this table readable/writable through the app (RLS disabled to match
-- the technical_bulletins pattern; the app gates writes by role and the
-- bucket policies below keep files private to authenticated users).
alter table public.document_library disable row level security;

-- 2. Storage bucket -----------------------------------------------------
insert into storage.buckets (id, name, public)
values ('document-library', 'document-library', false)
on conflict (id) do nothing;

-- 3. Storage policies — authenticated read, authenticated write ---------
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'document_library_authenticated_read'
  ) then
    create policy document_library_authenticated_read
      on storage.objects for select
      using (bucket_id = 'document-library' and auth.role() = 'authenticated');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'document_library_authenticated_insert'
  ) then
    create policy document_library_authenticated_insert
      on storage.objects for insert
      with check (bucket_id = 'document-library' and auth.role() = 'authenticated');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'document_library_authenticated_update'
  ) then
    create policy document_library_authenticated_update
      on storage.objects for update
      using (bucket_id = 'document-library' and auth.role() = 'authenticated')
      with check (bucket_id = 'document-library' and auth.role() = 'authenticated');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'document_library_authenticated_delete'
  ) then
    create policy document_library_authenticated_delete
      on storage.objects for delete
      using (bucket_id = 'document-library' and auth.role() = 'authenticated');
  end if;
end $$;
