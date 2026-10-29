-- Installers (and subcontractors) accept or decline the jobs they're booked
-- on, from the app. One answer per person per booking; it records the dates
-- it was for, so moving the booking asks them again.

create type public.booking_response as enum ('accepted', 'declined');

create table public.booking_responses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  booking_id uuid not null,
  user_id uuid not null,
  response public.booking_response not null,
  reason text check (reason is null or length(reason) <= 500),
  -- The booking's start when they answered.
  for_starts_at timestamptz not null,
  responded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  unique (company_id, id),
  unique (company_id, booking_id, user_id),
  -- A decline says why, so the office can rebook.
  check (response = 'accepted' or length(trim(coalesce(reason, ''))) > 0),
  foreign key (company_id, booking_id) references public.bookings (company_id, id) on delete cascade,
  foreign key (company_id, user_id) references public.users (company_id, id) on delete cascade
);

create trigger booking_responses_updated_at before update on public.booking_responses
  for each row execute function private.set_updated_at();

alter table public.booking_responses enable row level security;

create policy booking_responses_staff on public.booking_responses for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));
create policy booking_responses_own_select on public.booking_responses for select to authenticated
  using (company_id = (select private.current_company_id()) and user_id = (select auth.uid()));
-- Only the person themselves answers, and only for a booking they're on.
create policy booking_responses_own_insert on public.booking_responses for insert to authenticated
  with check (
    company_id = (select private.current_company_id())
    and (select private.has_role('installer', 'subcontractor'))
    and user_id = (select auth.uid())
    and private.is_assigned_to_booking(booking_id)
  );
create policy booking_responses_own_update on public.booking_responses for update to authenticated
  using (company_id = (select private.current_company_id()) and user_id = (select auth.uid()) and private.is_assigned_to_booking(booking_id))
  with check (company_id = (select private.current_company_id()) and user_id = (select auth.uid()));
