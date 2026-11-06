-- How long a job is expected to take (from a couple of hours to weeks), and
-- any number of engineers on a booking.

alter table public.projects
  add column estimated_length numeric(6, 2) check (estimated_length is null or estimated_length > 0),
  add column estimated_length_unit text check (estimated_length_unit in ('hours', 'days', 'weeks')),
  add constraint projects_estimated_length_pair check ((estimated_length is null) = (estimated_length_unit is null));

-- Engineers: as many people as the job needs, alongside the team, electrician,
-- scaffolder and surveyor roles (still one each).
alter table public.booking_assignments drop constraint booking_assignments_role_check;
alter table public.booking_assignments add constraint booking_assignments_role_check
  check (role in ('team', 'electrician', 'scaffolder', 'surveyor', 'engineer'));
alter table public.booking_assignments drop constraint booking_assignments_company_id_booking_id_role_key;
create unique index booking_assignments_single_role_idx on public.booking_assignments (company_id, booking_id, role) where role <> 'engineer';
create unique index booking_assignments_engineer_idx on public.booking_assignments (company_id, booking_id, user_id) where role = 'engineer';
alter table public.booking_assignments add constraint booking_assignments_engineer_is_person check (role <> 'engineer' or user_id is not null);
