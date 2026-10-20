-- Solar designer: the site plan drawn around the roofs (equipment markers,
-- cable runs, measurements) and which MPPT input each hand-wired string
-- uses. Panels carry their string number in segments[].panels[].s.
alter table public.solar_designs
  add column site_markup jsonb not null default '{"markers": [], "cables": [], "measurements": []}'::jsonb
    check (jsonb_typeof(site_markup) = 'object'),
  add column string_plan jsonb
    check (string_plan is null or jsonb_typeof(string_plan) = 'object');

comment on column public.solar_designs.site_markup is
  '{markers:[{id,kind,x,y,note}], cables:[{id,kind,points:[{x,y}],extraM,label}], measurements:[{id,a,b}]}: plan metres from the site centre';
comment on column public.solar_designs.string_plan is
  '{strings:[{mppt}]}: MPPT input per hand-wired string (index = string number - 1); null when strings are split automatically';
