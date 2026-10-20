-- Phase 1 CRM behaviour: contact stage kept in step with projects, Kanban
-- moves, last-activity tracking and the public enquiry form key.

-- ---------------------------------------------------------------------------
-- Public enquiry form key. Identifies the company on the public enquiry
-- endpoint; it is not a secret (it appears in the company's website form) and
-- can be rotated by an admin.
-- ---------------------------------------------------------------------------

alter table public.companies
  add column enquiry_form_key text not null unique
    default replace(gen_random_uuid()::text, '-', '');

-- ---------------------------------------------------------------------------
-- Contact stage follows the contact's projects: the furthest open project
-- decides the Kanban column; the contact is lost only when every project is
-- lost. Mirrors contactStageFromProjects in packages/core/src/stages.ts.
-- ---------------------------------------------------------------------------

create function private.contact_stage_for_project(s public.project_stage)
returns public.contact_stage
language sql immutable set search_path = '' as $$
  select (case s
    when 'enquiry' then 'new_enquiry'
    when 'survey' then 'survey'
    when 'design' then 'design'
    when 'proposal_sent' then 'proposal_sent'
    when 'accepted' then 'proposal_sent'
    when 'lost' then 'lost'
    else 'won'
  end)::public.contact_stage;
$$;

create function private.sync_contact_stage(p_company_id uuid, p_contact_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_furthest public.project_stage;
  v_stage public.contact_stage;
  v_reason text;
begin
  if not exists (
    select 1 from public.projects where company_id = p_company_id and contact_id = p_contact_id
  ) then
    return;
  end if;

  -- Enum values compare in declaration order, so max() is the furthest stage.
  select max(stage) into v_furthest
  from public.projects
  where company_id = p_company_id and contact_id = p_contact_id and stage <> 'lost';

  if v_furthest is not null then
    v_stage := private.contact_stage_for_project(v_furthest);
  else
    v_stage := 'lost';
    select lost_reason into v_reason
    from public.projects
    where company_id = p_company_id and contact_id = p_contact_id
    order by stage_changed_at desc
    limit 1;
  end if;

  update public.contacts
  set stage = v_stage,
      lost_reason = case when v_stage = 'lost' then v_reason end
  where company_id = p_company_id and id = p_contact_id
    and (stage is distinct from v_stage
         or lost_reason is distinct from case when v_stage = 'lost' then v_reason end);
end;
$$;

create function private.on_project_change_sync_contact() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform private.sync_contact_stage(new.company_id, new.contact_id);
  end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.contact_id is distinct from new.contact_id) then
    perform private.sync_contact_stage(old.company_id, old.contact_id);
  end if;
  return null;
end;
$$;

create trigger projects_sync_contact
  after insert or delete or update of stage, contact_id, lost_reason on public.projects
  for each row execute function private.on_project_change_sync_contact();

-- ---------------------------------------------------------------------------
-- Kanban move. Moves the contact's main project (furthest open one, or the
-- most recently lost one when reopening) to the matching project stage; the
-- contact's column then follows from the trigger above. Contacts without
-- projects are moved directly. Runs as the caller, so RLS applies.
-- ---------------------------------------------------------------------------

create function public.set_contact_stage(
  p_contact_id uuid,
  p_stage public.contact_stage,
  p_lost_reason text default null
) returns public.contact_stage
language plpgsql security invoker set search_path = '' as $$
declare
  v_project_id uuid;
  v_target public.project_stage;
  v_result public.contact_stage;
begin
  if not exists (select 1 from public.contacts where id = p_contact_id) then
    raise exception 'contact not found' using errcode = 'no_data_found';
  end if;

  if p_stage = 'lost' then
    if nullif(trim(p_lost_reason), '') is null then
      raise exception 'a reason is needed to mark a contact lost' using errcode = 'check_violation';
    end if;
    if exists (
      select 1 from public.projects
      where contact_id = p_contact_id
        and stage in ('deposit_paid', 'kit_ordered', 'scheduled', 'complete')
    ) then
      raise exception 'this contact has a project past deposit and cannot be marked lost'
        using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.projects where contact_id = p_contact_id) then
      update public.projects set stage = 'lost', lost_reason = trim(p_lost_reason)
      where contact_id = p_contact_id and stage <> 'lost';
    else
      update public.contacts set stage = 'lost', lost_reason = trim(p_lost_reason)
      where id = p_contact_id;
    end if;
  else
    v_target := (case p_stage
      when 'new_enquiry' then 'enquiry'
      when 'won' then 'deposit_paid'
      else p_stage::text
    end)::public.project_stage;

    select id into v_project_id
    from public.projects
    where contact_id = p_contact_id and stage <> 'lost'
    order by stage desc, updated_at desc
    limit 1;

    if v_project_id is null then
      select id into v_project_id
      from public.projects
      where contact_id = p_contact_id
      order by stage_changed_at desc
      limit 1;
    end if;

    if v_project_id is null then
      update public.contacts set stage = p_stage, lost_reason = null where id = p_contact_id;
    else
      update public.projects set stage = v_target
      where id = v_project_id and stage is distinct from v_target;
    end if;
  end if;

  select stage into v_result from public.contacts where id = p_contact_id;
  return v_result;
end;
$$;

revoke all on function public.set_contact_stage(uuid, public.contact_stage, text) from public, anon;
grant execute on function public.set_contact_stage(uuid, public.contact_stage, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Last activity: messages and project activity bump the contact.
-- ---------------------------------------------------------------------------

create function private.touch_contact_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.contact_id is not null then
    update public.contacts set last_activity_at = new.created_at
    where company_id = new.company_id and id = new.contact_id and last_activity_at < new.created_at;
  end if;
  return null;
end;
$$;

create trigger messages_touch_contact after insert on public.messages
  for each row execute function private.touch_contact_activity();

create trigger activity_log_touch_contact after insert on public.activity_log
  for each row execute function private.touch_contact_activity();
