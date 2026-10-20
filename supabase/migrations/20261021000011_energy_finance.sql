-- Customer energy use and tariff (per project), and each company's finance
-- assumptions, for bills, savings, payback and the 20-year cash flow on
-- proposals.

create table public.energy_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  project_id uuid not null,
  annual_kwh integer check (annual_kwh between 1 and 1000000),
  -- Twelve figures, January first, when the customer has monthly bills.
  monthly_kwh integer[] check (monthly_kwh is null or cardinality(monthly_kwh) = 12),
  unit_rate_pence numeric(7, 3) check (unit_rate_pence between 0 and 500),
  standing_charge_pence numeric(7, 3) check (standing_charge_pence between 0 and 1000),
  export_rate_pence numeric(7, 3) check (export_rate_pence between 0 and 500),
  tariff_name text,
  -- Where the figures came from: 'bills', 'survey' or 'estimate'.
  source text not null default 'bills' check (source in ('bills', 'survey', 'estimate')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  unique (company_id, id),
  unique (company_id, project_id),
  foreign key (company_id, project_id) references public.projects (company_id, id) on delete cascade
);

create trigger energy_profiles_updated_at before update on public.energy_profiles
  for each row execute function private.set_updated_at();

alter table public.energy_profiles enable row level security;
create policy energy_profiles_staff on public.energy_profiles for all to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')))
  with check (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));

-- Finance assumptions (see packages/core finance.ts). New companies start
-- with the business's own defaults; every value is editable in Settings.
alter table public.companies
  add column finance_settings jsonb not null default
    '{"electricityInflationPct": 5, "discountRatePct": 2.58, "lifetimeYears": 20, "degradationFirstYearPct": 2, "degradationAnnualPct": 0.55}'::jsonb
    check (jsonb_typeof(finance_settings) = 'object'),
  -- Default tariff for new projects, pence.
  add column default_unit_rate_pence numeric(7, 3),
  add column default_standing_charge_pence numeric(7, 3),
  add column default_export_rate_pence numeric(7, 3),
  -- kg CO2 per kWh, with where the figure comes from (no default: the company chooses its source).
  add column grid_emissions_kg_per_kwh numeric(6, 4) check (grid_emissions_kg_per_kwh between 0 and 2),
  add column grid_emissions_source text;

-- Google Solar API's own yearly estimate and imagery date, shown beside MCS as a cross-check.
alter table public.solar_designs add column google_yearly_kwh integer, add column imagery_date date;

-- MCS breakdown per roof (kWp, orientation, pitch, kWh/kWp, shade factor),
-- shown in the proposal's installation data table.
alter table public.solar_designs add column mcs_arrays jsonb, add column mcs_zone text;

-- The old electricity and export price design settings become the default tariff.
update public.companies set
  default_unit_rate_pence = nullif(design_settings ->> 'importPencePerKwh', '')::numeric,
  default_export_rate_pence = nullif(design_settings ->> 'exportPencePerKwh', '')::numeric,
  design_settings = design_settings - 'importPencePerKwh' - 'exportPencePerKwh';
