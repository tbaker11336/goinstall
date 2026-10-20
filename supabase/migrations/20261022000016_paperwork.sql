-- Phase 6: paperwork checklist per project, generated from its products,
-- design and install (see packages/core/src/paperwork.ts). DNO items follow
-- the ENA standard forms; GoInstall stores the DNO reference and portal link
-- rather than submitting. Office staff only.

create type public.paperwork_kind as enum (
  'g98_notification', 'g99_application', 'ev_dno_notification',
  'mcs_certificate', 'eic', 'warranty_registration', 'handover_pack'
);
create type public.paperwork_status as enum ('to_do', 'submitted', 'awaiting_response', 'approved', 'done');

create table public.paperwork_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  project_id uuid not null,
  kind public.paperwork_kind not null,
  -- Warranty registrations: one item per product.
  product_id uuid,
  title text not null check (length(trim(title)) > 0),
  timing text not null check (timing in ('before_install', 'after_install', 'after_commissioning', 'on_completion')),
  status public.paperwork_status not null default 'to_do',
  due_date date,
  -- Why the due date is what it is (e.g. "28 days after commissioning (ENA G98)").
  due_note text,
  -- False once staff set the due date themselves; until then it follows the rules.
  due_auto boolean not null default true,
  reference text,
  portal_url text check (portal_url is null or portal_url ~ '^https://'),
  notes text,
  -- Values staff enter for the form that GoInstall can't pre-fill (e.g. isolator location).
  fields jsonb not null default '{}'::jsonb check (jsonb_typeof(fields) = 'object'),
  submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  unique (company_id, id),
  foreign key (company_id, project_id) references public.projects (company_id, id) on delete cascade,
  foreign key (company_id, product_id) references public.products (company_id, id) on delete set null (product_id)
);

create unique index paperwork_items_one_idx on public.paperwork_items
  (company_id, project_id, kind, coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid));

create trigger paperwork_items_updated_at before update on public.paperwork_items
  for each row execute function private.set_updated_at();

alter table public.paperwork_items enable row level security;
create policy paperwork_items_staff on public.paperwork_items for all to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')))
  with check (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));

-- Files attached to a paperwork item (uploaded certificates, generated PDFs).
alter table public.files add column paperwork_item_id uuid;
alter table public.files add constraint files_paperwork_item_fk
  foreign key (company_id, paperwork_item_id) references public.paperwork_items (company_id, id) on delete set null (paperwork_item_id);
alter table public.files drop constraint files_source_check;
alter table public.files add constraint files_source_check check (source in ('online_survey', 'staff', 'installer_app', 'customer', 'generated'));
-- Staff may also store PDFs GoInstall generates for them.
drop policy files_insert on public.files;
create policy files_insert on public.files for insert to authenticated
  with check (
    company_id = (select private.current_company_id())
    and (select private.has_role('admin', 'office'))
    and source in ('staff', 'generated') and uploaded_by = (select auth.uid())
  );
create index files_paperwork_idx on public.files (company_id, paperwork_item_id) where paperwork_item_id is not null;

-- Supply details the DNO forms need.
alter table public.projects
  add column mpan text check (mpan is null or mpan ~ '^[0-9]{13}$');

-- One balance invoice per proposal, raised when the install is completed.
-- The customer pays it from a private link (hash stored, never the token).
alter table public.invoices add column pay_token_hash text unique;
create unique index invoices_one_balance_idx on public.invoices (company_id, proposal_id) where kind = 'balance' and status <> 'void';
