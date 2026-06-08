-- =====================================================================
-- SQM Customer-Training Checklists
-- =====================================================================
--
-- Apply once in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Two tables:
--   1. training_checklist_templates  — admin-defined templates, one per
--      product line (XC, RAIL, DSX, LynX, ...) or "XFire" software.
--      `steps` is an ordered JSON array of { id, text }.
--   2. training_checklist_sessions   — an SQM filling out a template for a
--      specific customer training. Optionally linked to a field visit
--      (visit_purpose = 'Training'). `step_results` is a JSON array of
--      { id, text, done } snapshotting the template steps + checkoff state.
--
-- RLS disabled to match the technical_bulletins / document_library pattern;
-- the app gates template editing to admins and session creation to
-- admin/sqm.
-- =====================================================================

-- 1. Templates ----------------------------------------------------------
create table if not exists public.training_checklist_templates (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  product_line  text,                       -- gun-system product line, or null for XFire/general
  kind          text not null default 'product',  -- 'product' | 'xfire' | 'general'
  description   text,
  steps         jsonb not null default '[]'::jsonb,   -- [{ id, text }]
  active        boolean not null default true,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists tct_product_line_idx
  on public.training_checklist_templates(product_line);
create index if not exists tct_active_idx
  on public.training_checklist_templates(active);

alter table public.training_checklist_templates disable row level security;

-- 2. Sessions -----------------------------------------------------------
create table if not exists public.training_checklist_sessions (
  id              uuid primary key default gen_random_uuid(),
  template_id     uuid references public.training_checklist_templates(id) on delete set null,
  template_name   text,                       -- snapshot of template name
  product_line    text,
  kind            text,                        -- snapshot of template kind
  field_visit_id  text,                        -- optional link to fieldvisits.field_visit_id
  customer        text,
  location        text,
  trainer_name    text,                        -- SQM who ran it (auto-captured)
  trainer_id      text,
  training_date   date not null default current_date,
  step_results    jsonb not null default '[]'::jsonb,  -- [{ id, text, done }]
  notes           text,
  signoff_name    text,                        -- customer/trainer signoff
  status          text not null default 'in_progress',  -- 'in_progress' | 'completed'
  completed_at    timestamptz,
  created_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists tcs_field_visit_idx
  on public.training_checklist_sessions(field_visit_id);
create index if not exists tcs_template_idx
  on public.training_checklist_sessions(template_id);
create index if not exists tcs_created_at_idx
  on public.training_checklist_sessions(created_at desc);

alter table public.training_checklist_sessions disable row level security;

-- 3. Seed templates (one per in-use product line + XFire) ---------------
-- Only inserts if no template with the same name already exists.
insert into public.training_checklist_templates (name, product_line, kind, description, steps)
select v.name, v.product_line, v.kind, v.description, v.steps::jsonb
from (values
  ('XFire Panel Software Training', null, 'xfire',
   'Customer training for XFire Panel software.',
   '[{"id":"s1","text":"Review panel overview & safety"},{"id":"s2","text":"Walk through software UI / navigation"},{"id":"s3","text":"Configure a stage / sequence"},{"id":"s4","text":"Demonstrate firing sequence & arming"},{"id":"s5","text":"Review diagnostics & error handling"},{"id":"s6","text":"Cover firmware update procedure"},{"id":"s7","text":"Q&A and confirm customer competency"}]'),
  ('XC Gun System Training', 'XC', 'product',
   'Customer training for the XC gun system product line.',
   '[{"id":"s1","text":"Product overview & safety briefing"},{"id":"s2","text":"Assembly / make-up procedure"},{"id":"s3","text":"Connection & continuity checks"},{"id":"s4","text":"Arming / disarming demonstration"},{"id":"s5","text":"Troubleshooting common issues"},{"id":"s6","text":"Q&A and confirm customer competency"}]'),
  ('RAIL Gun System Training', 'RAIL', 'product',
   'Customer training for the RAIL gun system product line.',
   '[{"id":"s1","text":"Product overview & safety briefing"},{"id":"s2","text":"Assembly / make-up procedure"},{"id":"s3","text":"Connection & continuity checks"},{"id":"s4","text":"Arming / disarming demonstration"},{"id":"s5","text":"Troubleshooting common issues"},{"id":"s6","text":"Q&A and confirm customer competency"}]'),
  ('DSX Gun System Training', 'DSX', 'product',
   'Customer training for the DSX gun system product line.',
   '[{"id":"s1","text":"Product overview & safety briefing"},{"id":"s2","text":"Assembly / make-up procedure"},{"id":"s3","text":"Connection & continuity checks"},{"id":"s4","text":"Arming / disarming demonstration"},{"id":"s5","text":"Troubleshooting common issues"},{"id":"s6","text":"Q&A and confirm customer competency"}]'),
  ('LynX Gun System Training', 'LynX', 'product',
   'Customer training for the LynX gun system product line.',
   '[{"id":"s1","text":"Product overview & safety briefing"},{"id":"s2","text":"Assembly / make-up procedure"},{"id":"s3","text":"Connection & continuity checks"},{"id":"s4","text":"Arming / disarming demonstration"},{"id":"s5","text":"Troubleshooting common issues"},{"id":"s6","text":"Q&A and confirm customer competency"}]')
) as v(name, product_line, kind, description, steps)
where not exists (
  select 1 from public.training_checklist_templates t where t.name = v.name
);
