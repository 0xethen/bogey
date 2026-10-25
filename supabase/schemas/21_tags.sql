-- Tags label people ("Adult Judge", "Mentor"). An org tag applies in every event of the org, an event
-- tag only in its event (when the org's tags.eventTags allows them). A tag can grant permissions on
-- top of its holder's event role, and judging rules (judging.assignment) pick judges by tag.
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  event_id uuid references public.events on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 40),
  description text not null default '' check (length(description) <= 200),
  tone text not null default 'gray'
    check (tone in ('gray', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink')),
  permissions text[] not null default '{}' check (
    cardinality(permissions) <= 20
    and array_to_string(permissions, ',') ~ '^([a-z][a-z0-9-]*\.[a-z][a-z0-9-]*(,|$))*$'),
  sort smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (org_id, event_id, name)
);
create index tags_event_id_fk_idx on public.tags (event_id);

create table public.tag_holders (
  tag_id uuid not null references public.tags on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  org_id uuid not null,
  event_id uuid,
  -- an org tag needs an org member, an event tag an event member; leaving drops the tag
  member_org uuid generated always as (case when event_id is null then org_id end) stored,
  assigned_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  primary key (tag_id, user_id),
  foreign key (event_id, user_id) references public.event_members (event_id, user_id) on delete cascade,
  foreign key (member_org, user_id) references public.org_members (org_id, user_id) on delete cascade
);
create index tag_holders_user_idx on public.tag_holders (user_id, org_id);
create index tag_holders_event_user_fk_idx on public.tag_holders (event_id, user_id);
create index tag_holders_member_org_fk_idx on public.tag_holders (member_org, user_id);
create index tag_holders_assigned_by_fk_idx on public.tag_holders (assigned_by);

create trigger tags_touch before update on public.tags
  for each row execute function private.touch_updated_at();

create function private.prepare_tag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.event_id is not null then
    new.org_id := (select org_id from public.events where id = new.event_id);
  end if;
  if tg_op = 'UPDATE' and (new.org_id, new.event_id) is distinct from (old.org_id, old.event_id) then
    raise exception 'a tag stays where it was made' using errcode = '22023';
  end if;
  select array_agg(distinct p order by p) into new.permissions from unnest(new.permissions) p;
  new.permissions := coalesce(new.permissions, '{}');
  return new;
end;
$$;
create trigger tags_prepare before insert or update on public.tags
  for each row execute function private.prepare_tag();

create function private.prepare_tag_holder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select t.org_id, t.event_id into new.org_id, new.event_id from public.tags t where t.id = new.tag_id;
  new.assigned_by := coalesce((select auth.uid()), new.assigned_by);
  return new;
end;
$$;
create trigger tag_holders_prepare before insert on public.tag_holders
  for each row execute function private.prepare_tag_holder();

-- whether the event's org lets its events make their own tags
create function private.event_tags_allowed(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((private.event_setting(p_event, 'tags') ->> 'eventTags')::boolean, true);
$$;

-- tags the person holds that count in this event: the org's, and the event's own while allowed
create function private.held_tags(p_event uuid, p_user uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(t.id), '{}')
  from public.tag_holders h
  join public.tags t on t.id = h.tag_id
  where h.user_id = p_user
    and t.org_id = private.event_org(p_event)
    and (t.event_id is null or (t.event_id = p_event and private.event_tags_allowed(p_event)));
$$;

create function private.tags_grant(p_event uuid, p_user uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tags t
    where t.id = any(private.held_tags(p_event, p_user)) and p_permission = any(t.permissions));
$$;

create function private.can_edit_tag(p_org uuid, p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_event is null then private.is_org_admin(p_org)
    else private.can_manage(p_event) and private.event_tags_allowed(p_event)
  end;
$$;

grant execute on function
  private.event_tags_allowed(uuid),
  private.held_tags(uuid, uuid),
  private.tags_grant(uuid, uuid, text),
  private.can_edit_tag(uuid, uuid)
to authenticated, service_role;

alter table public.tags enable row level security;
alter table public.tag_holders enable row level security;

create policy tags_select on public.tags for select to authenticated
  using (
    (event_id is null and (select private.is_org_member(org_id)))
    or (event_id is not null and (event_id = any ((select private.events_where('event.view'))::uuid[])))
    or (select private.is_org_admin(org_id))
  );
create policy tags_insert on public.tags for insert to authenticated
  with check ((select private.can_edit_tag(org_id, event_id)));
create policy tags_update on public.tags for update to authenticated
  using ((select private.can_edit_tag(org_id, event_id)))
  with check ((select private.can_edit_tag(org_id, event_id)));
create policy tags_delete on public.tags for delete to authenticated
  using ((select private.can_edit_tag(org_id, event_id)));

create policy tag_holders_select on public.tag_holders for select to authenticated
  using (
    user_id = (select auth.uid())
    or (event_id is null and (select private.is_org_member(org_id)))
    or (event_id is not null and (event_id = any ((select private.events_where('people.view'))::uuid[])))
    or (select private.is_org_admin(org_id))
  );

-- Replaces the tags one person holds among those the caller may hand out: an event's own tags with
-- p_event, the org's with p_org. Tags outside that scope are left alone.
create function public.set_person_tags(p_user uuid, p_tags uuid[], p_org uuid default null, p_event uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := coalesce(p_org, private.event_org(p_event));
  v_added uuid[];
  v_removed uuid[];
begin
  if v_org is null or (p_event is not null and private.event_org(p_event) <> v_org) then
    raise exception 'unknown org or event' using errcode = '22023';
  end if;
  if not private.can_edit_tag(v_org, p_event) then
    raise exception 'Only organizers can change these tags.' using errcode = '42501';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_tags, '{}')) x
    where not exists (
      select 1 from public.tags t
      where t.id = x and t.org_id = v_org and t.event_id is not distinct from p_event)
  ) then
    raise exception 'that tag isn''t in this %', case when p_event is null then 'org' else 'event' end
      using errcode = '22023';
  end if;
  if p_event is null and not exists (select 1 from public.org_members where org_id = v_org and user_id = p_user) then
    raise exception 'org tags go on org members' using errcode = '22023';
  end if;
  if p_event is not null and not exists (
    select 1 from public.event_members where event_id = p_event and user_id = p_user
  ) then
    raise exception 'event tags go on people in the event' using errcode = '22023';
  end if;

  with gone as (
    delete from public.tag_holders h
    using public.tags t
    where t.id = h.tag_id and h.user_id = p_user and t.org_id = v_org
      and t.event_id is not distinct from p_event and h.tag_id <> all(coalesce(p_tags, '{}'))
    returning h.tag_id
  )
  select coalesce(array_agg(tag_id), '{}') into v_removed from gone;
  with added as (
    insert into public.tag_holders (tag_id, user_id)
    select distinct x, p_user from unnest(coalesce(p_tags, '{}')) x
    on conflict do nothing
    returning tag_id
  )
  select coalesce(array_agg(tag_id), '{}') into v_added from added;

  if cardinality(v_added) + cardinality(v_removed) > 0 then
    if p_event is null then
      perform private.audit_org(v_org, 'member.tags_set', 'user', p_user,
        jsonb_build_object('added', v_added, 'removed', v_removed));
    else
      perform private.audit(p_event, 'member.tags_set', 'user', p_user,
        jsonb_build_object('added', v_added, 'removed', v_removed));
    end if;
  end if;
end;
$$;
revoke execute on function public.set_person_tags(uuid, uuid[], uuid, uuid) from public, anon;
grant execute on function public.set_person_tags(uuid, uuid[], uuid, uuid) to authenticated;

create function private.audit_tag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.tags := case when tg_op = 'DELETE' then old else new end;
  v_meta jsonb := jsonb_build_object('name', v_row.name, 'permissions', v_row.permissions);
begin
  if (select auth.uid()) is null then
    return null;
  end if;
  if v_row.event_id is null then
    perform private.audit_org(v_row.org_id,
      case tg_op when 'INSERT' then 'tags.created' when 'DELETE' then 'tags.deleted' else 'tags.updated' end,
      'tag', v_row.id, v_meta);
  else
    perform private.audit(v_row.event_id,
      case tg_op when 'INSERT' then 'tags.created' when 'DELETE' then 'tags.deleted' else 'tags.updated' end,
      'tag', v_row.id, v_meta);
  end if;
  return null;
end;
$$;
create trigger tags_audit after insert or update or delete on public.tags
  for each row execute function private.audit_tag();
