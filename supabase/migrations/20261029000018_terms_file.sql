-- Terms and conditions as a PDF as well as (or instead of) text. The
-- company's current file is copied onto each proposal, so a sent proposal
-- keeps the terms the customer saw even after the company uploads new ones.

alter table public.companies
  add column terms_file_id uuid,
  add constraint companies_terms_file_fk foreign key (id, terms_file_id)
    references public.files (company_id, id) on delete set null (terms_file_id);

alter table public.proposals
  add column terms_file_id uuid,
  add constraint proposals_terms_file_fk foreign key (company_id, terms_file_id)
    references public.files (company_id, id) on delete set null (terms_file_id);

-- A sent version's content is frozen, now including its terms file.
create or replace function private.guard_proposal_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status <> 'draft' and (
    new.subtotal_pence is distinct from old.subtotal_pence or new.vat_pence is distinct from old.vat_pence
    or new.total_pence is distinct from old.total_pence or new.deposit_pct is distinct from old.deposit_pct
    or new.deposit_pence is distinct from old.deposit_pence or new.title is distinct from old.title
    or new.intro is distinct from old.intro or new.terms is distinct from old.terms or new.summary is distinct from old.summary
    or (new.terms_file_id is distinct from old.terms_file_id and new.terms_file_id is not null)
  ) then
    raise exception 'a sent proposal cannot be edited; create a new version' using errcode = 'check_violation';
  end if;
  -- Only the customer (through the token-checked public page, which runs
  -- as the service role) can view or accept a proposal.
  if current_user = 'authenticated' and new.status is distinct from old.status and new.status in ('viewed', 'accepted') then
    raise exception 'only the customer can view or accept a proposal' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
