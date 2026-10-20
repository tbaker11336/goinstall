-- Phase 3: product catalogue and suppliers.
--
-- Every product used in designs, proposals and kit orders comes from the
-- company catalogue. A product can be bought from several suppliers, each
-- with its own cost, stock and lead time (supplier_products), so the Kit tab
-- can compare them. Money is integer pence.
--
-- Prices are admin-managed (spec: only admins change pricing). Subcontractors
-- never see these tables.

create type public.product_category as enum (
  'panel', 'inverter', 'battery', 'ev_charger', 'mounting', 'cable', 'electrical', 'labour', 'other'
);

create type public.supplier_connection as enum ('api', 'price_file', 'email');

-- ---------------------------------------------------------------------------
-- suppliers
-- ---------------------------------------------------------------------------

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  connection public.supplier_connection not null default 'price_file',
  -- Where purchase orders are emailed (price_file and email suppliers).
  order_email text,
  account_number text,
  -- Supabase Vault reference for API credentials; never the secret itself.
  credentials_ref text,
  last_sync_at timestamptz,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  unique (company_id, id),
  unique (company_id, name)
);

create trigger suppliers_updated_at before update on public.suppliers
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------

create table public.products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  category public.product_category not null,
  make text,
  model text not null check (length(trim(model)) > 0),
  -- What proposals and kit lists call it, e.g. "445 W all-black panel".
  name text not null check (length(trim(name)) > 0),
  -- The company's own code; supplier codes live on supplier_products.
  sku text,
  unit text not null default 'each' check (unit in ('each', 'kit', 'metre', 'hour', 'day')),
  -- Category-specific specs used by the calculations, e.g. panel watts and
  -- dimensions, inverter AC rating and MPPT ranges, battery kWh, charger kW.
  specs jsonb not null default '{}'::jsonb check (jsonb_typeof(specs) = 'object'),
  sell_price_pence bigint check (sell_price_pence >= 0),
  datasheet_file_id uuid,
  archived_at timestamptz,
  legacy_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  unique (company_id, id),
  unique (company_id, sku),
  foreign key (company_id, datasheet_file_id) references public.files (company_id, id) on delete set null (datasheet_file_id)
);

create index products_company_category_idx on public.products (company_id, category) where archived_at is null;
create unique index products_make_model_idx on public.products (company_id, lower(coalesce(make, '')), lower(model)) where archived_at is null;

create trigger products_updated_at before update on public.products
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- supplier_products (cost, stock and lead time per supplier)
-- ---------------------------------------------------------------------------

create table public.supplier_products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  supplier_id uuid not null,
  product_id uuid not null,
  supplier_sku text,
  cost_pence bigint check (cost_pence >= 0),
  -- null: the supplier doesn't report stock.
  stock_qty integer check (stock_qty >= 0),
  lead_time_days integer check (lead_time_days >= 0),
  source text not null default 'manual' check (source in ('manual', 'price_file', 'api')),
  priced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  unique (company_id, id),
  unique (company_id, supplier_id, product_id),
  foreign key (company_id, supplier_id) references public.suppliers (company_id, id) on delete cascade,
  foreign key (company_id, product_id) references public.products (company_id, id) on delete cascade
);

create unique index supplier_products_sku_idx on public.supplier_products (company_id, supplier_id, supplier_sku) where supplier_sku is not null;

create trigger supplier_products_updated_at before update on public.supplier_products
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- price_file_imports (audit of CSV uploads)
-- ---------------------------------------------------------------------------

create table public.price_file_imports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default private.current_company_id()
    references public.companies (id) on delete cascade,
  supplier_id uuid,
  file_name text,
  mapping jsonb not null,
  rows_total integer not null,
  products_created integer not null default 0,
  products_updated integer not null default 0,
  prices_updated integer not null default 0,
  rows_skipped integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  foreign key (company_id, supplier_id) references public.suppliers (company_id, id) on delete set null (supplier_id)
);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.suppliers enable row level security;
alter table public.products enable row level security;
alter table public.supplier_products enable row level security;
alter table public.price_file_imports enable row level security;

revoke all on public.suppliers, public.products, public.supplier_products, public.price_file_imports from anon;

-- Office staff read the catalogue to design and quote; admins manage it.
create policy suppliers_select on public.suppliers for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));
create policy suppliers_write on public.suppliers for all to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin')))
  with check (company_id = (select private.current_company_id()) and (select private.has_role('admin')));

create policy products_select on public.products for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));
create policy products_write on public.products for all to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin')))
  with check (company_id = (select private.current_company_id()) and (select private.has_role('admin')));

create policy supplier_products_select on public.supplier_products for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin', 'office')));
create policy supplier_products_write on public.supplier_products for all to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin')))
  with check (company_id = (select private.current_company_id()) and (select private.has_role('admin')));

create policy price_file_imports_select on public.price_file_imports for select to authenticated
  using (company_id = (select private.current_company_id()) and (select private.has_role('admin')));
create policy price_file_imports_insert on public.price_file_imports for insert to authenticated
  with check (company_id = (select private.current_company_id()) and (select private.has_role('admin')));
