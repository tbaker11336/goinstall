-- Xero: each company connects its own organisation (Settings › Integrations).
-- OAuth tokens are encrypted by the app (key in INTEGRATION_TOKEN_KEY) and
-- kept in a private table nobody can read through the API: only the server
-- (service role) uses them. The integration row holds the settings: tenant,
-- account codes, tax types per VAT rate, payment account, invoice status.
create table private.integration_secrets (
  integration_id uuid primary key references public.integrations (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  -- AES-256-GCM, base64: iv.tag.ciphertext of the JSON token set.
  ciphertext text not null,
  updated_at timestamptz not null default now()
);
alter table private.integration_secrets enable row level security;
revoke all on private.integration_secrets from public, anon, authenticated;

-- Where each invoice and payment stands in Xero.
alter table public.invoices
  add column xero_error text check (xero_error is null or length(xero_error) <= 1000);
alter table public.payments
  add column xero_payment_id text;
