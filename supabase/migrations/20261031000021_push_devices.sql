-- Phones signed in to the installer app that can receive push notifications
-- (Expo push tokens). Each person registers their own devices; the server
-- sends through Expo and removes tokens Expo says are no longer valid.

create table public.push_devices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  user_id uuid not null,
  token text not null check (token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$'),
  platform text not null check (platform in ('ios', 'android')),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  unique (company_id, id),
  -- A phone belongs to whoever signed in on it last.
  unique (token),
  foreign key (company_id, user_id) references public.users (company_id, id) on delete cascade
);
create index push_devices_user_idx on public.push_devices (company_id, user_id);

create trigger push_devices_updated_at before update on public.push_devices
  for each row execute function private.set_updated_at();

alter table public.push_devices enable row level security;

create policy push_devices_own on public.push_devices for all to authenticated
  using (company_id = (select private.current_company_id()) and user_id = (select auth.uid()))
  with check (company_id = (select private.current_company_id()) and user_id = (select auth.uid()));
