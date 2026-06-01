-- QC module for perforating guns: pallets, per-gun inspections, per-gun checklist items.
-- Conventions match driver_loads: text PK default (gen_random_uuid())::text, RLS enabled.
-- The edge function uses the service role (bypasses RLS) + requireUser gating.

create table if not exists public.qc_pallets (
  row_id            text primary key default (gen_random_uuid())::text,
  build_no          text,                 -- NetSuite Pallet Build #
  customer          text,
  destination       text,
  load_type         text default 'loaded' check (load_type in ('loaded','unloaded')),
  guns_total        integer default 0,
  status            text default 'open' check (status in ('open','in_progress','passed','failed')),
  signed_off_by     text,
  signed_off_at     timestamptz,
  notes             text,
  updated_by        text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create table if not exists public.qc_guns (
  row_id            text primary key default (gen_random_uuid())::text,
  pallet_row_id     text not null references public.qc_pallets(row_id) on delete cascade,
  gun_index         integer not null,
  serial            text,
  result            text default 'pending' check (result in ('pending','pass','fail')),
  inspected_by      text,
  inspected_at      timestamptz,
  notes             text,
  created_at        timestamptz default now()
);

create table if not exists public.qc_gun_checks (
  row_id            text primary key default (gen_random_uuid())::text,
  gun_row_id        text not null references public.qc_guns(row_id) on delete cascade,
  item_key          text not null,        -- parts|orientation|charges|detcord|wiring|build
  state             text default 'pass' check (state in ('pass','fail','na')),
  note              text,
  created_at        timestamptz default now()
);

create index if not exists qc_guns_pallet_idx on public.qc_guns(pallet_row_id);
create index if not exists qc_gun_checks_gun_idx on public.qc_gun_checks(gun_row_id);

alter table public.qc_pallets enable row level security;
alter table public.qc_guns enable row level security;
alter table public.qc_gun_checks enable row level security;

-- QC→Driver link: driver_load_items references a QC-passed pallet.
-- source_pallet_row_id was created as plain text in the driver migration; add the FK now.
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'driver_load_items_source_pallet_fk'
  ) then
    alter table public.driver_load_items
      add constraint driver_load_items_source_pallet_fk
      foreign key (source_pallet_row_id)
      references public.qc_pallets(row_id) on delete set null;
  end if;
end $$;
