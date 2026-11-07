-- First and last name entered separately, and an optional company. `name`
-- stays the full name everything else uses (search, emails, documents); the
-- console keeps it in step with the two parts.

alter table public.contacts
  add column first_name text check (first_name is null or length(first_name) <= 100),
  add column last_name text check (last_name is null or length(last_name) <= 100),
  add column company_name text check (company_name is null or length(company_name) <= 200);

-- Existing contacts: the first word is the first name, the rest the last name.
update public.contacts
set first_name = split_part(trim(name), ' ', 1),
    last_name = nullif(trim(substr(trim(name), length(split_part(trim(name), ' ', 1)) + 1)), '');

-- Keep the parts and the full name in step, whichever a writer sets: the
-- console sends first and last name; the public enquiry form and older
-- callers send only the full name.
create function private.contact_name_parts() returns trigger
language plpgsql set search_path = '' as $$
declare
  parts_changed boolean := tg_op = 'INSERT' or new.first_name is distinct from old.first_name or new.last_name is distinct from old.last_name;
begin
  if parts_changed and coalesce(nullif(trim(new.first_name), ''), nullif(trim(new.last_name), '')) is not null then
    new.first_name := nullif(trim(new.first_name), '');
    new.last_name := nullif(trim(new.last_name), '');
    new.name := concat_ws(' ', new.first_name, new.last_name);
  elsif tg_op = 'INSERT' or new.name is distinct from old.name then
    new.first_name := split_part(trim(new.name), ' ', 1);
    new.last_name := nullif(trim(substr(trim(new.name), length(split_part(trim(new.name), ' ', 1)) + 1)), '');
  end if;
  return new;
end;
$$;

create trigger contacts_name_parts before insert or update of name, first_name, last_name on public.contacts
  for each row execute function private.contact_name_parts();
