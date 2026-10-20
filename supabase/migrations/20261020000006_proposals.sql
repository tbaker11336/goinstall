-- Phase 4: proposals, deposits and invoices.
--
-- One proposal per project covers every product. Each version is locked once
-- sent: editing after sending creates a new version. Lines are rows (not
-- JSON) with their own VAT rate, because UK VAT can differ by line (e.g.
-- energy-saving materials versus EV chargers). VAT rates are company
-- settings the business confirms; nothing is assumed. Money is pence.
--
-- Customers never log in: the public proposal page checks a hashed,
-- expiring token server-side, like the survey link.

create type public.proposal_status as enum ('draft', 'sent', 'viewed', 'accepted', 'declined', 'superseded');

-- ---------------------------------------------------------------------------
-- proposals
-- ---------------------------------------------------------------------------

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  project_id uuid not null,
  -- Shown as Q-0142; the number is per company, the version per proposal.
  number integer not null check (number > 0),
  version integer not null check (version > 0),
  status public.proposal_status not null default 'draft',
  title text not null default '',
  intro text,
  -- Snapshot of design figures for the customer summary, taken when built.
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  solar_design_id uuid,
  ev_design_id uuid,
  subtotal_pence bigint not null default 0,
  vat_pence bigint not null default 0,
  total_pence bigint not null default 0,
  deposit_pct numeric(5, 2) not null check (deposit_pct between 0 and 100),
  deposit_pence bigint not null default 0,
  valid_until date,
  terms text,
  -- The link token is an HMAC of the proposal id and this nonce with a
  -- server secret, so staff can copy the same link again; only its hash is
  -- stored for lookup.
  link_nonce text,
  token_hash text unique,
  token_expires_at timestamptz,
  sent_at timestamptz,
  sent_channels text[] not null default '{}',
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  view_count integer not null default 0,
  accepted_at timestamptz,
  accepted_name text,
  accepted_ip inet,
  accepted_user_agent text,
  signature_file_id uuid,
  declined_at timestamptz,
  decline_reason text,
  last_reminder_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  unique (company_id, id),
  unique (company_id, number, version),
  foreign key (company_id, project_id) references public.projects (company_id, id) on delete cascade,
  foreign key (company_id, solar_design_id) references public.solar_designs (company_id, id),
  foreign key (company_id, ev_design_id) references public.ev_designs (company_id, id),
  foreign key (company_id, signature_file_id) references public.files (company_id, id),
  check ((token_hash is null) = (token_expires_at is null)),
  check (status <> 'accepted' or (accepted_at is not null and nullif(trim(accepted_name), '') is not null))
);

create index proposals_project_idx on public.proposals (company_id, project_id, version desc);
-- One draft at a time per proposal. A sent version stays live for the
-- customer until its successor is sent, then it is superseded.
create unique index proposals_draft_idx on public.proposals (company_id, number) where status = 'draft';

create trigger proposals_updated_at before update on public.proposals
  for each row execute function private.set_updated_at();

-- A sent version's content is frozen; only tracking fields may change.
create function private.guard_proposal_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status <> 'draft' and (
    new.subtotal_pence is distinct from old.subtotal_pence or new.vat_pence is distinct from old.vat_pence
    or new.total_pence is distinct from old.total_pence or new.deposit_pct is distinct from old.deposit_pct
    or new.deposit_pence is distinct from old.deposit_pence or new.title is distinct from old.title
    or new.intro is distinct from old.intro or new.terms is distinct from old.terms or new.summary is distinct from old.summary
  ) then
    raise exception 'a sent proposal cannot be edited; create a new version' using errcode = 'check_violation';
  end if;
  -- Only the customer (through the token-checked public page, which runs
  -- as the service role) can view or accept a proposal.
  if current_user = 'authenticated' and new.status is distinct from old.status and new.status in ('viewed', 'accepted') then
    raise exception 'only the customer can view or accept a proposal' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger proposals_guard before update on public.proposals
  for each row execute function private.guard_proposal_update();

-- ---------------------------------------------------------------------------
-- proposal_lines
-- ---------------------------------------------------------------------------

create table public.proposal_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  proposal_id uuid not null,
  section text not null check (section in ('solar', 'battery', 'ev', 'installation')),
  position integer not null default 0,
  product_id uuid,
  description text not null check (length(trim(description)) > 0),
  quantity numeric(10, 2) not null default 1 check (quantity > 0),
  -- Negative for discounts (e.g. the shared-visit discount).
  unit_price_pence bigint not null,
  vat_rate numeric(5, 2) not null check (vat_rate between 0 and 100),
  line_total_pence bigint not null,
  -- 'design' lines were generated; 'custom' were added or edited by staff.
  origin text not null default 'design' check (origin in ('design', 'custom', 'discount')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  foreign key (company_id, proposal_id) references public.proposals (company_id, id) on delete cascade,
  foreign key (company_id, product_id) references public.products (company_id, id)
);

create index proposal_lines_idx on public.proposal_lines (company_id, proposal_id, section, position);

create trigger proposal_lines_updated_at before update on public.proposal_lines
  for each row execute function private.set_updated_at();

-- Lines of a sent proposal can't change (price edits are audited by versions).
create function private.guard_proposal_lines() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_status public.proposal_status;
begin
  select status into v_status from public.proposals
  where id = coalesce(new.proposal_id, old.proposal_id) and company_id = coalesce(new.company_id, old.company_id);
  if v_status is not null and v_status <> 'draft' then
    raise exception 'a sent proposal cannot be edited; create a new version' using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger proposal_lines_guard before insert or update or delete on public.proposal_lines
  for each row execute function private.guard_proposal_lines();

-- ---------------------------------------------------------------------------
-- proposal_views (each time the customer opens it)
-- ---------------------------------------------------------------------------

create table public.proposal_views (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  proposal_id uuid not null,
  viewed_at timestamptz not null default now(),
  user_agent text,
  foreign key (company_id, proposal_id) references public.proposals (company_id, id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- invoices and payments
-- ---------------------------------------------------------------------------

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  project_id uuid not null,
  proposal_id uuid,
  kind text not null check (kind in ('deposit', 'balance')),
  number text not null,
  amount_pence bigint not null check (amount_pence >= 0),
  vat_pence bigint not null default 0,
  status text not null default 'open' check (status in ('draft', 'open', 'paid', 'void')),
  due_date date,
  issued_at timestamptz not null default now(),
  paid_at timestamptz,
  xero_invoice_id text,
  xero_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  unique (company_id, id),
  unique (company_id, number),
  foreign key (company_id, project_id) references public.projects (company_id, id) on delete cascade,
  foreign key (company_id, proposal_id) references public.proposals (company_id, id)
);

create trigger invoices_updated_at before update on public.invoices
  for each row execute function private.set_updated_at();

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  invoice_id uuid not null,
  amount_pence bigint not null check (amount_pence > 0),
  method text not null check (method in ('card', 'bank_transfer', 'other')),
  provider text,
  -- Stripe Checkout session / payment intent id; unique so webhooks are idempotent.
  provider_ref text,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'refunded')),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  foreign key (company_id, invoice_id) references public.invoices (company_id, id) on delete cascade
);

create unique index payments_provider_ref_idx on public.payments (provider, provider_ref) where provider_ref is not null;

create trigger payments_updated_at before update on public.payments
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Company settings for proposals
-- ---------------------------------------------------------------------------

alter table public.companies
  -- VAT rate per product category and for labour, e.g. {"panel": 0, "ev_charger": 20, "labour": 0}.
  add column vat_rates jsonb not null default '{}'::jsonb check (jsonb_typeof(vat_rates) = 'object'),
  -- Shared-visit discount when solar and EV are installed together, pence (positive).
  add column shared_visit_discount_pence bigint check (shared_visit_discount_pence >= 0),
  add column proposal_valid_days integer check (proposal_valid_days between 1 and 365),
  -- Stripe Connect account for card payments (acct_...).
  add column stripe_account_id text,
  add column next_proposal_number integer not null default 1,
  add column next_invoice_number integer not null default 1;

-- Labour and extras on proposals come from catalogue items too (category labour).

-- Signatures drawn on the public proposal page are stored as files.
alter table public.files drop constraint files_source_check;
alter table public.files add constraint files_source_check check (source in ('online_survey', 'staff', 'installer_app', 'customer'));

-- Allocate the next proposal or invoice number for the caller's company.
create function public.next_document_number(p_kind text) returns integer
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
  else
    raise exception 'unknown document kind %', p_kind;
  end if;
  return v_n;
end;
$$;

revoke all on function public.next_document_number(text) from public;
grant execute on function public.next_document_number(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security. Prices: never visible to subcontractors; installers
-- don't see proposals either.
-- ---------------------------------------------------------------------------

alter table public.proposals enable row level security;
alter table public.proposal_lines enable row level security;
alter table public.proposal_views enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;

revoke all on public.proposals, public.proposal_lines, public.proposal_views, public.invoices, public.payments from anon;

create policy proposals_select on public.proposals for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));
create policy proposals_insert on public.proposals for insert to authenticated
  with check (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));
-- Staff send and supersede; acceptance and views are written server-side
-- from the public page after checking the token.
create policy proposals_update on public.proposals for update to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')))
  with check (company_id = (select private.current_company_id()));
create policy proposals_delete on public.proposals for delete to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')) and status = 'draft');

create policy proposal_lines_all on public.proposal_lines for all to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')))
  with check (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));

create policy proposal_views_select on public.proposal_views for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));

create policy invoices_select on public.invoices for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));
create policy invoices_write on public.invoices for all to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')))
  with check (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));

-- Payments are recorded by the Stripe webhook (service role) or by staff for bank transfers.
create policy payments_select on public.payments for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));
create policy payments_insert on public.payments for insert to authenticated
  with check (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')) and method <> 'card');
