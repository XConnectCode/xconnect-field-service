-- Driver (hotshot) load checklist tables.
-- Mirrors existing conventions: row_id text PK default gen_random_uuid()::text,
-- RLS enabled (edge function uses service-role + requireUser gating), updated_by text.

create table if not exists public.driver_loads (
  row_id            text primary key default (gen_random_uuid())::text,
  load_number       text,
  delivery_date     date,
  origin_district   text,           -- XC base load departs from (Midland|Williston)
  customer          text,           -- auto-pulled from pallet/packing slip
  customer_district text,           -- auto-pulled from pallet/packing slip
  destination       text,
  packing_slip_no   text,
  mode_of_delivery  text,
  trailer_connected boolean default false,
  driver_type       text default 'internal',   -- 'internal' | 'third_party'
  driver            text,                       -- internal driver email/name
  driver_name       text,                       -- 3rd-party driver name
  driver_company    text,                       -- 3rd-party carrier company
  hazmat_load       boolean default false,
  hardware_present  boolean default false,
  ancillary_explosives boolean default false,
  explosive_types   text[] default '{}',        -- detonators|power_charges|igniters
  document_correlation boolean default false,   -- hard blocker
  items_secure      boolean default false,      -- hard blocker
  driver_sig_url     text,
  inspector_name     text,
  inspector_sig_url  text,
  manager_name       text,
  manager_sig_url    text,
  status            text default 'draft',       -- draft|ready|departed|delivered
  departed_by       text,
  departed_at       timestamptz,
  notes             text,
  updated_by        text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create table if not exists public.driver_load_items (
  row_id              text primary key default (gen_random_uuid())::text,
  load_row_id         text not null references public.driver_loads(row_id) on delete cascade,
  pallet_build_no     text,
  description         text,
  qty_expected        integer default 0,
  qty_loaded          integer default 0,
  destination         text,
  checked             boolean default false,
  note                text,
  source_pallet_row_id text,        -- FK to qc_pallets added in the QC migration (PR 4)
  created_at          timestamptz default now()
);

create index if not exists idx_driver_load_items_load on public.driver_load_items(load_row_id);
create index if not exists idx_driver_loads_status on public.driver_loads(status);

-- RLS on (no public policies; edge function service-role bypasses, requireUser gates access).
alter table public.driver_loads enable row level security;
alter table public.driver_load_items enable row level security;
