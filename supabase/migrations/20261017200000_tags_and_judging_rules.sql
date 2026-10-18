-- tags_and_judging_rules: org and event tags that people hold, which can grant permissions;
-- judging.assignment rules that ask for judges by tag; tags.eventTags

create or replace function private.setting_defaults(p_namespace text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce($json${"branding":{},"registration":{"signup":"invite","mode":"review","capacity":0,"autoPromote":true},"email":{},"tenancy":{},"accounts":{"deletionRequests":true,"requireAdminMfa":true,"portfolios":false,"deviceSignOut":false,"maxPasskeys":5},"signin":{"providers":[]},"audit":{"retentionDays":60},"access":{"allowedNetworks":[],"onlyUsers":[],"onlyTeams":[],"onlyDivisions":[]},"network":{"clientIpHeader":"x-forwarded-for","trustedHops":1,"trustedProxies":[]},"seo":{"indexing":true},"limits":{},"submissions":{"autoSubmit":false,"deletion":"allow","reminderHours":24,"publicToggle":false},"schedule":{"display":"list","hiddenWindows":[],"showEventTimezone":false},"agenda":{"kinds":[],"reminderMinutes":5,"tabMenu":true},"home":{"layout":{"main":[{"id":"next-steps","type":"next-steps"},{"id":"agenda","type":"agenda"}],"aside":[{"id":"announcements","type":"announcements"},{"id":"facts","type":"facts"},{"id":"prizes","type":"prizes"},{"id":"about","type":"about"}]}},"tabs":{"items":[]},"identity":{"enabled":false},"chat":{"enabled":true,"staff":true,"participants":false,"judges":false,"copyTeam":true},"certificates":{"enabled":false},"announcements":{"toasts":true,"urgentStays":true,"postAs":"author","judges":false},"teams":{"disband":"captain","board":false,"switching":true,"askOrganizer":true,"creation":"participants","leaveLimit":0},"divisions":{"askOnJoin":true},"venue":{},"privacy":{"about":"members","agenda":"members","tracks":"public"},"about":{},"checkin":{"confirmName":true,"allowWalkIns":false,"badgeEmailHours":24,"requiredToCompete":false,"takers":["organizer","staff"]},"voting":{"enabled":false,"who":"participants","votesPerPerson":1,"ownTeam":false,"showCounts":false},"judging":{"blind":false,"showRankings":"organizers","normalize":"none","minJudges":2,"shareWithTeams":"feedback","judgeRubric":true,"teamRubric":false,"teamRubricShows":"name","deliberation":"assigned","flagGap":0,"holdFlagged":true,"assignment":{"perProject":1,"rules":[],"exclude":[]}},"tags":{"eventTags":true},"plugins":{"enabled":[]}}$json$::jsonb -> p_namespace, '{}');
$$;

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
    or (event_id is not null and (select private.has_permission(event_id, 'event.view')))
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
    or (event_id is not null and (select private.has_permission(event_id, 'people.view')))
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

create or replace function private.holds_permission(p_event uuid, p_permission text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role public.event_role;
begin
  if v_uid is null then
    return false;
  end if;

  if private.is_org_admin(private.event_org(p_event)) then
    return true;
  end if;

  v_role := private.event_role(p_event);
  if v_role is null then
    return false;
  end if;
  if v_role = 'organizer' then
    return true;
  end if;

  -- who takes attendance is the event's checkin.takers, not the role matrix; a plugin role can
  -- still grant it below
  if p_permission in ('people.checkin', 'sessions.attendance')
     and coalesce(private.event_setting(p_event, 'checkin') -> 'takers', '["organizer","staff"]')
       ? v_role::text then
    return true;
  end if;

  return exists (
    select 1 from public.role_permissions rp
    where rp.permission = p_permission
      and (
        rp.role_key = v_role::text
        or rp.role_key in (
          select g.role_key from public.event_role_grants g
          where g.event_id = p_event and g.user_id = v_uid
        )
      )
  ) or private.tags_grant(p_event, v_uid, p_permission);
end;
$$;

-- Tops every entry up to p_per_submission judges, least-loaded first. The event's
-- judging.assignment rules come first: each asks for judges holding a tag (one Adult Judge, one
-- Student Judge), optionally only in one division. A rule that isn't strict stops at an even share
-- of the work and lets anyone take the slot; a strict one doubles judges up instead, and fails if
-- no one with the tag can take an entry. Judges holding an excluded tag are left out.
create or replace function public.assign_round_robin(
  p_event uuid, p_per_submission integer default 3, p_round uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config jsonb := coalesce(private.event_setting(p_event, 'judging') -> 'assignment', '{}');
  v_exclude uuid[];
  v_pool integer;
  v_per integer;
  v_cap integer;
  v_count integer := 0;
  v_sub record;
  v_rule record;
  v_have uuid[];
  v_need integer;
  v_judge uuid;
  v_short jsonb := '{}';
  v_assigned uuid[] := '{}';
begin
  if not private.can_manage(p_event) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_round is not null and not exists (
    select 1 from public.judging_rounds where id = p_round and event_id = p_event
  ) then
    raise exception 'unknown round' using errcode = '22023';
  end if;
  select coalesce(array_agg(x::uuid), '{}') into v_exclude
  from jsonb_array_elements_text(coalesce(v_config -> 'exclude', '[]')) x;

  if to_regclass('pg_temp.assign_pool') is not null then
    drop table pg_temp.assign_pool;
  end if;
  create temp table assign_pool (
    id uuid primary key, tags uuid[] not null, load integer not null, tiebreak float8 not null
  ) on commit drop;
  insert into pg_temp.assign_pool
  select m.user_id, h.tags,
    (select count(*) from public.judge_assignments a
     where a.event_id = p_event and a.judge_id = m.user_id and (p_round is null or a.round_id = p_round)),
    random()
  from public.event_members m
  cross join lateral (select private.held_tags(p_event, m.user_id) as tags) h
  where m.event_id = p_event and m.status = 'active'
    and (m.role = 'judge'
      or (m.role in ('staff', 'organizer') and private.tags_grant(p_event, m.user_id, 'judging.score')))
    and not (h.tags && v_exclude);
  select count(*) into v_pool from pg_temp.assign_pool;
  if v_pool = 0 then
    raise exception 'add judges first' using errcode = 'P0001';
  end if;
  v_per := least(p_per_submission, v_pool);

  if to_regclass('pg_temp.assign_entries') is not null then
    drop table pg_temp.assign_entries;
  end if;
  create temp table assign_entries (
    id uuid primary key, team_id uuid not null, division_id uuid, judges uuid[] not null, tiebreak float8 not null
  ) on commit drop;
  insert into pg_temp.assign_entries
  select s.id, s.team_id, t.division_id,
    array(select a.judge_id from public.judge_assignments a
          where a.submission_id = s.id and a.round_id = private.active_round(s.id)),
    random()
  from public.submissions s
  join public.submission_forms f on f.id = s.form_id and f.judged
  join public.teams t on t.id = s.team_id
  where s.event_id = p_event and s.status = 'submitted'
    and (p_round is null or p_round = private.active_round(s.id));

  -- an even share of every slot, existing ones included; one judge may go one over
  select ceil((
    (select coalesce(sum(load), 0) from pg_temp.assign_pool)
    + (select coalesce(sum(greatest(v_per - cardinality(judges), 0)), 0) from pg_temp.assign_entries)
  )::numeric / v_pool)::integer into v_cap;

  for v_sub in select * from pg_temp.assign_entries order by tiebreak loop
    v_have := v_sub.judges;
    for v_rule in
      select (r ->> 'tag')::uuid as tag, greatest(coalesce((r ->> 'count')::integer, 1), 1) as want,
        coalesce((r ->> 'strict')::boolean, false) as must, nullif(r ->> 'division', '')::uuid as division
      from jsonb_array_elements(coalesce(v_config -> 'rules', '[]')) r
      where r ->> 'tag' is not null
    loop
      continue when v_rule.division is not null and v_rule.division is distinct from v_sub.division_id;
      select v_rule.want - count(*) into v_need
      from pg_temp.assign_pool p where p.id = any(v_have) and v_rule.tag = any(p.tags);
      while v_need > 0 loop
        select p.id into v_judge from pg_temp.assign_pool p
        where v_rule.tag = any(p.tags) and p.id <> all(v_have)
          and (v_rule.must or p.load < v_cap)
          and not exists (
            select 1 from public.judge_conflicts c where c.judge_id = p.id and c.team_id = v_sub.team_id)
        order by p.load, p.tiebreak
        limit 1;
        if v_judge is null then
          if v_rule.must then
            v_short := jsonb_set(v_short, array[v_rule.tag::text],
              to_jsonb(coalesce((v_short ->> v_rule.tag::text)::integer, 0) + 1));
          end if;
          exit;
        end if;
        insert into public.judge_assignments (event_id, judge_id, submission_id)
        values (p_event, v_judge, v_sub.id);
        update pg_temp.assign_pool set load = load + 1 where id = v_judge;
        v_have := v_have || v_judge;
        v_assigned := v_assigned || v_judge;
        v_count := v_count + 1;
        v_need := v_need - 1;
      end loop;
    end loop;

    while cardinality(v_have) < v_per loop
      select p.id into v_judge from pg_temp.assign_pool p
      where p.id <> all(v_have)
        and not exists (
          select 1 from public.judge_conflicts c where c.judge_id = p.id and c.team_id = v_sub.team_id)
      order by p.load >= v_cap, p.load, p.tiebreak
      limit 1;
      exit when v_judge is null;
      insert into public.judge_assignments (event_id, judge_id, submission_id)
      values (p_event, v_judge, v_sub.id);
      update pg_temp.assign_pool set load = load + 1 where id = v_judge;
      v_have := v_have || v_judge;
      v_assigned := v_assigned || v_judge;
      v_count := v_count + 1;
    end loop;
  end loop;

  if v_short <> '{}' then
    raise exception '%', (
      select string_agg(format('%s %s no one tagged "%s"', n.value, case when n.value::integer = 1
        then 'project has' else 'projects have' end, coalesce(t.name, n.key)), '; ')
      from jsonb_each_text(v_short) n left join public.tags t on t.id = n.key::uuid
    ) || '. A strict rule needs someone with that tag who has no conflict with the team; nothing was assigned.'
      using errcode = 'P0001';
  end if;

  perform private.audit(p_event, 'judging.assigned', 'event', p_event,
    jsonb_build_object('per_submission', p_per_submission, 'assignments', v_count, 'round', p_round,
      'rules', jsonb_array_length(coalesce(v_config -> 'rules', '[]'))));
  for v_judge in select distinct j from unnest(v_assigned) j loop
    perform private.notify(array[v_judge], p_event, 'judging.assigned',
      (select count(*) from unnest(v_assigned) j where j = v_judge) || ' projects to judge', null,
      '/events/' || (select slug from public.events where id = p_event) || '/judging',
      jsonb_build_object('count', (select count(*) from unnest(v_assigned) j where j = v_judge)::text));
  end loop;
  return v_count;
end;
$$;
