-- Electrical test results: one row per distribution board, with the board's
-- details and its schedule of circuits and test results (as on the EIC
-- continuation sheet). Filled in by the installer in the app, or by the
-- office from the paper sheet. Values are text as written on the sheet.
create table public.electrical_test_boards (
  -- Made on the device, so offline captures sync idempotently.
  id uuid primary key,
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  project_id uuid not null,
  -- The job it was captured on (null when the office typed it in).
  booking_id uuid,
  position integer not null default 0,
  board jsonb not null default '{}'::jsonb check (jsonb_typeof(board) = 'object'),
  circuits jsonb not null default '[]'::jsonb check (jsonb_typeof(circuits) = 'array' and jsonb_array_length(circuits) <= 100),
  recorded_by uuid,
  -- Device time of the capture; last write wins on sync.
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  unique (company_id, id),
  foreign key (company_id, project_id) references public.projects (company_id, id) on delete cascade,
  foreign key (company_id, booking_id) references public.bookings (company_id, id) on delete set null (booking_id),
  foreign key (company_id, recorded_by) references public.users (company_id, id) on delete set null (recorded_by)
);
create index electrical_test_boards_project on public.electrical_test_boards (company_id, project_id, position);

create trigger electrical_test_boards_updated_at before update on public.electrical_test_boards
  for each row execute function private.set_updated_at();

alter table public.electrical_test_boards enable row level security;

create policy electrical_test_boards_staff on public.electrical_test_boards for all to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')))
  with check (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));

-- Installers (not subcontractors): results on the jobs they're booked on.
create policy electrical_test_boards_installer on public.electrical_test_boards for all to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('installer')) and booking_id is not null and private.is_assigned_to_booking(booking_id))
  with check (company_id = (select private.current_company_id()) and (select private.has_role('installer')) and booking_id is not null and private.is_assigned_to_booking(booking_id));
