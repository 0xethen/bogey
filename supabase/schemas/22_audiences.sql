-- Audiences: registration questions and submission items for chosen divisions and tags only

create function private.uuid_list(p_ids jsonb)
returns uuid[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct v::uuid), '{}')
  from jsonb_array_elements_text(case when jsonb_typeof(p_ids) = 'array' then p_ids else '[]' end) v
  where v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$$;

-- empty divisions and tags mean everyone; otherwise either one is enough
create function private.audience_reaches(p_divisions uuid[], p_tags uuid[], p_division uuid, p_held uuid[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (cardinality(p_divisions) = 0 and cardinality(p_tags) = 0)
      or p_division = any (p_divisions)
      or coalesce(p_held, '{}') && p_tags,
    false);
$$;

create function private.known_divisions(p_event uuid, p_ids uuid[])
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(d.id order by d.sort, d.name), '{}')
  from public.divisions d
  where d.event_id = p_event and d.id = any (p_ids);
$$;

-- the org's tags and the event's own
create function private.known_tags(p_event uuid, p_ids uuid[])
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(t.id order by t.sort, t.name), '{}')
  from public.tags t
  where t.org_id = private.event_org(p_event)
    and (t.event_id is null or t.event_id = p_event)
    and t.id = any (p_ids);
$$;

create function private.with_audience(p_question jsonb, p_divisions uuid[], p_tags uuid[])
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select (p_question - 'divisionIds' - 'tagIds')
    || case when cardinality(p_divisions) > 0
      then jsonb_build_object('divisionIds', to_jsonb(p_divisions)) else '{}' end
    || case when cardinality(p_tags) > 0 then jsonb_build_object('tagIds', to_jsonb(p_tags)) else '{}' end;
$$;

-- the questions someone in this division with these tags is asked
create function private.fields_for(p_fields jsonb, p_division uuid, p_held uuid[])
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(q order by n), '[]')
  from jsonb_array_elements(coalesce(p_fields, '[]')) with ordinality as x(q, n)
  where private.audience_reaches(
    private.uuid_list(q -> 'divisionIds'), private.uuid_list(q -> 'tagIds'), p_division, p_held);
$$;

-- a registrant's division: their membership's, else their registration's
create function private.registrant_division(p_event uuid, p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select m.division_id from public.event_members m where m.event_id = p_event and m.user_id = p_user),
    (select r.division_id from public.registrations r
      where r.event_id = p_event
        and (r.user_id = p_user
          or lower(r.email::text) = (select lower(u.email::text) from auth.users u where u.id = p_user))
      order by r.user_id is not distinct from p_user desc
      limit 1));
$$;

-- every tag a team's members hold in its event
create function private.team_tags(p_team uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct held), '{}')
  from public.team_members tm
  cross join lateral unnest(private.held_tags(tm.event_id, tm.user_id)) held
  where tm.team_id = p_team;
$$;
revoke execute on function private.registrant_division(uuid, uuid) from anon, authenticated;
revoke execute on function private.team_tags(uuid) from anon, authenticated;

-- Saved audiences keep only divisions and tags that exist here, so deleting one drops it from them.
create function private.clean_onboarding_audience()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(new.fields) is distinct from 'array' then
    return new;
  end if;
  select coalesce(jsonb_agg(
    case when jsonb_typeof(q) = 'object' then private.with_audience(q,
      private.known_divisions(new.event_id, private.uuid_list(q -> 'divisionIds')),
      private.known_tags(new.event_id, private.uuid_list(q -> 'tagIds')))
    else q end order by n), '[]')
  into new.fields
  from jsonb_array_elements(new.fields) with ordinality as x(q, n);
  return new;
end;
$$;
create trigger onboarding_forms_audience before insert or update of fields on public.onboarding_forms
  for each row execute function private.clean_onboarding_audience();

create function private.clean_item_audience()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.division_ids := private.known_divisions(new.event_id, new.division_ids);
  new.tag_ids := private.known_tags(new.event_id, new.tag_ids);
  return new;
end;
$$;
create trigger submission_items_audience before insert or update of division_ids, tag_ids
  on public.submission_items
  for each row execute function private.clean_item_audience();

create function private.forget_audience()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'divisions' then
    update public.submission_items set division_ids = division_ids
    where event_id = old.event_id and old.id = any (division_ids);
    update public.onboarding_forms set fields = fields
    where event_id = old.event_id
      and jsonb_path_exists(fields, '$[*].divisionIds[*] ? (@ == $id)', jsonb_build_object('id', old.id));
  else
    update public.submission_items set tag_ids = tag_ids where old.id = any (tag_ids);
    update public.onboarding_forms set fields = fields
    where jsonb_path_exists(fields, '$[*].tagIds[*] ? (@ == $id)', jsonb_build_object('id', old.id));
  end if;
  return null;
end;
$$;
create trigger divisions_forget_audience after delete on public.divisions
  for each row execute function private.forget_audience();
create trigger tags_forget_audience after delete on public.tags
  for each row execute function private.forget_audience();

-- the registration questions the caller is asked
create function public.my_onboarding_form(p_event uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when private.can_view_event(p_event) then private.fields_for(
    (select f.fields from public.onboarding_forms f where f.event_id = p_event),
    private.registrant_division(p_event, (select auth.uid())),
    private.held_tags(p_event, (select auth.uid())))
  else '[]' end;
$$;
grant execute on function public.my_onboarding_form(uuid) to authenticated;

-- the tags that count for submission items: a team's members', or the caller's own without a team
create function public.audience_tags(p_event uuid, p_team uuid default null)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_team is not null
      and exists (select 1 from public.teams t where t.id = p_team and t.event_id = p_event)
      and (private.is_team_member(p_team) or private.can_manage(p_event))
      then private.team_tags(p_team)
    else private.held_tags(p_event, (select auth.uid()))
  end;
$$;
grant execute on function public.audience_tags(uuid, uuid) to authenticated;
