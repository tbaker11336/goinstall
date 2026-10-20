-- Phase 5: kit lists and purchase orders, bookings and teams, install
-- checklists, and installer/subcontractor access to the jobs they're on.
--
-- Access: office staff and admins see everything in their company.
-- Installers and subcontractors see only projects they're assigned to through
-- booking_assignments (private.is_assigned_to_project), and never prices:
-- prices stay in tables they can't select (supplier_products,
-- purchase_order_lines, proposal_lines, invoices, payments).

create type public.booking_type as enum ('survey', 'install', 'scaffold_up', 'scaffold_down', 'task');
create type public.booking_status as enum ('tentative', 'confirmed', 'in_progress', 'completed', 'cancelled');
create type public.po_status as enum ('draft', 'sent', 'confirmed', 'delivered', 'cancelled');

-- ---------------------------------------------------------------------------
-- kit_items: the kit list for a project, generated from the accepted
-- proposal. supplier_id is the staff override; null means "cheapest in stock".
-- No prices here, so installers can check kit in the app.
-- ---------------------------------------------------------------------------

create table public.kit_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  project_id uuid not null,
  product_id uuid not null,
  -- Name as shown in the kit list and the app (installers can't read products, which carry prices).
  description text not null check (length(trim(description)) > 0),
  quantity numeric(10, 2) not null check (quantity > 0),
  supplier_id uuid,
  position integer not null default 0,
  -- Reported by the installer from the app.
  issue text check (issue in ('missing', 'damaged')),
  issue_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  unique (company_id, id),
  unique (company_id, project_id, product_id),
  foreign key (company_id, project_id) references public.projects (company_id, id) on delete cascade,
  foreign key (company_id, product_id) references public.products (company_id, id),
  foreign key (company_id, supplier_id) references public.suppliers (company_id, id) on delete set null (supplier_id)
);

create trigger kit_items_updated_at before update on public.kit_items
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- purchase_orders and lines (one order per supplier)
-- ---------------------------------------------------------------------------

alter table public.companies
  add column next_po_number integer not null default 1,
  add column depot_address text;

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  project_id uuid not null,
  supplier_id uuid not null,
  number text not null,
  status public.po_status not null default 'draft',
  deliver_to text not null default 'site' check (deliver_to in ('site', 'depot')),
  delivery_address text,
  expected_date date,
  total_pence bigint not null default 0,
  notes text,
  sent_at timestamptz,
  delivered_at timestamptz,
  file_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  unique (company_id, id),
  unique (company_id, number),
  foreign key (company_id, project_id) references public.projects (company_id, id) on delete cascade,
  foreign key (company_id, supplier_id) references public.suppliers (company_id, id),
  foreign key (company_id, file_id) references public.files (company_id, id) on delete set null (file_id)
);

create index purchase_orders_project_idx on public.purchase_orders (company_id, project_id);

create trigger purchase_orders_updated_at before update on public.purchase_orders
  for each row execute function private.set_updated_at();

create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  purchase_order_id uuid not null,
  product_id uuid,
  supplier_sku text,
  description text not null check (length(trim(description)) > 0),
  quantity numeric(10, 2) not null check (quantity > 0),
  unit_cost_pence bigint not null check (unit_cost_pence >= 0),
  line_total_pence bigint not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  foreign key (company_id, purchase_order_id) references public.purchase_orders (company_id, id) on delete cascade,
  foreign key (company_id, product_id) references public.products (company_id, id)
);

create trigger purchase_order_lines_updated_at before update on public.purchase_order_lines
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- bookings and assignments
-- ---------------------------------------------------------------------------

alter table public.teams
  -- Calendar feed link: HMAC(secret, team id + nonce); rotating the nonce revokes it.
  add column calendar_nonce text;

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  -- Null only for general tasks (e.g. "Collect from depot").
  project_id uuid,
  type public.booking_type not null,
  status public.booking_status not null default 'tentative',
  title text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default true,
  notes text,
  customer_confirmed_at timestamptz,
  customer_notified_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  -- Customer sign-off from the installer app.
  signoff_name text,
  signoff_signature_file_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  unique (company_id, id),
  check (ends_at > starts_at),
  check (project_id is not null or type = 'task'),
  foreign key (company_id, project_id) references public.projects (company_id, id) on delete cascade,
  foreign key (company_id, signoff_signature_file_id) references public.files (company_id, id) on delete set null (signoff_signature_file_id)
);

create index bookings_company_time_idx on public.bookings (company_id, starts_at, ends_at) where status <> 'cancelled';
create index bookings_project_idx on public.bookings (company_id, project_id);

create trigger bookings_updated_at before update on public.bookings
  for each row execute function private.set_updated_at();

create table public.booking_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  booking_id uuid not null,
  role text not null check (role in ('team', 'electrician', 'scaffolder', 'surveyor')),
  team_id uuid,
  user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  check ((team_id is null) <> (user_id is null)),
  unique (company_id, booking_id, role),
  foreign key (company_id, booking_id) references public.bookings (company_id, id) on delete cascade,
  foreign key (company_id, team_id) references public.teams (company_id, id) on delete cascade,
  foreign key (company_id, user_id) references public.users (company_id, id) on delete cascade
);

create index booking_assignments_user_idx on public.booking_assignments (company_id, user_id);
create index booking_assignments_team_idx on public.booking_assignments (company_id, team_id);

create trigger booking_assignments_updated_at before update on public.booking_assignments
  for each row execute function private.set_updated_at();

-- Is the caller on a (not cancelled) booking for this project, directly or
-- through their team?
create function private.is_assigned_to_project(p_project_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.booking_assignments ba
    join public.bookings b on b.id = ba.booking_id and b.company_id = ba.company_id
    where b.project_id = p_project_id
      and b.company_id = private.current_company_id()
      and b.status <> 'cancelled'
      and (ba.user_id = auth.uid() or ba.team_id = (select u.team_id from public.users u where u.id = auth.uid()))
  );
$$;

create function private.is_assigned_to_booking(p_booking_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.booking_assignments ba
    where ba.booking_id = p_booking_id
      and ba.company_id = private.current_company_id()
      and (ba.user_id = auth.uid() or ba.team_id = (select u.team_id from public.users u where u.id = auth.uid()))
  );
$$;

grant execute on function private.is_assigned_to_project(uuid) to authenticated;
grant execute on function private.is_assigned_to_booking(uuid) to authenticated;

-- Installers may start, complete and sign off their own bookings, but not
-- move, re-type or reassign them.
create function private.guard_booking_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' and not private.has_role('admin', 'office') then
    if new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at
       or new.type is distinct from old.type or new.project_id is distinct from old.project_id
       or new.title is distinct from old.title or new.notes is distinct from old.notes
       or new.customer_confirmed_at is distinct from old.customer_confirmed_at
       or new.customer_notified_at is distinct from old.customer_notified_at
       or new.status not in ('in_progress', 'completed') and new.status is distinct from old.status then
      raise exception 'installers can only start, complete and sign off a booking' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

create trigger bookings_guard before update on public.bookings
  for each row execute function private.guard_booking_update();

-- ---------------------------------------------------------------------------
-- checklists: per-company template steps; per-booking completed items
-- ---------------------------------------------------------------------------

create table public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  -- 'install' steps are grouped by product; 'handover' is the customer sign-off list.
  kind text not null default 'install' check (kind in ('install', 'handover')),
  product text not null check (product in ('solar', 'battery', 'ev', 'general')),
  title text not null check (length(trim(title)) > 0),
  help text,
  position integer not null default 0,
  requires_photo boolean not null default false,
  requires_serial boolean not null default false,
  -- Readings to record, e.g. [{"key": "ir_mohm", "label": "Insulation resistance", "unit": "MΩ"}].
  -- Labels only: no pass/fail values are assumed.
  readings jsonb not null default '[]'::jsonb check (jsonb_typeof(readings) = 'array'),
  -- Starter steps drafted by GoInstall until the company reviews them.
  is_draft boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  unique (company_id, id)
);

create trigger checklist_templates_updated_at before update on public.checklist_templates
  for each row execute function private.set_updated_at();

create table public.checklist_items (
  -- Generated on the device, so offline captures sync idempotently.
  id uuid primary key,
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  booking_id uuid not null,
  project_id uuid not null,
  template_id uuid,
  kind text not null default 'install' check (kind in ('install', 'handover')),
  product text not null,
  title text not null,
  done boolean not null default false,
  serial text,
  readings jsonb not null default '{}'::jsonb check (jsonb_typeof(readings) = 'object'),
  photo_file_ids uuid[] not null default '{}',
  note text,
  completed_by uuid,
  -- Device time of the capture; last write wins on sync.
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  unique (company_id, id),
  unique (company_id, booking_id, template_id),
  foreign key (company_id, booking_id) references public.bookings (company_id, id) on delete cascade,
  foreign key (company_id, project_id) references public.projects (company_id, id) on delete cascade,
  foreign key (company_id, template_id) references public.checklist_templates (company_id, id) on delete set null (template_id),
  foreign key (company_id, completed_by) references public.users (company_id, id) on delete set null (completed_by)
);

create trigger checklist_items_updated_at before update on public.checklist_items
  for each row execute function private.set_updated_at();

-- Overwritten checklist values are kept (offline conflicts: last write wins).
create table public.checklist_item_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  checklist_item_id uuid not null,
  done boolean,
  serial text,
  readings jsonb,
  note text,
  completed_by uuid,
  captured_at timestamptz,
  replaced_at timestamptz not null default clock_timestamp(),
  foreign key (company_id, checklist_item_id) references public.checklist_items (company_id, id) on delete cascade
);

create function private.keep_checklist_history() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.done is distinct from old.done or new.serial is distinct from old.serial
     or new.readings is distinct from old.readings or new.note is distinct from old.note then
    insert into public.checklist_item_history (company_id, checklist_item_id, done, serial, readings, note, completed_by, captured_at)
    values (old.company_id, old.id, old.done, old.serial, old.readings, old.note, old.completed_by, old.captured_at);
  end if;
  return new;
end;
$$;

create trigger checklist_items_history after update on public.checklist_items
  for each row execute function private.keep_checklist_history();

-- Starter checklist (drafts, editable in Settings). Readings are labels only.
create function private.seed_checklist_defaults(p_company_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.checklist_templates (company_id, kind, product, title, help, position, requires_photo, requires_serial, readings, is_draft, created_by)
  values
    (p_company_id, 'install', 'general', 'Site safety check and RAMS briefing', 'Access, ladders or scaffold, isolation points.', 10, true, false, '[]', true, null),
    (p_company_id, 'install', 'solar', 'Roof fixings and rails installed', 'Photo of fixings before panels go on.', 20, true, false, '[]', true, null),
    (p_company_id, 'install', 'solar', 'Panels installed as designed', 'Photo of the finished array.', 30, true, false, '[]', true, null),
    (p_company_id, 'install', 'solar', 'Inverter installed', null, 40, true, true, '[]', true, null),
    (p_company_id, 'install', 'solar', 'DC string tests',
      'Record each string as measured.', 50, true, false,
      '[{"key":"voc_v","label":"Open-circuit voltage","unit":"V"},{"key":"isc_a","label":"Short-circuit current","unit":"A"},{"key":"ir_mohm","label":"Insulation resistance","unit":"MΩ"}]', true, null),
    (p_company_id, 'install', 'battery', 'Battery installed and commissioned', null, 60, true, true, '[]', true, null),
    (p_company_id, 'install', 'ev', 'Charger mounted', 'Photo of the charger in place.', 70, true, true, '[]', true, null),
    (p_company_id, 'install', 'ev', 'Cable route and protection', 'Photo of the cable run and the protective device.', 80, true, false, '[]', true, null),
    (p_company_id, 'install', 'ev', 'Electrical tests',
      'Record as measured.', 90, true, false,
      '[{"key":"zs_ohm","label":"Earth fault loop impedance (Zs)","unit":"Ω"},{"key":"rcd_ms","label":"RCD trip time","unit":"ms"},{"key":"ir_mohm","label":"Insulation resistance","unit":"MΩ"}]', true, null),
    (p_company_id, 'install', 'general', 'Consumer unit and labelling', 'Photo of the board with labels.', 100, true, false, '[]', true, null),
    (p_company_id, 'handover', 'general', 'Monitoring app set up with the customer', null, 10, false, false, '[]', true, null),
    (p_company_id, 'handover', 'ev', 'Charger paired with the customer''s app or card', null, 20, false, false, '[]', true, null),
    (p_company_id, 'handover', 'general', 'Customer shown how to isolate the system', null, 30, false, false, '[]', true, null),
    (p_company_id, 'handover', 'general', 'Site left clean and tidy', null, 40, false, false, '[]', true, null);
end;
$$;

create function private.seed_checklists_for_new_company() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.seed_checklist_defaults(new.id);
  return null;
end;
$$;

create trigger companies_seed_checklists after insert on public.companies
  for each row execute function private.seed_checklists_for_new_company();

select private.seed_checklist_defaults(id) from public.companies;

revoke all on function private.seed_checklist_defaults(uuid) from public;
revoke all on function private.seed_checklists_for_new_company() from public;

-- Allocate the next purchase order number.
create or replace function public.next_document_number(p_kind text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := private.current_company_id();
  v_n integer;
begin
  if v_company is null or not private.has_role('admin', 'office') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_kind = 'proposal' then
    update public.companies set next_proposal_number = next_proposal_number + 1 where id = v_company returning next_proposal_number - 1 into v_n;
  elsif p_kind = 'invoice' then
    update public.companies set next_invoice_number = next_invoice_number + 1 where id = v_company returning next_invoice_number - 1 into v_n;
  elsif p_kind = 'purchase_order' then
    update public.companies set next_po_number = next_po_number + 1 where id = v_company returning next_po_number - 1 into v_n;
  else
    raise exception 'unknown document kind %', p_kind;
  end if;
  return v_n;
end;
$$;

-- Files from the installer app may be signatures and checklist photos.
alter table public.files drop constraint files_kind_check;
alter table public.files add constraint files_kind_check check (kind in ('photo', 'document', 'signature', 'attachment', 'purchase_order'));

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.kit_items enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_assignments enable row level security;
alter table public.checklist_templates enable row level security;
alter table public.checklist_items enable row level security;
alter table public.checklist_item_history enable row level security;

-- Office and admins: everything in the company.
create policy kit_items_staff on public.kit_items for all to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')))
  with check (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));
create policy purchase_orders_staff on public.purchase_orders for all to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')))
  with check (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));
create policy purchase_order_lines_staff on public.purchase_order_lines for all to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')))
  with check (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));
create policy bookings_staff on public.bookings for all to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')))
  with check (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));
create policy booking_assignments_staff on public.booking_assignments for all to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')))
  with check (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));
create policy checklist_templates_select on public.checklist_templates for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office', 'installer')));
create policy checklist_templates_admin on public.checklist_templates for all to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin')))
  with check (company_id = (select private.current_company_id()) and (select private.has_role('admin')));
create policy checklist_items_staff on public.checklist_items for all to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')))
  with check (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));
create policy checklist_item_history_staff on public.checklist_item_history for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));

-- Installers and subcontractors: their own bookings and the projects on them.
create policy bookings_assigned_select on public.bookings for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('installer', 'subcontractor')) and private.is_assigned_to_booking(id));
create policy bookings_assigned_update on public.bookings for update to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('installer')) and private.is_assigned_to_booking(id))
  with check (company_id = (select private.current_company_id()));
create policy booking_assignments_assigned on public.booking_assignments for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('installer', 'subcontractor')) and private.is_assigned_to_booking(booking_id));

create policy projects_assigned_select on public.projects for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('installer', 'subcontractor')) and private.is_assigned_to_project(id));
create policy contacts_assigned_select on public.contacts for select to authenticated
  using (
    company_id = (select private.current_company_id())
    and (select private.has_role('installer', 'subcontractor'))
    and exists (select 1 from public.projects p where p.contact_id = contacts.id and p.company_id = contacts.company_id and private.is_assigned_to_project(p.id))
  );

-- Installers (not subcontractors) run surveys, checklists and kit checks.
create policy kit_items_installer_select on public.kit_items for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('installer')) and private.is_assigned_to_project(project_id));
create policy kit_items_installer_update on public.kit_items for update to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('installer')) and private.is_assigned_to_project(project_id))
  with check (company_id = (select private.current_company_id()));
create policy checklist_items_installer on public.checklist_items for all to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('installer')) and private.is_assigned_to_booking(booking_id))
  with check (company_id = (select private.current_company_id()) and (select private.has_role('installer')) and private.is_assigned_to_booking(booking_id));

create policy surveys_installer_select on public.surveys for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('installer')) and private.is_assigned_to_project(project_id));
create policy survey_fields_installer_select on public.survey_fields for select to authenticated
  using (
    company_id = (select private.current_company_id()) and (select private.has_role('installer'))
    and exists (select 1 from public.surveys s where s.id = survey_fields.survey_id and s.company_id = survey_fields.company_id and private.is_assigned_to_project(s.project_id))
  );
create policy survey_fields_installer_write on public.survey_fields for insert to authenticated
  with check (
    company_id = (select private.current_company_id()) and (select private.has_role('installer'))
    and source = 'in_person' and edited_by = (select auth.uid())
    and exists (select 1 from public.surveys s where s.id = survey_fields.survey_id and s.company_id = survey_fields.company_id and private.is_assigned_to_project(s.project_id))
  );
create policy survey_fields_installer_update on public.survey_fields for update to authenticated
  using (
    company_id = (select private.current_company_id()) and (select private.has_role('installer'))
    and exists (select 1 from public.surveys s where s.id = survey_fields.survey_id and s.company_id = survey_fields.company_id and private.is_assigned_to_project(s.project_id))
  )
  with check (company_id = (select private.current_company_id()) and source = 'in_person' and edited_by = (select auth.uid()));
create policy survey_questions_installer_select on public.survey_questions for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('installer')));
create policy photo_categories_installer_select on public.photo_categories for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('installer')));

create policy files_installer_select on public.files for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('installer')) and project_id is not null and private.is_assigned_to_project(project_id));
create policy files_installer_insert on public.files for insert to authenticated
  with check (
    company_id = (select private.current_company_id()) and (select private.has_role('installer'))
    and source = 'installer_app' and kind in ('photo', 'signature')
    and project_id is not null and private.is_assigned_to_project(project_id)
  );

create policy solar_designs_assigned_select on public.solar_designs for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('installer', 'subcontractor')) and is_active and private.is_assigned_to_project(project_id));
create policy ev_designs_assigned_select on public.ev_designs for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('installer')) and is_active and private.is_assigned_to_project(project_id));

-- Customer signatures from the installer app are SVGs drawn by the server
-- from validated stroke data (never uploaded markup).
do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets
    set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf', 'image/svg+xml']
    where id = 'project-files';
  end if;
end;
$$;
