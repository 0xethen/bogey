-- judge_pins: the opposite of a conflict. Organizers pin a judge to a team; auto-assign places pinned
-- judges first, pinning assigns them to the team's projects already in judging, and a conflict removes the pin

-- The opposite of a conflict: an organizer wants this judge on this team's projects. Auto-assign
-- places pinned judges first, and pinning assigns them to the team's projects already in judging.
create table public.judge_pins (
  event_id uuid not null,
  judge_id uuid not null,
  team_id uuid not null,
  created_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  primary key (judge_id, team_id),
  foreign key (event_id, judge_id) references public.event_members (event_id, user_id) on delete cascade,
  foreign key (event_id, team_id) references public.teams (event_id, id) on delete cascade
);
create index judge_pins_event_id_judge_id_fk_idx on public.judge_pins (event_id, judge_id);
create index judge_pins_event_id_team_id_fk_idx on public.judge_pins (event_id, team_id);
create index judge_pins_created_by_fk_idx on public.judge_pins (created_by);

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
    -- pinned judges come first, past the even share and the excluded tags: an organizer asked for them
    for v_judge in
      select pn.judge_id from public.judge_pins pn
      join public.event_members m on m.event_id = p_event and m.user_id = pn.judge_id and m.status = 'active'
      where pn.event_id = p_event and pn.team_id = v_sub.team_id and pn.judge_id <> all(v_have)
        and not exists (
          select 1 from public.judge_conflicts c where c.judge_id = pn.judge_id and c.team_id = v_sub.team_id)
      order by pn.created_at
    loop
      insert into public.judge_assignments (event_id, judge_id, submission_id)
      values (p_event, v_judge, v_sub.id);
      update pg_temp.assign_pool set load = load + 1 where id = v_judge;
      v_have := v_have || v_judge;
      v_assigned := v_assigned || v_judge;
      v_count := v_count + 1;
    end loop;
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

create or replace function private.add_conflict(p_event uuid, p_judge uuid, p_team uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_other uuid;
begin
  insert into public.judge_conflicts (event_id, judge_id, team_id, reason, declared_by)
  values (p_event, p_judge, p_team, left(coalesce(p_reason, ''), 500), (select auth.uid()))
  on conflict (judge_id, team_id) do update set reason = excluded.reason;
  delete from public.judge_pins where judge_id = p_judge and team_id = p_team;

  for v_row in
    delete from public.judge_assignments a using public.submissions s
    where a.judge_id = p_judge and a.submission_id = s.id and s.team_id = p_team and a.event_id = p_event
    returning a.submission_id, a.round_id
  loop
    select m.user_id into v_other
    from public.event_members m
    where m.event_id = p_event and m.role = 'judge' and m.status = 'active' and m.user_id <> p_judge
      and not exists (select 1 from public.judge_conflicts c where c.judge_id = m.user_id and c.team_id = p_team)
      and not exists (select 1 from public.judge_assignments x
                      where x.judge_id = m.user_id and x.submission_id = v_row.submission_id and x.round_id = v_row.round_id)
    order by (select count(*) from public.judge_assignments y where y.judge_id = m.user_id), random()
    limit 1;
    if v_other is not null then
      insert into public.judge_assignments (event_id, judge_id, submission_id, round_id)
      values (p_event, v_other, v_row.submission_id, v_row.round_id)
      on conflict do nothing;
    end if;
  end loop;
  perform private.audit(p_event, 'judging.conflict_declared', 'team', p_team,
    jsonb_build_object('judge', p_judge));
end;
$$;

create function public.pin_judge(p_event uuid, p_judge uuid, p_team uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not private.can_manage(p_event) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.event_members m
    where m.event_id = p_event and m.user_id = p_judge and m.status = 'active'
      and (m.role = 'judge'
        or (m.role in ('staff', 'organizer') and private.tags_grant(p_event, m.user_id, 'judging.score')))
  ) then
    raise exception 'only judges can be pinned' using errcode = '22023';
  end if;
  if not exists (select 1 from public.teams where id = p_team and event_id = p_event) then
    raise exception 'unknown team' using errcode = '22023';
  end if;
  if exists (select 1 from public.judge_conflicts where judge_id = p_judge and team_id = p_team) then
    raise exception 'This judge has a conflict with that team. Lift the conflict first.'
      using errcode = 'P0001';
  end if;

  insert into public.judge_pins (event_id, judge_id, team_id, created_by)
  values (p_event, p_judge, p_team, (select auth.uid()))
  on conflict (judge_id, team_id) do nothing;

  -- the team's projects already in judging get the judge now, in the round each is in
  with added as (
    insert into public.judge_assignments (event_id, judge_id, submission_id, round_id)
    select p_event, p_judge, s.id, private.active_round(s.id)
    from public.submissions s
    join public.submission_forms f on f.id = s.form_id and f.judged
    where s.event_id = p_event and s.team_id = p_team and s.status = 'submitted'
      and private.active_round(s.id) is not null
    on conflict do nothing
    returning 1
  )
  select count(*) into v_count from added;

  perform private.audit(p_event, 'judging.pin_added', 'team', p_team,
    jsonb_build_object('judge', p_judge, 'assignments', v_count));
  if v_count > 0 then
    perform private.notify(array[p_judge], p_event, 'judging.assigned',
      v_count || ' projects to judge', null,
      '/events/' || (select slug from public.events where id = p_event) || '/judging',
      jsonb_build_object('count', v_count::text));
  end if;
  return v_count;
end;
$$;

-- assignments the pin made stay; unassign them on the judging page if they should go too
create function public.unpin_judge(p_event uuid, p_judge uuid, p_team uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can_manage(p_event) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from public.judge_pins where event_id = p_event and judge_id = p_judge and team_id = p_team;
  if found then
    perform private.audit(p_event, 'judging.pin_removed', 'team', p_team, jsonb_build_object('judge', p_judge));
  end if;
end;
$$;

alter table public.judge_pins enable row level security;
create policy judge_pins_select on public.judge_pins for select to authenticated
  using ((select private.can_manage(event_id)));

grant execute on function
  public.pin_judge(uuid, uuid, uuid),
  public.unpin_judge(uuid, uuid, uuid)
to authenticated;
