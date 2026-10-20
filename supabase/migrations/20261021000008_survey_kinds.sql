-- Separate surveys for EV chargers and for solar & battery (business
-- decision, October 2026): each has its own questions, photo list, link and
-- status. A project with both products gets two surveys.

create type public.survey_kind as enum ('solar_battery', 'ev');

-- Questions and photo categories belong to one survey. Questions that applied
-- to every project (e.g. the electrics) are copied into both.
alter table public.survey_questions add column survey_kind public.survey_kind;
update public.survey_questions set survey_kind = case when products = '{ev}' then 'ev'::public.survey_kind else 'solar_battery'::public.survey_kind end;
insert into public.survey_questions (company_id, survey_kind, key, label, help, type, options, products, section, position, required, ask_online, archived_at, created_by)
  select company_id, 'ev', key, label, help, type, options, products, section, position, required, ask_online, archived_at, created_by
  from public.survey_questions where products = '{}' and survey_kind = 'solar_battery';
alter table public.survey_questions alter column survey_kind set not null;
alter table public.survey_questions drop constraint survey_questions_company_id_key_key;
alter table public.survey_questions add constraint survey_questions_kind_key unique (company_id, survey_kind, key);

alter table public.photo_categories add column survey_kind public.survey_kind;
update public.photo_categories set survey_kind = case when products = '{ev}' then 'ev'::public.survey_kind else 'solar_battery'::public.survey_kind end;
insert into public.photo_categories (company_id, survey_kind, key, label, help, products, required, position, archived_at, created_by)
  select company_id, 'ev', key, label, help, products, required, position, archived_at, created_by
  from public.photo_categories where products = '{}' and survey_kind = 'solar_battery';
alter table public.photo_categories alter column survey_kind set not null;
alter table public.photo_categories drop constraint photo_categories_company_id_key_key;
alter table public.photo_categories add constraint photo_categories_kind_key unique (company_id, survey_kind, key);

-- Photos say which survey they were taken for (null: staff uploads and app photos).
alter table public.files add column survey_kind public.survey_kind;

-- One survey per kind per project.
alter table public.surveys add column kind public.survey_kind not null default 'solar_battery';
update public.surveys s set kind = 'ev'
  from public.projects p
  where p.id = s.project_id and p.company_id = s.company_id
    and 'ev' = any (p.products) and not ('solar' = any (p.products) or 'battery' = any (p.products));
alter table public.surveys drop constraint surveys_company_id_project_id_key;
alter table public.surveys add constraint surveys_project_kind_key unique (company_id, project_id, kind);

-- Projects with both products: split the existing survey. EV answers move to
-- a new EV survey (with their history); shared answers (electrics) are copied.
do $$
declare
  r record;
  v_ev uuid;
begin
  for r in
    select s.* from public.surveys s join public.projects p on p.id = s.project_id and p.company_id = s.company_id
    where s.kind = 'solar_battery' and 'ev' = any (p.products) and ('solar' = any (p.products) or 'battery' = any (p.products))
  loop
    insert into public.surveys (company_id, project_id, kind, online_status, sent_at, sent_count, last_opened_at, online_completed_at, site_visit_status, site_visit_at, surveyor_id, completed_at, created_by)
    values (r.company_id, r.project_id, 'ev', r.online_status, r.sent_at, r.sent_count, r.last_opened_at, r.online_completed_at, r.site_visit_status, r.site_visit_at, r.surveyor_id, r.completed_at, r.created_by)
    returning id into v_ev;
    update public.survey_fields f set survey_id = v_ev
      where f.survey_id = r.id and f.company_id = r.company_id
        and f.key in (select key from public.survey_questions q where q.company_id = r.company_id and q.survey_kind = 'ev' and q.products = '{ev}');
    update public.survey_field_history h set survey_id = v_ev
      where h.survey_id = r.id and h.company_id = r.company_id
        and h.key in (select key from public.survey_questions q where q.company_id = r.company_id and q.survey_kind = 'ev' and q.products = '{ev}');
    insert into public.survey_fields (company_id, survey_id, key, value, source, edited_by, created_by)
      select f.company_id, v_ev, f.key, f.value, f.source, f.edited_by, f.created_by
      from public.survey_fields f
      where f.survey_id = r.id and f.company_id = r.company_id
        and f.key in (select key from public.survey_questions q where q.company_id = r.company_id and q.survey_kind = 'ev' and q.products = '{}');
  end loop;
end;
$$;

-- New companies get both surveys' starter questions.
create or replace function private.seed_company_defaults(p_company_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.survey_questions
    (company_id, survey_kind, key, label, help, type, options, products, section, position, required, ask_online)
  values
    (p_company_id, 'solar_battery', 'annual_usage_kwh', 'Annual electricity use (kWh)', 'On your electricity bill or app. Leave blank if you''re not sure.',
      'number', '{}', '{solar,battery}', 'Your energy use', 10, false, true),
    (p_company_id, 'solar_battery', 'occupancy', 'When is someone usually at home?', null,
      'select', '{"Most of the day","Mornings and evenings","Mostly evenings and weekends"}', '{solar,battery}', 'Your energy use', 20, true, true),
    (p_company_id, 'solar_battery', 'roof_type', 'Roof type', null,
      'select', '{"Pitched","Flat","Mixed","Not sure"}', '{solar}', 'Your roof', 30, true, true),
    (p_company_id, 'solar_battery', 'roof_material', 'Roof covering', null,
      'select', '{"Concrete tile","Clay tile","Slate","Metal","Other","Not sure"}', '{solar}', 'Your roof', 40, true, true),
    (p_company_id, 'solar_battery', 'roof_notes', 'Anything we should know about the roof?', 'For example shading from trees, a chimney or roof windows.',
      'long_text', '{}', '{solar}', 'Your roof', 50, false, true),
    (p_company_id, 'solar_battery', 'scaffold_access', 'Access for scaffolding', 'Is there room around the house for scaffolding, and anything in the way (conservatory, garden, neighbours)?',
      'long_text', '{}', '{solar}', 'Your roof', 60, false, true),
    (p_company_id, 'solar_battery', 'inverter_battery_location', 'Where could the inverter and battery go?', 'For example garage, utility room or loft.',
      'text', '{}', '{solar,battery}', 'Equipment', 70, true, true),
    (p_company_id, 'solar_battery', 'supply_phase', 'Electricity supply', 'Most homes are single phase.',
      'select', '{"Single phase","Three phase","Not sure"}', '{}', 'Your electrics', 80, true, true),
    (p_company_id, 'ev', 'supply_phase', 'Electricity supply', 'Most homes are single phase.',
      'select', '{"Single phase","Three phase","Not sure"}', '{}', 'Your electrics', 80, true, true),
    (p_company_id, 'solar_battery', 'main_fuse', 'Main fuse rating', 'Printed on the main fuse next to your meter. A photo is fine.',
      'select', '{"60 A","80 A","100 A","Not sure"}', '{}', 'Your electrics', 90, false, true),
    (p_company_id, 'ev', 'main_fuse', 'Main fuse rating', 'Printed on the main fuse next to your meter. A photo is fine.',
      'select', '{"60 A","80 A","100 A","Not sure"}', '{}', 'Your electrics', 90, false, true),
    (p_company_id, 'solar_battery', 'consumer_unit', 'Consumer unit (fuse box)', 'Roughly how many switches, and are any spare? A photo is fine.',
      'text', '{}', '{}', 'Your electrics', 100, false, true),
    (p_company_id, 'ev', 'consumer_unit', 'Consumer unit (fuse box)', 'Roughly how many switches, and are any spare? A photo is fine.',
      'text', '{}', '{}', 'Your electrics', 100, false, true),
    (p_company_id, 'solar_battery', 'earthing', 'Earthing arrangement', 'Filled in by the team from photos or the site visit.',
      'select', '{"TN-C-S (PME)","TN-S","TT","Not sure"}', '{}', 'Your electrics', 110, false, false),
    (p_company_id, 'ev', 'earthing', 'Earthing arrangement', 'Filled in by the team from photos or the site visit.',
      'select', '{"TN-C-S (PME)","TN-S","TT","Not sure"}', '{}', 'Your electrics', 110, false, false),
    (p_company_id, 'ev', 'charger_location', 'Where would you like the charger?', 'For example on the front wall by the driveway.',
      'text', '{}', '{ev}', 'Car charger', 120, true, true),
    (p_company_id, 'ev', 'cable_run_m', 'Roughly how far is that from your fuse box (metres)?', 'A best guess is fine; we measure on site.',
      'number', '{}', '{ev}', 'Car charger', 130, false, true),
    (p_company_id, 'ev', 'off_street_parking', 'Do you have off-street parking?', null,
      'yes_no', '{}', '{ev}', 'Car charger', 140, true, true),
    (p_company_id, 'ev', 'tethered', 'Charger cable', null,
      'select', '{"Tethered (cable attached)","Socket (use your own cable)","Not sure"}', '{ev}', 'Car charger', 150, false, true),
    (p_company_id, 'ev', 'vehicle', 'Which car do you drive, or plan to?', null,
      'text', '{}', '{ev}', 'Car charger', 160, false, true)
  on conflict (company_id, survey_kind, key) do nothing;

  insert into public.photo_categories (company_id, survey_kind, key, label, help, products, required, position)
  values
    (p_company_id, 'solar_battery', 'front_of_house', 'Front of house', 'The whole front of the house from the street.', '{}', true, 10),
    (p_company_id, 'ev', 'front_of_house', 'Front of house', 'The whole front of the house from the street.', '{}', true, 10),
    (p_company_id, 'solar_battery', 'roof', 'Roof', 'The side of the roof where you would like panels.', '{solar}', true, 20),
    (p_company_id, 'solar_battery', 'consumer_unit', 'Consumer unit', 'Your fuse box with the cover closed, so the labels can be read.', '{}', true, 30),
    (p_company_id, 'ev', 'consumer_unit', 'Consumer unit', 'Your fuse box with the cover closed, so the labels can be read.', '{}', true, 30),
    (p_company_id, 'solar_battery', 'meter', 'Meter and main fuse', 'Your electricity meter and the main fuse next to it.', '{}', true, 40),
    (p_company_id, 'ev', 'meter', 'Meter and main fuse', 'Your electricity meter and the main fuse next to it.', '{}', true, 40),
    (p_company_id, 'solar_battery', 'loft', 'Loft and rafters', 'Inside the loft, showing the rafters, if you can get up there safely.', '{solar}', false, 50),
    (p_company_id, 'solar_battery', 'equipment_location', 'Inverter and battery location', 'Where the inverter and battery could go.', '{solar,battery}', true, 60),
    (p_company_id, 'ev', 'charger_spot', 'Charger location', 'Where you would like the charger, with the parking space in view.', '{ev}', true, 70),
    (p_company_id, 'solar_battery', 'scaffold_access', 'Scaffold access', 'The sides of the house where scaffolding would go.', '{solar}', false, 80)
  on conflict (company_id, survey_kind, key) do nothing;

  insert into public.message_templates (company_id, key, name, channel, subject, body)
  values
    (p_company_id, 'survey_link', 'Online survey link', 'email',
      'Your online survey from {{company_name}}',
      E'Hi {{first_name}},\n\nThanks for your enquiry. To get your quote started, please fill in our short online survey. It takes about 10 minutes, saves as you go, and you can add photos from your phone:\n\n{{survey_link}}\n\nAny questions, just reply to this email.\n\n{{sender_name}}\n{{company_name}}')
  on conflict do nothing;
end;
$$;

