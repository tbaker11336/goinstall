-- Phase 1 foundations: tenancy, users and roles, CRM (contacts, projects,
-- messages), activity log and integrations.
--
-- Tenancy rules:
--   * Every tenant-owned row carries company_id. RLS limits every query to the
--     caller's company, for the web console and the installer app alike.
--   * Foreign keys between tenant tables are composite (company_id, id), so a
--     row can never point at another company's row even if RLS were bypassed.
--   * The service role (server-side only) bypasses RLS for tenant onboarding,
--     webhooks and imports.

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type public.app_role as enum ('admin', 'office', 'installer', 'subcontractor');

create type public.product_type as enum ('solar', 'battery', 'ev');

-- Contact pipeline (Kanban columns).
create type public.contact_stage as enum (
  'new_enquiry', 'survey', 'design', 'proposal_sent', 'won', 'lost'
);

-- Project workflow. Everything before deposit_paid is selling and can end in
-- lost; everything from deposit_paid on is delivery.
create type public.project_stage as enum (
  'enquiry', 'survey', 'design', 'proposal_sent', 'accepted',
  'deposit_paid', 'kit_ordered', 'scheduled', 'complete', 'lost'
);

create type public.message_channel as enum ('email', 'whatsapp', 'note', 'system');

create type public.message_direction as enum ('inbound', 'outbound', 'internal');

-- ---------------------------------------------------------------------------
-- Shared trigger functions
-- ---------------------------------------------------------------------------

create function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- companies (tenant root)
-- ---------------------------------------------------------------------------

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  logo_path text,
  website text,
  phone text,
  email text,
  address_line1 text,
  address_line2 text,
  town text,
  county text,
  postcode text,
  company_number text,
  vat_number text,
  mcs_number text,
  competent_person_scheme_number text,
  brand_primary_colour text check (brand_primary_colour ~ '^#[0-9a-fA-F]{6}$'),
  brand_secondary_colour text check (brand_secondary_colour ~ '^#[0-9a-fA-F]{6}$'),
  bank_account_name text,
  bank_sort_code text check (bank_sort_code ~ '^\d{2}-?\d{2}-?\d{2}$'),
  bank_account_number text check (bank_account_number ~ '^\d{8}$'),
  document_prefix text,
  default_deposit_pct numeric(5, 2) check (default_deposit_pct between 0 and 100),
  payment_terms text,
  terms_and_conditions text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid()
);

create trigger companies_updated_at before update on public.companies
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- teams
-- ---------------------------------------------------------------------------

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  colour text check (colour ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  unique (company_id, id),
  unique (company_id, name)
);

create trigger teams_updated_at before update on public.teams
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- users (one row per auth user; a user belongs to exactly one company)
-- ---------------------------------------------------------------------------

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  full_name text not null,
  email text not null,
  phone text,
  role public.app_role not null,
  team_id uuid,
  is_active boolean not null default true,
  -- Per-user UI preferences, e.g. {"contacts_view": "kanban"}.
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  unique (company_id, id),
  foreign key (company_id, team_id) references public.teams (company_id, id) on delete set null (team_id)
);

create index users_company_idx on public.users (company_id);

create trigger users_updated_at before update on public.users
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Auth helpers used by RLS policies. SECURITY DEFINER so they can read
-- public.users without recursing through its own policies.
-- ---------------------------------------------------------------------------

create function private.current_company_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select u.company_id from public.users u where u.id = auth.uid() and u.is_active;
$$;

create function private.current_app_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select u.role from public.users u where u.id = auth.uid() and u.is_active;
$$;

create function private.has_role(variadic roles public.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.current_app_role() = any (roles), false);
$$;

-- Users may edit their own name, phone and preferences, but only an admin may
-- change role, team, company or active status.
create function private.guard_user_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is null or private.has_role('admin') then
    if new.company_id is distinct from old.company_id and auth.uid() is not null then
      raise exception 'company_id cannot be changed' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.role is distinct from old.role
     or new.team_id is distinct from old.team_id
     or new.company_id is distinct from old.company_id
     or new.is_active is distinct from old.is_active
     or new.email is distinct from old.email then
    raise exception 'only an admin can change role, team, email or status' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger users_guard before update on public.users
  for each row execute function private.guard_user_update();

-- ---------------------------------------------------------------------------
-- contacts
-- ---------------------------------------------------------------------------

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  phone text,
  email text,
  address_line1 text,
  address_line2 text,
  town text,
  county text,
  postcode text,
  source text,
  interested_in public.product_type[] not null default '{}',
  stage public.contact_stage not null default 'new_enquiry',
  owner_id uuid,
  tags text[] not null default '{}',
  lost_reason text,
  last_activity_at timestamptz not null default now(),
  -- Id of the record in the system this contact was imported from (Lovable).
  legacy_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  unique (company_id, id),
  unique (company_id, legacy_id),
  foreign key (company_id, owner_id) references public.users (company_id, id) on delete set null (owner_id),
  check (stage <> 'lost' or nullif(trim(lost_reason), '') is not null)
);

create index contacts_company_stage_idx on public.contacts (company_id, stage);
create index contacts_company_email_idx on public.contacts (company_id, lower(email));
create index contacts_company_phone_idx on public.contacts (company_id, phone);

create trigger contacts_updated_at before update on public.contacts
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- projects (the core job record)
-- ---------------------------------------------------------------------------

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  contact_id uuid not null,
  site_address_line1 text,
  site_address_line2 text,
  site_town text,
  site_county text,
  site_postcode text,
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  products public.product_type[] not null default '{}',
  stage public.project_stage not null default 'enquiry',
  -- Stage the project was in when it was marked lost, so it can be reopened.
  lost_from_stage public.project_stage,
  lost_reason text,
  value numeric(12, 2) check (value >= 0),
  owner_id uuid,
  -- First day of the target install month.
  target_install_month date check (extract(day from target_install_month) = 1),
  stage_changed_at timestamptz not null default now(),
  legacy_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  unique (company_id, id),
  unique (company_id, legacy_id),
  foreign key (company_id, contact_id) references public.contacts (company_id, id) on delete cascade,
  foreign key (company_id, owner_id) references public.users (company_id, id) on delete set null (owner_id),
  check (stage <> 'lost' or nullif(trim(lost_reason), '') is not null)
);

create index projects_company_stage_idx on public.projects (company_id, stage);
create index projects_contact_idx on public.projects (company_id, contact_id);

create trigger projects_updated_at before update on public.projects
  for each row execute function private.set_updated_at();

-- A project can only be marked lost from a selling stage. Moving back between
-- stages is allowed (staff can correct mistakes); the app layer decides which
-- forward moves are offered.
create function private.guard_project_stage() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.stage is distinct from old.stage then
    if new.stage = 'lost' then
      if old.stage in ('deposit_paid', 'kit_ordered', 'scheduled', 'complete') then
        raise exception 'a project cannot be marked lost after the deposit is paid'
          using errcode = 'check_violation';
      end if;
      new.lost_from_stage := old.stage;
    elsif old.stage = 'lost' then
      new.lost_from_stage := null;
      new.lost_reason := null;
    end if;
    new.stage_changed_at := now();
  end if;
  return new;
end;
$$;

create trigger projects_stage_guard before update of stage on public.projects
  for each row execute function private.guard_project_stage();

-- ---------------------------------------------------------------------------
-- messages (unified thread: email, WhatsApp, notes, system events)
-- ---------------------------------------------------------------------------

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  contact_id uuid not null,
  project_id uuid,
  channel public.message_channel not null,
  direction public.message_direction not null,
  subject text,
  body text not null default '',
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  provider_message_id text,
  sent_by uuid,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  foreign key (company_id, contact_id) references public.contacts (company_id, id) on delete cascade,
  foreign key (company_id, project_id) references public.projects (company_id, id) on delete set null (project_id),
  foreign key (company_id, sent_by) references public.users (company_id, id) on delete set null (sent_by),
  check ((channel in ('note', 'system')) = (direction = 'internal'))
);

create index messages_contact_idx on public.messages (company_id, contact_id, created_at desc);
create index messages_unread_idx on public.messages (company_id, created_at desc)
  where direction = 'inbound' and read_at is null;
create unique index messages_provider_idx on public.messages (company_id, channel, provider_message_id)
  where provider_message_id is not null;

create trigger messages_updated_at before update on public.messages
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- activity_log (append-only audit trail and project feed)
-- ---------------------------------------------------------------------------

create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  project_id uuid,
  contact_id uuid,
  actor_id uuid references auth.users (id) on delete set null default auth.uid(),
  event text not null,
  payload jsonb not null default '{}'::jsonb,
  -- clock_timestamp, not now(): several events in one transaction must keep
  -- their order in the feed.
  created_at timestamptz not null default clock_timestamp(),
  foreign key (company_id, project_id) references public.projects (company_id, id) on delete cascade,
  foreign key (company_id, contact_id) references public.contacts (company_id, id) on delete cascade,
  check (project_id is not null or contact_id is not null)
);

create index activity_log_project_idx on public.activity_log (company_id, project_id, created_at desc);
create index activity_log_contact_idx on public.activity_log (company_id, contact_id, created_at desc);

-- Write project creation and every stage change to the activity log, whoever
-- makes the change (staff, webhook or import).
create function private.log_project_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activity_log (company_id, project_id, contact_id, actor_id, event, payload)
    values (new.company_id, new.id, new.contact_id, auth.uid(), 'project_created',
            jsonb_build_object('stage', new.stage, 'products', new.products));
  elsif new.stage is distinct from old.stage then
    insert into public.activity_log (company_id, project_id, contact_id, actor_id, event, payload)
    values (new.company_id, new.id, new.contact_id, auth.uid(), 'stage_changed',
            jsonb_strip_nulls(jsonb_build_object(
              'from', old.stage, 'to', new.stage, 'lost_reason', new.lost_reason)));
  end if;
  return null;
end;
$$;

create trigger projects_activity after insert or update of stage on public.projects
  for each row execute function private.log_project_activity();

create function private.log_contact_stage() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.stage is distinct from old.stage then
    insert into public.activity_log (company_id, contact_id, actor_id, event, payload)
    values (new.company_id, new.id, auth.uid(), 'contact_stage_changed',
            jsonb_strip_nulls(jsonb_build_object(
              'from', old.stage, 'to', new.stage, 'lost_reason', new.lost_reason)));
  end if;
  return null;
end;
$$;

create trigger contacts_activity after update of stage on public.contacts
  for each row execute function private.log_contact_stage();

-- ---------------------------------------------------------------------------
-- integrations (Settings > Integrations). Tokens live in Supabase Vault;
-- this table only stores a reference.
-- ---------------------------------------------------------------------------

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  provider text not null,
  -- Set for per-user connections such as calendars; null for company-wide.
  user_id uuid,
  status text not null default 'disconnected'
    check (status in ('disconnected', 'connected', 'error')),
  tokens_ref text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  foreign key (company_id, user_id) references public.users (company_id, id) on delete cascade,
  unique nulls not distinct (company_id, provider, user_id)
);

create trigger integrations_updated_at before update on public.integrations
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.companies enable row level security;
alter table public.teams enable row level security;
alter table public.users enable row level security;
alter table public.contacts enable row level security;
alter table public.projects enable row level security;
alter table public.messages enable row level security;
alter table public.activity_log enable row level security;
alter table public.integrations enable row level security;

-- Nothing is readable without logging in. Customer-facing pages (survey,
-- proposal) go through server routes that check the public token.
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
grant usage on schema private to authenticated;
revoke all on all functions in schema private from public;
grant execute on function private.current_company_id(), private.current_app_role(),
  private.has_role(public.app_role[]) to authenticated;

-- companies: every member can read their own company; admins can edit it.
-- Creating and deleting companies is done server-side with the service role.
create policy companies_select on public.companies for select to authenticated
  using (id = (select private.current_company_id()));
create policy companies_update on public.companies for update to authenticated
  using (id = (select private.current_company_id()) and (select private.has_role('admin')))
  with check (id = (select private.current_company_id()));

-- teams: readable by every member; managed by admins.
create policy teams_select on public.teams for select to authenticated
  using (company_id = (select private.current_company_id()));
create policy teams_write on public.teams for all to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin')))
  with check (company_id = (select private.current_company_id()) and (select private.has_role('admin')));

-- users: members can see colleagues; admins manage everyone; users can edit
-- their own profile (users_guard limits which columns).
create policy users_select on public.users for select to authenticated
  using (company_id = (select private.current_company_id()));
create policy users_update_self on public.users for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
create policy users_admin_write on public.users for all to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin')))
  with check (company_id = (select private.current_company_id()) and (select private.has_role('admin')));

-- CRM tables: office staff and admins. Installer and subcontractor access to
-- assigned jobs arrives with bookings in phase 5.
create policy contacts_select on public.contacts for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));
create policy contacts_insert on public.contacts for insert to authenticated
  with check (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));
create policy contacts_update on public.contacts for update to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')))
  with check (company_id = (select private.current_company_id()));
-- Deleting customer data (UK GDPR erasure) is an admin action.
create policy contacts_delete on public.contacts for delete to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin')));

create policy projects_select on public.projects for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));
create policy projects_insert on public.projects for insert to authenticated
  with check (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));
create policy projects_update on public.projects for update to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')))
  with check (company_id = (select private.current_company_id()));
create policy projects_delete on public.projects for delete to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin')));

create policy messages_select on public.messages for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));
-- Staff write notes and outbound messages; inbound and system messages are
-- written server-side by webhooks.
create policy messages_insert on public.messages for insert to authenticated
  with check (
    company_id = (select private.current_company_id())
    and (select private.has_role('admin', 'office'))
    and direction <> 'inbound'
    and channel <> 'system'
  );
-- Only read receipts and note edits are made from the console.
create policy messages_update on public.messages for update to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')))
  with check (company_id = (select private.current_company_id()));

-- activity_log is append-only for staff: no update or delete policies.
create policy activity_log_select on public.activity_log for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));
create policy activity_log_insert on public.activity_log for insert to authenticated
  with check (
    company_id = (select private.current_company_id())
    and (select private.has_role('admin', 'office'))
    and actor_id = (select auth.uid())
  );

-- integrations: admins only, plus each user's own per-user connections.
create policy integrations_admin on public.integrations for all to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin')))
  with check (company_id = (select private.current_company_id()) and (select private.has_role('admin')));
create policy integrations_own on public.integrations for all to authenticated
  using (company_id = (select private.current_company_id()) and user_id = (select auth.uid()))
  with check (company_id = (select private.current_company_id()) and user_id = (select auth.uid()));
