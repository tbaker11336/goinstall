-- The company's proposal template (Settings › Proposal): a front cover and
-- pages such as reviews, featured work and accreditations around the quote,
-- in the company's order. Sent proposals keep the template they were sent
-- with (proposals.template); drafts use the company's current one.
alter table public.companies
  add column proposal_template jsonb not null default '{}'::jsonb check (jsonb_typeof(proposal_template) = 'object');
alter table public.proposals
  add column template jsonb check (template is null or jsonb_typeof(template) = 'object');
