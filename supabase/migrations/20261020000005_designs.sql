-- Phase 3: design rules, roof data cache, solar and EV designs.
--
-- Rule values (MCS kWh/kWp tables, postcode zones, self-consumption bands,
-- cable tables) are uploaded by the business as versioned calc_tables; the
-- app never ships its own. Company design settings (minimum design
-- temperature, volt drop limit and so on) live on companies.design_settings.
--
-- Designs are append-only: every save inserts a new version and marks it
-- active; earlier versions stay viewable.

-- ---------------------------------------------------------------------------
-- calc_tables
-- ---------------------------------------------------------------------------

create table public.calc_tables (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  kind text not null check (kind in ('mcs_yield', 'mcs_zones', 'self_consumption', 'ev_cables')),
  version integer not null check (version > 0),
  rows jsonb not null check (jsonb_typeof(rows) = 'array' and jsonb_array_length(rows) > 0),
  -- Where the values came from, e.g. "MCS MIS 3002 v4.0 Annex B".
  source_note text not null check (length(trim(source_note)) > 0),
  file_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  unique (company_id, kind, version)
);

create unique index calc_tables_active_idx on public.calc_tables (company_id, kind) where is_active;

alter table public.companies
  add column design_settings jsonb not null default '{}'::jsonb check (jsonb_typeof(design_settings) = 'object');

-- ---------------------------------------------------------------------------
-- roof_data_cache (Google Solar API responses are billed: fetch once)
-- ---------------------------------------------------------------------------

create table public.roof_data_cache (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  project_id uuid not null,
  provider text not null default 'google_solar',
  lat double precision not null,
  lng double precision not null,
  -- 'ok', 'no_coverage' or 'error'; no_coverage falls back to drawing.
  status text not null check (status in ('ok', 'no_coverage', 'error')),
  imagery_quality text,
  response jsonb,
  fetched_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  unique (company_id, project_id, provider),
  foreign key (company_id, project_id) references public.projects (company_id, id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- solar_designs
-- ---------------------------------------------------------------------------

create table public.solar_designs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  project_id uuid not null,
  version integer not null check (version > 0),
  is_active boolean not null default true,
  roof_source text not null default 'drawn' check (roof_source in ('google_solar', 'drawn')),
  -- [{id, label, pitch, azimuth, origin:{x,y}, polygon:[{x,y}], panels:[{x,y,w,h}],
  --   obstructions:[{x,y,w,h,label}], landscape, shadeFactor, used}]
  segments jsonb not null default '[]'::jsonb check (jsonb_typeof(segments) = 'array'),
  panel_product_id uuid,
  inverter_product_id uuid,
  battery_product_id uuid,
  battery_count integer not null default 0 check (battery_count >= 0),
  panel_count integer not null default 0 check (panel_count >= 0),
  kwp numeric(8, 3) not null default 0,
  annual_kwh_mcs integer,
  pvgis_kwh integer,
  pvgis_monthly integer[],
  self_consumption numeric(5, 4),
  self_consumption_with_battery numeric(5, 4),
  strings jsonb,
  dc_ac_ratio numeric(5, 2),
  export_kw numeric(8, 3),
  connection_form text check (connection_form in ('G98', 'G99')),
  -- Reasons a figure couldn't be calculated (missing tables or values).
  calc_notes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  unique (company_id, id),
  unique (company_id, project_id, version),
  foreign key (company_id, project_id) references public.projects (company_id, id) on delete cascade,
  foreign key (company_id, panel_product_id) references public.products (company_id, id),
  foreign key (company_id, inverter_product_id) references public.products (company_id, id),
  foreign key (company_id, battery_product_id) references public.products (company_id, id)
);

create unique index solar_designs_active_idx on public.solar_designs (company_id, project_id) where is_active;

-- ---------------------------------------------------------------------------
-- ev_designs
-- ---------------------------------------------------------------------------

create table public.ev_designs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  project_id uuid not null,
  version integer not null check (version > 0),
  is_active boolean not null default true,
  charger_product_id uuid,
  mounting text not null default 'wall' check (mounting in ('wall', 'post')),
  tethered boolean,
  background text not null default 'aerial' check (background in ('aerial', 'photo', 'plain')),
  background_file_id uuid,
  -- Plan positions in metres from the site centre (aerial) or photo units.
  supply_point jsonb,
  charger_point jsonb,
  supply_label text,
  charger_label text,
  -- [{x,y}] from supply to charger, and per-segment install methods.
  route jsonb not null default '[]'::jsonb check (jsonb_typeof(route) = 'array'),
  route_methods jsonb not null default '[]'::jsonb check (jsonb_typeof(route_methods) = 'array'),
  route_length_m numeric(7, 1),
  route_length_measured boolean not null default true,
  cable_size_mm2 numeric(6, 2),
  volt_drop_pct numeric(5, 2),
  main_fuse_a integer,
  phases smallint check (phases in (1, 3)),
  existing_demand_a numeric(6, 1),
  max_demand_a numeric(6, 1),
  load_management boolean,
  earthing text,
  protection text,
  solar_divert boolean not null default false,
  dno_notification boolean not null default true,
  calc_notes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  unique (company_id, id),
  unique (company_id, project_id, version),
  foreign key (company_id, project_id) references public.projects (company_id, id) on delete cascade,
  foreign key (company_id, charger_product_id) references public.products (company_id, id),
  foreign key (company_id, background_file_id) references public.files (company_id, id) on delete set null (background_file_id)
);

create unique index ev_designs_active_idx on public.ev_designs (company_id, project_id) where is_active;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.calc_tables enable row level security;
alter table public.roof_data_cache enable row level security;
alter table public.solar_designs enable row level security;
alter table public.ev_designs enable row level security;

revoke all on public.calc_tables, public.roof_data_cache, public.solar_designs, public.ev_designs from anon;

create policy calc_tables_select on public.calc_tables for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));
create policy calc_tables_write on public.calc_tables for all to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin')))
  with check (company_id = (select private.current_company_id()) and (select private.has_role('admin')));

create policy roof_data_cache_select on public.roof_data_cache for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));
create policy roof_data_cache_write on public.roof_data_cache for all to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')))
  with check (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));

-- Designs: office staff design; versions are never edited or deleted, only
-- deactivated when a newer one is saved.
create policy solar_designs_select on public.solar_designs for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));
create policy solar_designs_insert on public.solar_designs for insert to authenticated
  with check (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));
create policy solar_designs_deactivate on public.solar_designs for update to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')))
  with check (company_id = (select private.current_company_id()));

create policy ev_designs_select on public.ev_designs for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));
create policy ev_designs_insert on public.ev_designs for insert to authenticated
  with check (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));
create policy ev_designs_deactivate on public.ev_designs for update to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')))
  with check (company_id = (select private.current_company_id()));

-- Only is_active may change on a saved version.
create function private.guard_design_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - 'is_active') is distinct from (to_jsonb(old) - 'is_active') then
    raise exception 'saved design versions cannot be changed; save a new version' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger solar_designs_guard before update on public.solar_designs
  for each row execute function private.guard_design_update();
create trigger ev_designs_guard before update on public.ev_designs
  for each row execute function private.guard_design_update();
