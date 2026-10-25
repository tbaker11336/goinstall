-- Notifications: in-app, email and SMS, to staff (internal) and customers
-- (external), with per-company channel choices and reminder timings (off
-- until a company sets them). SMS is a paid add-on: each company gets its
-- own UK number on a Twilio subaccount, billed monthly through Stripe.

alter type public.message_channel add value if not exists 'sms';

alter table public.companies
  add column notification_settings jsonb not null default '{}'::jsonb check (jsonb_typeof(notification_settings) = 'object');

-- Survey links are derived from this (HMAC with the link secret, like
-- proposals), so a reminder can resend the same link.
alter table public.surveys add column link_nonce text;

-- Customers who texted STOP: no more texts to them.
alter table public.contacts add column sms_opt_out_at timestamptz;

-- Billed message parts for each text, so usage counts what Twilio charges.
alter table public.messages add column sms_segments smallint check (sms_segments is null or sms_segments > 0);
-- Only texts carry sms_segments (the new enum value can't be used in this transaction).
create index messages_sms_usage_idx on public.messages (company_id, created_at) where sms_segments is not null;

-- ---------------------------------------------------------------------------
-- notifications: the in-app feed, one row per recipient
-- ---------------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  user_id uuid not null,
  event text not null check (event ~ '^[a-z][a-z_]{2,40}$'),
  title text not null,
  body text,
  link text check (link is null or link ~ '^/'),
  project_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  unique (company_id, id),
  foreign key (company_id, user_id) references public.users (company_id, id) on delete cascade,
  foreign key (company_id, project_id) references public.projects (company_id, id) on delete cascade
);

create index notifications_user_idx on public.notifications (company_id, user_id, created_at desc);
create index notifications_unread_idx on public.notifications (company_id, user_id) where read_at is null;

create trigger notifications_updated_at before update on public.notifications
  for each row execute function private.set_updated_at();

alter table public.notifications enable row level security;
-- Each person sees and marks read only their own; notifications are created server-side.
create policy notifications_own_select on public.notifications for select to authenticated
  using (company_id = (select private.current_company_id()) and user_id = (select auth.uid()));
create policy notifications_own_update on public.notifications for update to authenticated
  using (company_id = (select private.current_company_id()) and user_id = (select auth.uid()))
  with check (company_id = (select private.current_company_id()) and user_id = (select auth.uid()));
revoke insert, delete on public.notifications from authenticated;
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- ---------------------------------------------------------------------------
-- notification_log: what was sent for which record, so reminders go once
-- ---------------------------------------------------------------------------

create table public.notification_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  event text not null,
  -- The survey, proposal or booking the reminder is about.
  entity_id uuid not null,
  step smallint not null default 0,
  channels text[] not null default '{}',
  project_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  unique (company_id, event, entity_id, step),
  foreign key (company_id, project_id) references public.projects (company_id, id) on delete cascade
);

create trigger notification_log_updated_at before update on public.notification_log
  for each row execute function private.set_updated_at();

alter table public.notification_log enable row level security;
create policy notification_log_staff on public.notification_log for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));
revoke insert, update, delete on public.notification_log from authenticated;

-- ---------------------------------------------------------------------------
-- sms_accounts: the SMS add-on, one per company
-- ---------------------------------------------------------------------------

create table public.sms_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  -- checkout: paying; pending_number: paid, number being set up (UK
  -- regulatory check); active; past_due; cancelled.
  status text not null default 'checkout' check (status in ('checkout', 'pending_number', 'active', 'past_due', 'cancelled')),
  stripe_customer_id text,
  stripe_subscription_id text unique,
  current_period_start timestamptz,
  current_period_end timestamptz,
  -- Texts to staff (no customer thread), counted for the allowance; reset each period.
  staff_texts_this_period integer not null default 0 check (staff_texts_this_period >= 0),
  -- For the number's regulatory check: legal name, company number, address, contact.
  business_details jsonb not null default '{}'::jsonb check (jsonb_typeof(business_details) = 'object'),
  twilio_subaccount_sid text,
  phone_number text check (phone_number is null or phone_number ~ '^\+44\d{10}$'),
  phone_number_sid text,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  unique (company_id),
  unique (company_id, id)
);

create trigger sms_accounts_updated_at before update on public.sms_accounts
  for each row execute function private.set_updated_at();

alter table public.sms_accounts enable row level security;
-- Admins see their add-on; billing and number fields are written only by
-- GoInstall (webhooks, number setup). Admins may fill in business details.
create policy sms_accounts_admin_select on public.sms_accounts for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin')));
create policy sms_accounts_admin_update on public.sms_accounts for update to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin')))
  with check (company_id = (select private.current_company_id()));
revoke insert, update, delete on public.sms_accounts from authenticated;
grant update (business_details) on public.sms_accounts to authenticated;
