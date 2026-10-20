-- Companies send email from their own domain once it's verified with the
-- email provider (Resend). Until then, email goes from the platform address
-- (EMAIL_FROM) with the company's name.

alter table public.companies
  add column email_domain text check (email_domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'),
  -- The provider's id for the domain.
  add column email_domain_provider_id text,
  add column email_domain_status text not null default 'none'
    check (email_domain_status in ('none', 'not_started', 'pending', 'verified', 'failed', 'temporary_failure')),
  -- DNS records to add, as the provider returned them.
  add column email_domain_records jsonb not null default '[]'::jsonb check (jsonb_typeof(email_domain_records) = 'array'),
  add column email_domain_checked_at timestamptz,
  -- Local part of the sending address, e.g. "hello" for hello@example.co.uk.
  add column email_from_local text not null default 'hello' check (email_from_local ~ '^[a-z0-9][a-z0-9._-]{0,62}$'),
  -- Set only while the domain is verified: what emails are sent from.
  add column email_sender text;

-- A domain can only belong to one company.
create unique index companies_email_domain_idx on public.companies (lower(email_domain)) where email_domain is not null;
