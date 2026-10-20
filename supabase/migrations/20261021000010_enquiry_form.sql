-- Settings › Marketing: the hosted website enquiry form each company builds
-- and embeds on its own site (heading, fields, products, wording).
alter table public.companies
  add column enquiry_form jsonb not null default '{}'::jsonb check (jsonb_typeof(enquiry_form) = 'object');
