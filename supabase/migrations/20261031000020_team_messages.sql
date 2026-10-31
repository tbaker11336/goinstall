-- Chat about a job between the office and the people booked on it (the
-- installer app's Messages tab and the project's Install tab). Customer
-- messages stay in `messages`; these never reach the customer.

create table public.team_messages (
  -- Made on the device, so a message sent offline syncs exactly once.
  id uuid primary key,
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  project_id uuid not null,
  author_id uuid not null,
  body text not null check (length(trim(body)) between 1 and 2000),
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  unique (company_id, id),
  foreign key (company_id, project_id) references public.projects (company_id, id) on delete cascade,
  foreign key (company_id, author_id) references public.users (company_id, id) on delete cascade
);
create index team_messages_project_idx on public.team_messages (company_id, project_id, sent_at);

create trigger team_messages_updated_at before update on public.team_messages
  for each row execute function private.set_updated_at();

-- Where each person has read up to in each job's chat.
create table public.team_message_reads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  project_id uuid not null,
  user_id uuid not null,
  read_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  unique (company_id, id),
  unique (company_id, project_id, user_id),
  foreign key (company_id, project_id) references public.projects (company_id, id) on delete cascade,
  foreign key (company_id, user_id) references public.users (company_id, id) on delete cascade
);

create trigger team_message_reads_updated_at before update on public.team_message_reads
  for each row execute function private.set_updated_at();

alter table public.team_messages enable row level security;
alter table public.team_message_reads enable row level security;

-- Office staff: every job's chat. Installers and subcontractors: jobs they're booked on.
create policy team_messages_staff_select on public.team_messages for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));
create policy team_messages_assigned_select on public.team_messages for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('installer', 'subcontractor')) and private.is_assigned_to_project(project_id));
-- Everyone writes as themselves only; messages aren't edited or deleted.
create policy team_messages_insert on public.team_messages for insert to authenticated
  with check (
    company_id = (select private.current_company_id())
    and author_id = (select auth.uid())
    and ((select private.has_role('admin', 'office')) or ((select private.has_role('installer', 'subcontractor')) and private.is_assigned_to_project(project_id)))
  );

create policy team_message_reads_own on public.team_message_reads for all to authenticated
  using (company_id = (select private.current_company_id()) and user_id = (select auth.uid()))
  with check (company_id = (select private.current_company_id()) and user_id = (select auth.uid()));
