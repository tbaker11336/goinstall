-- Proposals get an "About us" from the company and the customer's survey
-- details with staff notes beside each section.
alter table public.companies
  add column about text check (about is null or length(about) <= 5000);

alter table public.proposals
  -- Staff notes per survey section and which sections to leave off:
  -- { "<kind>:<section>": { "note": "...", "hidden": true } }.
  add column survey_notes jsonb not null default '{}'::jsonb,
  -- What the customer sees: the survey answers and notes, refreshed while
  -- the proposal is a draft and frozen once it's sent.
  add column survey jsonb not null default '[]'::jsonb;
