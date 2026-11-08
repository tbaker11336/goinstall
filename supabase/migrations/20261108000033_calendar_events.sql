-- Google Calendar: each person can connect their own calendar
-- (integrations row, provider 'google_calendar', user_id set; tokens in
-- private.integration_secrets). This remembers which event in whose
-- calendar is which booking, so moves update it and cancellations remove it.
create table public.booking_calendar_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  booking_id uuid not null,
  user_id uuid not null,
  provider text not null default 'google' check (provider in ('google')),
  event_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  unique (company_id, booking_id, user_id, provider),
  foreign key (company_id, booking_id) references public.bookings (company_id, id) on delete cascade,
  foreign key (company_id, user_id) references public.users (company_id, id) on delete cascade
);
create trigger booking_calendar_events_updated_at before update on public.booking_calendar_events
  for each row execute function private.set_updated_at();
alter table public.booking_calendar_events enable row level security;

-- Written by the server only; people can see their own, the office everyone's.
create policy booking_calendar_events_select on public.booking_calendar_events for select to authenticated
  using (company_id = (select private.current_company_id()) and (user_id = (select auth.uid()) or (select private.has_role('admin', 'office'))));
