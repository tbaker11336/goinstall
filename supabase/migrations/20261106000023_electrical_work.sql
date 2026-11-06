-- General electrical work (lighting circuits, consumer unit changes, EICRs…)
-- as a project product. For now it is described in words and quoted by hand:
-- no design step, no structured survey.

alter type public.product_type add value if not exists 'electrical';

-- What the job is, in the office's own words.
alter table public.projects
  add column work_description text check (work_description is null or length(work_description) <= 5000);
