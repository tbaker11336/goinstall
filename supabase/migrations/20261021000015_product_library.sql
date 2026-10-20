-- Shared product library: datasheet values from public lists (first: the
-- California Energy Commission PV module list, via NREL's SAM library) that
-- any company can copy into its own catalogue. Reference data, not tenant
-- data: no company_id; everyone signed in can read it, only the service role
-- (the loader) writes it.
create table public.product_library (
  id uuid primary key default gen_random_uuid(),
  category public.product_category not null check (category in ('panel', 'inverter', 'battery')),
  source text not null,
  source_version text,
  make text not null,
  model text not null,
  name text not null,
  specs jsonb not null default '{}'::jsonb check (jsonb_typeof(specs) = 'object'),
  -- For search: "jinko solar jkm445m-60hl4 445".
  search text generated always as (lower(make || ' ' || model || ' ' || coalesce(specs ->> 'watts_peak', ''))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, make, model)
);

create index product_library_category_idx on public.product_library (category, make);

create trigger set_updated_at before update on public.product_library
  for each row execute function private.set_updated_at();

alter table public.product_library enable row level security;
grant select on public.product_library to authenticated;
create policy product_library_read on public.product_library
  for select to authenticated using (true);

-- Where a catalogue product was copied from (kept if the library row goes).
alter table public.products
  add column library_id uuid references public.product_library (id) on delete set null;
