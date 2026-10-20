-- Phase 2: online and in-person surveys, stored files, message templates and
-- outbound email delivery status.
--
-- Survey answers are one row per field (survey_fields) so every value records
-- where it came from. Overwritten values are kept in survey_field_history
-- (offline sync later relies on this: last write wins, history kept).
--
-- Customers never log in: the public survey page checks a hashed, expiring
-- token server-side and then writes with the service role.

create type public.survey_question_type as enum ('text', 'long_text', 'number', 'select', 'yes_no');

create type public.field_source as enum ('online', 'in_person', 'photo', 'staff_edit');

create type public.online_survey_status as enum ('not_sent', 'sent', 'in_progress', 'completed');

create type public.site_visit_status as enum ('not_needed', 'recommended', 'booked', 'completed');

-- ---------------------------------------------------------------------------
-- survey_questions (Settings > Surveys & checklists)
-- ---------------------------------------------------------------------------

create table public.survey_questions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  -- Stable identifier used by survey_fields; never shown to customers.
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  label text not null check (length(trim(label)) > 0),
  help text,
  type public.survey_question_type not null default 'text',
  options text[] not null default '{}',
  -- Products the question applies to; empty means every project.
  products public.product_type[] not null default '{}',
  section text not null default 'Your home',
  position integer not null default 0,
  required boolean not null default false,
  -- Staff-only questions (e.g. earthing) are answered from photos or on site.
  ask_online boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  unique (company_id, id),
  unique (company_id, key),
  check (type <> 'select' or cardinality(options) > 0)
);

create trigger survey_questions_updated_at before update on public.survey_questions
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- photo_categories (required photos per product)
-- ---------------------------------------------------------------------------

create table public.photo_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  label text not null check (length(trim(label)) > 0),
  help text,
  products public.product_type[] not null default '{}',
  required boolean not null default true,
  position integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  unique (company_id, id),
  unique (company_id, key)
);

create trigger photo_categories_updated_at before update on public.photo_categories
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- message_templates
-- ---------------------------------------------------------------------------

create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  -- Set for templates the app sends itself (e.g. 'survey_link'); null for
  -- the team's own templates.
  key text check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  name text not null check (length(trim(name)) > 0),
  channel public.message_channel not null check (channel in ('email', 'whatsapp')),
  subject text,
  -- Placeholders: {{first_name}}, {{name}}, {{company_name}}, {{survey_link}},
  -- {{sender_name}}, {{site_address}}.
  body text not null,
  -- WhatsApp templates must be approved by Meta before use outside the
  -- 24-hour window (phase 2, WhatsApp).
  whatsapp_template_name text,
  whatsapp_status text check (whatsapp_status in ('draft', 'submitted', 'approved', 'rejected')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  unique (company_id, id),
  unique nulls distinct (company_id, key, channel),
  check (channel <> 'email' or nullif(trim(subject), '') is not null)
);

create trigger message_templates_updated_at before update on public.message_templates
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- surveys (one per project)
-- ---------------------------------------------------------------------------

create table public.surveys (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  project_id uuid not null,
  online_status public.online_survey_status not null default 'not_sent',
  -- sha256 of the link token; the token itself is only ever in the link.
  token_hash text unique,
  token_expires_at timestamptz,
  sent_at timestamptz,
  sent_count integer not null default 0,
  last_opened_at timestamptz,
  online_completed_at timestamptz,
  site_visit_status public.site_visit_status not null default 'not_needed',
  site_visit_at timestamptz,
  surveyor_id uuid,
  -- Staff marked the whole survey complete (moves the project to Design).
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  unique (company_id, id),
  unique (company_id, project_id),
  foreign key (company_id, project_id) references public.projects (company_id, id) on delete cascade,
  foreign key (company_id, surveyor_id) references public.users (company_id, id) on delete set null (surveyor_id),
  check ((token_hash is null) = (token_expires_at is null))
);

create trigger surveys_updated_at before update on public.surveys
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- survey_fields and history
-- ---------------------------------------------------------------------------

create table public.survey_fields (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  survey_id uuid not null,
  key text not null,
  value text,
  source public.field_source not null,
  -- Set when a staff member made the edit; null for customer answers.
  edited_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  unique (company_id, survey_id, key),
  foreign key (company_id, survey_id) references public.surveys (company_id, id) on delete cascade,
  foreign key (company_id, edited_by) references public.users (company_id, id) on delete set null (edited_by)
);

create trigger survey_fields_updated_at before update on public.survey_fields
  for each row execute function private.set_updated_at();

create table public.survey_field_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  survey_id uuid not null,
  key text not null,
  value text,
  source public.field_source not null,
  edited_by uuid,
  -- When the value was first set, and when it was overwritten.
  set_at timestamptz not null,
  replaced_at timestamptz not null default clock_timestamp(),
  foreign key (company_id, survey_id) references public.surveys (company_id, id) on delete cascade
);

create index survey_field_history_idx on public.survey_field_history (company_id, survey_id, key, replaced_at desc);

create function private.keep_survey_field_history() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.value is distinct from old.value or new.source is distinct from old.source then
    insert into public.survey_field_history (company_id, survey_id, key, value, source, edited_by, set_at)
    values (old.company_id, old.survey_id, old.key, old.value, old.source, old.edited_by, old.updated_at);
  end if;
  return null;
end;
$$;

create trigger survey_fields_history after update on public.survey_fields
  for each row execute function private.keep_survey_field_history();

-- ---------------------------------------------------------------------------
-- files (photos, signatures, PDFs, attachments in private storage)
-- ---------------------------------------------------------------------------

create table public.files (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  project_id uuid,
  kind text not null default 'photo' check (kind in ('photo', 'document', 'signature', 'attachment')),
  -- photo_categories.key for photos.
  category text,
  bucket text not null default 'project-files',
  -- <company_id>/<project_id>/<file id>.<ext>; unique per bucket.
  path text not null,
  content_type text not null,
  size_bytes integer not null check (size_bytes > 0),
  original_name text,
  source text not null check (source in ('online_survey', 'staff', 'installer_app')),
  uploaded_by uuid,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  unique (company_id, id),
  unique (bucket, path),
  foreign key (company_id, project_id) references public.projects (company_id, id) on delete cascade,
  foreign key (company_id, uploaded_by) references public.users (company_id, id) on delete set null (uploaded_by)
);

create index files_project_idx on public.files (company_id, project_id, kind) where deleted_at is null;

create trigger files_updated_at before update on public.files
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- messages: outbound delivery status
-- ---------------------------------------------------------------------------

alter table public.messages
  add column delivery_status text check (delivery_status in ('queued', 'sent', 'failed')),
  add column delivery_error text,
  add column to_address text;

-- ---------------------------------------------------------------------------
-- Defaults for every company: survey questions, photo categories and the
-- survey link template. Drafted from the spec; admins edit them in Settings.
-- ---------------------------------------------------------------------------

create function private.seed_company_defaults(p_company_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.survey_questions
    (company_id, key, label, help, type, options, products, section, position, required, ask_online)
  values
    (p_company_id, 'annual_usage_kwh', 'Annual electricity use (kWh)', 'On your electricity bill or app. Leave blank if you''re not sure.',
      'number', '{}', '{solar,battery}', 'Your energy use', 10, false, true),
    (p_company_id, 'occupancy', 'When is someone usually at home?', null,
      'select', '{"Most of the day","Mornings and evenings","Mostly evenings and weekends"}', '{solar,battery}', 'Your energy use', 20, true, true),
    (p_company_id, 'roof_type', 'Roof type', null,
      'select', '{"Pitched","Flat","Mixed","Not sure"}', '{solar}', 'Your roof', 30, true, true),
    (p_company_id, 'roof_material', 'Roof covering', null,
      'select', '{"Concrete tile","Clay tile","Slate","Metal","Other","Not sure"}', '{solar}', 'Your roof', 40, true, true),
    (p_company_id, 'roof_notes', 'Anything we should know about the roof?', 'For example shading from trees, a chimney or roof windows.',
      'long_text', '{}', '{solar}', 'Your roof', 50, false, true),
    (p_company_id, 'scaffold_access', 'Access for scaffolding', 'Is there room around the house for scaffolding, and anything in the way (conservatory, garden, neighbours)?',
      'long_text', '{}', '{solar}', 'Your roof', 60, false, true),
    (p_company_id, 'inverter_battery_location', 'Where could the inverter and battery go?', 'For example garage, utility room or loft.',
      'text', '{}', '{solar,battery}', 'Equipment', 70, true, true),
    (p_company_id, 'supply_phase', 'Electricity supply', 'Most homes are single phase.',
      'select', '{"Single phase","Three phase","Not sure"}', '{}', 'Your electrics', 80, true, true),
    (p_company_id, 'main_fuse', 'Main fuse rating', 'Printed on the main fuse next to your meter. A photo is fine.',
      'select', '{"60 A","80 A","100 A","Not sure"}', '{}', 'Your electrics', 90, false, true),
    (p_company_id, 'consumer_unit', 'Consumer unit (fuse box)', 'Roughly how many switches, and are any spare? A photo is fine.',
      'text', '{}', '{}', 'Your electrics', 100, false, true),
    (p_company_id, 'earthing', 'Earthing arrangement', 'Filled in by the team from photos or the site visit.',
      'select', '{"TN-C-S (PME)","TN-S","TT","Not sure"}', '{}', 'Your electrics', 110, false, false),
    (p_company_id, 'charger_location', 'Where would you like the charger?', 'For example on the front wall by the driveway.',
      'text', '{}', '{ev}', 'Car charger', 120, true, true),
    (p_company_id, 'cable_run_m', 'Roughly how far is that from your fuse box (metres)?', 'A best guess is fine; we measure on site.',
      'number', '{}', '{ev}', 'Car charger', 130, false, true),
    (p_company_id, 'off_street_parking', 'Do you have off-street parking?', null,
      'yes_no', '{}', '{ev}', 'Car charger', 140, true, true),
    (p_company_id, 'tethered', 'Charger cable', null,
      'select', '{"Tethered (cable attached)","Socket (use your own cable)","Not sure"}', '{ev}', 'Car charger', 150, false, true),
    (p_company_id, 'vehicle', 'Which car do you drive, or plan to?', null,
      'text', '{}', '{ev}', 'Car charger', 160, false, true)
  on conflict (company_id, key) do nothing;

  insert into public.photo_categories (company_id, key, label, help, products, required, position)
  values
    (p_company_id, 'front_of_house', 'Front of house', 'The whole front of the house from the street.', '{}', true, 10),
    (p_company_id, 'roof', 'Roof', 'The side of the roof where you would like panels.', '{solar}', true, 20),
    (p_company_id, 'consumer_unit', 'Consumer unit', 'Your fuse box with the cover closed, so the labels can be read.', '{}', true, 30),
    (p_company_id, 'meter', 'Meter and main fuse', 'Your electricity meter and the main fuse next to it.', '{}', true, 40),
    (p_company_id, 'loft', 'Loft and rafters', 'Inside the loft, showing the rafters, if you can get up there safely.', '{solar}', false, 50),
    (p_company_id, 'equipment_location', 'Inverter and battery location', 'Where the inverter and battery could go.', '{solar,battery}', true, 60),
    (p_company_id, 'charger_spot', 'Charger location', 'Where you would like the charger, with the parking space in view.', '{ev}', true, 70),
    (p_company_id, 'scaffold_access', 'Scaffold access', 'The sides of the house where scaffolding would go.', '{solar}', false, 80)
  on conflict (company_id, key) do nothing;

  insert into public.message_templates (company_id, key, name, channel, subject, body)
  values
    (p_company_id, 'survey_link', 'Online survey link', 'email',
      'Your online survey from {{company_name}}',
      E'Hi {{first_name}},\n\nThanks for your enquiry. To get your quote started, please fill in our short online survey. It takes about 10 minutes, saves as you go, and you can add photos from your phone:\n\n{{survey_link}}\n\nAny questions, just reply to this email.\n\n{{sender_name}}\n{{company_name}}')
  on conflict do nothing;
end;
$$;

create function private.on_company_created() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.seed_company_defaults(new.id);
  return null;
end;
$$;

create trigger companies_seed_defaults after insert on public.companies
  for each row execute function private.on_company_created();

select private.seed_company_defaults(id) from public.companies;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.survey_questions enable row level security;
alter table public.photo_categories enable row level security;
alter table public.message_templates enable row level security;
alter table public.surveys enable row level security;
alter table public.survey_fields enable row level security;
alter table public.survey_field_history enable row level security;
alter table public.files enable row level security;

revoke all on public.survey_questions, public.photo_categories, public.message_templates, public.surveys,
  public.survey_fields, public.survey_field_history, public.files from anon;
revoke execute on function private.seed_company_defaults(uuid) from public;

-- Configuration: readable by office staff, managed by admins.
create policy survey_questions_select on public.survey_questions for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));
create policy survey_questions_write on public.survey_questions for all to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin')))
  with check (company_id = (select private.current_company_id()) and (select private.has_role('admin')));

create policy photo_categories_select on public.photo_categories for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));
create policy photo_categories_write on public.photo_categories for all to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin')))
  with check (company_id = (select private.current_company_id()) and (select private.has_role('admin')));

create policy message_templates_select on public.message_templates for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));
create policy message_templates_write on public.message_templates for all to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin')))
  with check (company_id = (select private.current_company_id()) and (select private.has_role('admin')));

-- Survey data: office staff and admins. Installer access to assigned jobs
-- arrives with bookings in phase 5.
create policy surveys_select on public.surveys for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));
create policy surveys_insert on public.surveys for insert to authenticated
  with check (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));
create policy surveys_update on public.surveys for update to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')))
  with check (company_id = (select private.current_company_id()));

create policy survey_fields_select on public.survey_fields for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));
-- Staff edits must be attributed to the editor.
create policy survey_fields_insert on public.survey_fields for insert to authenticated
  with check (
    company_id = (select private.current_company_id())
    and (select private.has_role('admin', 'office'))
    and source = 'staff_edit' and edited_by = (select auth.uid())
  );
create policy survey_fields_update on public.survey_fields for update to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')))
  with check (
    company_id = (select private.current_company_id())
    and source = 'staff_edit' and edited_by = (select auth.uid())
  );

-- History is written by trigger only.
create policy survey_field_history_select on public.survey_field_history for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));

create policy files_select on public.files for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));
create policy files_insert on public.files for insert to authenticated
  with check (
    company_id = (select private.current_company_id())
    and (select private.has_role('admin', 'office'))
    and source = 'staff' and uploaded_by = (select auth.uid())
  );
-- Soft delete only (deleted_at); rows are removed with their project.
create policy files_update on public.files for update to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')))
  with check (company_id = (select private.current_company_id()));

-- ---------------------------------------------------------------------------
-- Storage: one private bucket, served only by short-lived signed URLs made
-- server-side. No storage policies for API roles, so the browser can never
-- read or write it directly. Skipped where Supabase Storage isn't installed
-- (plain Postgres in CI).
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('project-files', 'project-files', false, 15728640,
            array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
    on conflict (id) do nothing;
  end if;
end;
$$;
