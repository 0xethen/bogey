-- judging_formats: a round is judged online, with live demos (panels of judges hear teams in
-- timed slots) or offline (organizers enter the scores); checkin.takers can name tags too

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
  v_takers jsonb;
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

  -- who takes attendance is the event's checkin.takers, not the role matrix: roles, and tags as
  -- "tag:<id>"; a plugin role can still grant it below
  if p_permission in ('people.checkin', 'sessions.attendance') then
    v_takers := coalesce(private.event_setting(p_event, 'checkin') -> 'takers', '["organizer","staff"]');
    if v_takers ? v_role::text or exists (
      select 1 from unnest(private.held_tags(p_event, v_uid)) held(id)
      where v_takers ? ('tag:' || held.id::text)
    ) then
      return true;
    end if;
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


alter table public.judging_rounds add column format text not null default 'online'
  check (format in ('online', 'demos', 'offline'));
alter table public.ranking_inputs drop constraint ranking_inputs_provider_check;
alter table public.ranking_inputs add constraint ranking_inputs_provider_check
  check (provider = 'offline' or provider ~ '^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$');

create or replace function private.check_round_method()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.method is distinct from old.method then
    if new.method <> 'rubric'
      and not private.plugin_enabled(new.event_id, split_part(new.method, '.', 1)) then
      raise exception 'turn on the % extension to rank with its methods', split_part(new.method, '.', 1)
        using errcode = '22023';
    end if;
    perform private.audit(new.event_id, 'judging.method_set', 'judging_round', new.id,
      jsonb_build_object('round', new.name, 'method', new.method));
  end if;
  if new.format is distinct from old.format then
    perform private.audit(new.event_id, 'judging.format_set', 'judging_round', new.id,
      jsonb_build_object('round', new.name, 'format', new.format));
  end if;
  return new;
end;
$$;


-- Live demos: in a round judged by 'demos', teams present one after another to a panel of judges
-- (one panel for a small event, several in parallel rooms for a big one). A panel's slots run back
-- to back from starts_at, slot_minutes each, so reordering moves the times with it.
create table public.judging_panels (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  round_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 60),
  location text not null default '' check (length(location) <= 120),
  starts_at timestamptz,
  slot_minutes smallint not null default 8 check (slot_minutes between 1 and 240),
  sort smallint not null default 0,
  -- the slot presenting now, moved along by the panel's judges or organizers; null before the first
  now_position smallint check (now_position >= 0),
  created_at timestamptz not null default now(),
  unique (event_id, id),
  unique (round_id, id),
  foreign key (event_id, round_id) references public.judging_rounds (event_id, id) on delete cascade
);
create index judging_panels_event_id_round_id_fk_idx on public.judging_panels (event_id, round_id);

-- a judge sits on one panel a round
create table public.panel_judges (
  event_id uuid not null,
  round_id uuid not null,
  panel_id uuid not null,
  judge_id uuid not null,
  primary key (panel_id, judge_id),
  unique (round_id, judge_id),
  foreign key (round_id, panel_id) references public.judging_panels (round_id, id) on delete cascade,
  foreign key (event_id, judge_id) references public.event_members (event_id, user_id) on delete cascade
);
create index panel_judges_round_id_panel_id_fk_idx on public.panel_judges (round_id, panel_id);
create index panel_judges_event_id_judge_id_fk_idx on public.panel_judges (event_id, judge_id);

-- an entry presents once a round, at its position in its panel's order
create table public.panel_slots (
  event_id uuid not null,
  round_id uuid not null,
  panel_id uuid not null,
  submission_id uuid not null,
  position smallint not null check (position >= 0),
  primary key (round_id, submission_id),
  unique (panel_id, position) deferrable initially deferred,
  foreign key (round_id, panel_id) references public.judging_panels (round_id, id) on delete cascade,
  foreign key (event_id, submission_id) references public.submissions (event_id, id) on delete cascade
);
create index panel_slots_round_id_panel_id_fk_idx on public.panel_slots (round_id, panel_id);
create index panel_slots_event_id_submission_id_fk_idx on public.panel_slots (event_id, submission_id);

create or replace function private.rank_submissions(p_event uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with norm as (
    select coalesce(private.event_setting(p_event, 'judging') ->> 'normalize', 'none') as m
  ),
  entries as (
    select s.id as submission_id, s.team_id, r.id as round_id, r.ordinal, r.name as round_name,
      case when r.format = 'offline' then 'offline' else r.method end as method, sr.rubric_id
    from public.judging_rounds r
    join public.submission_forms f on f.id = r.form_id and f.judged
    join public.submissions s on s.form_id = f.id and s.status = 'submitted'
    left join public.submission_rubrics sr on sr.submission_id = s.id
    where r.event_id = p_event
      and (r.ordinal = 1 or exists (
        select 1 from public.round_entries e where e.round_id = r.id and e.submission_id = s.id))
  ),
  all_scores as (
    select sc.submission_id, sc.round_id, sc.criterion_id, sc.judge_id, sc.value,
      exists (select 1 from public.judge_conflicts jc
              where jc.judge_id = sc.judge_id and jc.team_id = en.team_id) as conflicted
    from public.scores sc
    join entries en on en.submission_id = sc.submission_id and en.round_id = sc.round_id
  ),
  valid as (select * from all_scores where not conflicted),
  judge_stats as (
    select judge_id, round_id, criterion_id, avg(value) as mean,
      coalesce(stddev_pop(value), 0) as sd, min(value) as lo, max(value) as hi
    from valid group by judge_id, round_id, criterion_id
  ),
  adjusted as (
    select v.submission_id, v.round_id, v.criterion_id,
      greatest(0, least(1, (v.value - c.min_score) / (c.max_score - c.min_score))) as raw_n,
      greatest(0, least(1, case (select m from norm)
        when 'minmax' then case when js.hi = js.lo then 0.5 else (v.value - js.lo) / (js.hi - js.lo) end
        when 'zscore' then 0.5 + 0.1 * case when js.sd = 0 then 0 else (v.value - js.mean) / js.sd end
        else (v.value - c.min_score) / (c.max_score - c.min_score)
      end)) as adj_n
    from valid v
    join public.criteria c on c.id = v.criterion_id
    join judge_stats js on js.judge_id = v.judge_id and js.round_id = v.round_id and js.criterion_id = v.criterion_id
  ),
  per_criterion as (
    select en.submission_id, en.round_id, c.id as criterion_id, c.weight,
      avg(a.adj_n) as normalised, avg(a.raw_n) as raw_normalised
    from entries en
    join public.criteria c on c.event_id = p_event and (c.round_id is null or c.round_id = en.round_id)
      and (c.rubric_id is null or c.rubric_id = en.rubric_id)
    left join adjusted a
      on a.submission_id = en.submission_id and a.round_id = en.round_id and a.criterion_id = c.id
    group by en.submission_id, en.round_id, c.id, c.weight
  ),
  totals as (
    select pc.submission_id, pc.round_id,
      round(100 * sum(coalesce(pc.normalised, 0) * pc.weight) / nullif(sum(pc.weight), 0), 2) as score,
      round(100 * sum(coalesce(pc.raw_normalised, 0) * pc.weight) / nullif(sum(pc.weight), 0), 2) as raw_score,
      count(pc.normalised) filter (where pc.normalised is not null) as criteria_scored,
      (select count(distinct v.judge_id) from valid v
        where v.submission_id = pc.submission_id and v.round_id = pc.round_id) as judges,
      (select count(distinct a.judge_id) from all_scores a
        where a.submission_id = pc.submission_id and a.round_id = pc.round_id and a.conflicted) as conflicted,
      null::jsonb as detail
    from per_criterion pc
    join entries en on en.submission_id = pc.submission_id and en.round_id = pc.round_id
    where en.method = 'rubric'
    group by pc.submission_id, pc.round_id
    union all
    select ri.submission_id, ri.round_id, ri.score, ri.score, 0::bigint, 0::bigint, 0::bigint, ri.detail
    from public.ranking_inputs ri
    join entries en on en.submission_id = ri.submission_id and en.round_id = ri.round_id
    where en.method <> 'rubric' and en.method = ri.provider
  ),
  ranked as (
    select t.*, en.ordinal as round_ordinal, en.round_name, en.method, rb.name as rubric,
      s.team_id, s.title, s.form_id, f.title as form_title, tm.name as team_name, tm.division_id,
      rank() over (partition by t.round_id order by t.score desc nulls last) as rank,
      rank() over (partition by t.round_id, tm.division_id order by t.score desc nulls last) as division_rank
    from totals t
    join entries en on en.submission_id = t.submission_id and en.round_id = t.round_id
    join public.submissions s on s.id = t.submission_id
    join public.submission_forms f on f.id = s.form_id
    join public.teams tm on tm.id = s.team_id
    left join public.rubrics rb on rb.id = en.rubric_id
  )
  select coalesce(jsonb_agg(to_jsonb(ranked) order by form_title, round_ordinal, rank), '[]') from ranked;
$$;

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
  if (select format from public.judging_rounds where id = p_round) = 'demos' then
    raise exception 'A live demo round takes its judges from its panels.' using errcode = 'P0001';
  end if;
  if (select format from public.judging_rounds where id = p_round) = 'offline' then
    raise exception 'An offline round has no judges in Bogey; enter its scores instead.' using errcode = 'P0001';
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
  -- demo and offline rounds hand out no judges this way
  join public.judging_rounds r on r.id = private.active_round(s.id) and r.format = 'online'
  where s.event_id = p_event and s.status = 'submitted'
    and (p_round is null or p_round = r.id);

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

create or replace function public.pin_judge(p_event uuid, p_judge uuid, p_team uuid)
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

  -- the team's projects already in online judging get the judge now, in the round each is in; a
  -- demo round seats the team with the judge's panel when it's scheduled
  with added as (
    insert into public.judge_assignments (event_id, judge_id, submission_id, round_id)
    select p_event, p_judge, s.id, private.active_round(s.id)
    from public.submissions s
    join public.submission_forms f on f.id = s.form_id and f.judged
    join public.judging_rounds r on r.id = private.active_round(s.id) and r.format = 'online'
    where s.event_id = p_event and s.team_id = p_team and s.status = 'submitted'
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


-- The entries a round judges now: submitted, in a judged form, and in that round.
create function private.round_submissions(p_round uuid)
returns table (submission_id uuid, team_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.team_id
  from public.judging_rounds r
  join public.submission_forms f on f.id = r.form_id and f.judged
  join public.submissions s on s.form_id = f.id and s.status = 'submitted'
  where r.id = p_round and private.active_round(s.id) = p_round;
$$;

-- A demo round's judges are its panels': each slotted entry gets every judge on its panel (but
-- not one with a conflict), and loses the judges who left the panel unless they've scored it.
create function private.sync_demo_assignments(p_round uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event uuid := (select event_id from public.judging_rounds where id = p_round);
  v_added integer;
begin
  delete from public.judge_assignments a
  using public.panel_slots sl
  where sl.round_id = p_round and a.submission_id = sl.submission_id and a.round_id = p_round
    and a.status = 'assigned'
    and not exists (
      select 1 from public.panel_judges pj where pj.panel_id = sl.panel_id and pj.judge_id = a.judge_id)
    and not exists (
      select 1 from public.scores sc
      where sc.judge_id = a.judge_id and sc.submission_id = a.submission_id and sc.round_id = p_round);

  with added as (
    insert into public.judge_assignments (event_id, judge_id, submission_id, round_id)
    select v_event, pj.judge_id, sl.submission_id, p_round
    from public.panel_slots sl
    join public.panel_judges pj on pj.panel_id = sl.panel_id
    join private.round_submissions(p_round) rs on rs.submission_id = sl.submission_id
    where sl.round_id = p_round
      and not exists (
        select 1 from public.judge_conflicts c where c.judge_id = pj.judge_id and c.team_id = rs.team_id)
    on conflict do nothing
    returning 1
  )
  select count(*) into v_added from added;
  return v_added;
end;
$$;

create function private.demo_round(p_round uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_round public.judging_rounds;
begin
  select * into v_round from public.judging_rounds where id = p_round;
  if v_round.id is null or not private.can_manage(v_round.event_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_round.format <> 'demos' then
    raise exception 'judge this round with live demos first' using errcode = '22023';
  end if;
  return v_round.event_id;
end;
$$;

-- Organizers' panels for a demo round, all at once: [{id?, name, location, startsAt, slotMinutes,
-- judges: [uuid]}]. Panels left out go, with their slots; judges follow the panel they're put on.
create function public.save_panels(p_round uuid, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event uuid := private.demo_round(p_round);
  v_item jsonb;
  v_id uuid;
  v_keep uuid[] := '{}';
  v_sort smallint := 0;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 50 then
    raise exception 'up to 50 panels' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if exists (
      select 1 from jsonb_array_elements_text(coalesce(v_item -> 'judges', '[]')) j
      where not exists (
        select 1 from public.event_members m
        where m.event_id = v_event and m.user_id = j::uuid and m.status = 'active'
          and (m.role = 'judge'
            or (m.role in ('staff', 'organizer') and private.tags_grant(v_event, m.user_id, 'judging.score'))))
    ) then
      raise exception 'only judges can sit on a panel' using errcode = '22023';
    end if;
    v_id := nullif(v_item ->> 'id', '')::uuid;
    if v_id is not null and exists (select 1 from public.judging_panels where id = v_id and round_id = p_round) then
      update public.judging_panels set
        name = btrim(v_item ->> 'name'),
        location = coalesce(btrim(v_item ->> 'location'), ''),
        starts_at = nullif(v_item ->> 'startsAt', '')::timestamptz,
        slot_minutes = coalesce((v_item ->> 'slotMinutes')::smallint, 8),
        sort = v_sort
      where id = v_id;
    else
      insert into public.judging_panels (event_id, round_id, name, location, starts_at, slot_minutes, sort)
      values (v_event, p_round, btrim(v_item ->> 'name'), coalesce(btrim(v_item ->> 'location'), ''),
        nullif(v_item ->> 'startsAt', '')::timestamptz, coalesce((v_item ->> 'slotMinutes')::smallint, 8), v_sort)
      returning id into v_id;
    end if;
    v_keep := v_keep || v_id;
    v_sort := v_sort + 1;
  end loop;

  delete from public.judging_panels where round_id = p_round and id <> all(v_keep);
  delete from public.panel_judges where round_id = p_round;
  insert into public.panel_judges (event_id, round_id, panel_id, judge_id)
  select distinct on (j::uuid) v_event, p_round, v_keep[e.ordinality], j::uuid
  from jsonb_array_elements(p_items) with ordinality e
  cross join lateral jsonb_array_elements_text(coalesce(e.value -> 'judges', '[]')) j
  order by j::uuid, e.ordinality;

  perform private.sync_demo_assignments(p_round);
  perform private.audit(v_event, 'judging.panels_saved', 'judging_round', p_round,
    jsonb_build_object('panels', cardinality(v_keep)));
  return cardinality(v_keep);
end;
$$;

-- Puts the round's entries into panel order. Without p_reset only the entries not yet on a panel
-- are placed, each at the end of the shortest panel that has no judge in conflict with its team
-- (a panel with a judge pinned to the team comes first); with it every entry is placed again.
create function public.schedule_demos(p_round uuid, p_reset boolean default false)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event uuid := private.demo_round(p_round);
  v_sub record;
  v_panel uuid;
  v_count integer := 0;
begin
  if not exists (select 1 from public.judging_panels where round_id = p_round) then
    raise exception 'add a panel first' using errcode = 'P0001';
  end if;
  if p_reset then
    delete from public.panel_slots where round_id = p_round;
  else
    -- entries that left the round (withdrawn, not advanced) give their slot up
    delete from public.panel_slots sl
    where sl.round_id = p_round
      and sl.submission_id not in (select rs.submission_id from private.round_submissions(p_round) rs);
  end if;

  for v_sub in
    select rs.submission_id, rs.team_id
    from private.round_submissions(p_round) rs
    join public.submissions s on s.id = rs.submission_id
    join public.teams t on t.id = rs.team_id
    where not exists (
      select 1 from public.panel_slots sl where sl.round_id = p_round and sl.submission_id = rs.submission_id)
    order by s.table_label nulls last, t.name, s.id
  loop
    select p.id into v_panel
    from public.judging_panels p
    where p.round_id = p_round
    order by
      exists (
        select 1 from public.panel_judges pj join public.judge_conflicts c on c.judge_id = pj.judge_id
        where pj.panel_id = p.id and c.team_id = v_sub.team_id),
      not exists (
        select 1 from public.panel_judges pj join public.judge_pins pn on pn.judge_id = pj.judge_id
        where pj.panel_id = p.id and pn.team_id = v_sub.team_id),
      (select count(*) from public.panel_slots sl where sl.panel_id = p.id),
      p.sort
    limit 1;
    insert into public.panel_slots (event_id, round_id, panel_id, submission_id, position)
    values (v_event, p_round, v_panel, v_sub.submission_id,
      coalesce((select max(position) + 1 from public.panel_slots where panel_id = v_panel), 0));
    v_count := v_count + 1;
  end loop;

  perform private.sync_demo_assignments(p_round);
  perform private.audit(v_event, 'judging.demos_scheduled', 'judging_round', p_round,
    jsonb_build_object('placed', v_count, 'reset', p_reset));
  return v_count;
end;
$$;

-- Moves one entry to a position on a panel (the end when p_position is null); the rest close up.
create function public.move_demo(p_round uuid, p_submission uuid, p_panel uuid, p_position integer default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event uuid := private.demo_round(p_round);
  v_from public.panel_slots;
  v_size integer;
  v_at integer;
begin
  if not exists (select 1 from public.judging_panels where id = p_panel and round_id = p_round) then
    raise exception 'unknown panel' using errcode = '22023';
  end if;
  if p_submission not in (select rs.submission_id from private.round_submissions(p_round) rs) then
    raise exception 'that entry is not in this round' using errcode = '22023';
  end if;
  delete from public.panel_slots where round_id = p_round and submission_id = p_submission
  returning * into v_from;
  if v_from.panel_id is not null then
    update public.panel_slots set position = position - 1
    where panel_id = v_from.panel_id and position > v_from.position;
  end if;
  select count(*) into v_size from public.panel_slots where panel_id = p_panel;
  v_at := least(greatest(coalesce(p_position, v_size), 0), v_size);
  update public.panel_slots set position = position + 1 where panel_id = p_panel and position >= v_at;
  insert into public.panel_slots (event_id, round_id, panel_id, submission_id, position)
  values (v_event, p_round, p_panel, p_submission, v_at);

  perform private.sync_demo_assignments(p_round);
  perform private.audit(v_event, 'judging.demo_moved', 'submission', p_submission,
    jsonb_build_object('panel', p_panel, 'position', v_at));
end;
$$;

-- Who's presenting: the panel's own judges move it along as teams finish, and organizers can too.
create function public.set_panel_now(p_panel uuid, p_position integer default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_panel public.judging_panels;
begin
  select * into v_panel from public.judging_panels where id = p_panel;
  if v_panel.id is null or not (
    private.can_manage(v_panel.event_id)
    or exists (select 1 from public.panel_judges where panel_id = p_panel and judge_id = (select auth.uid()))
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.judging_panels set now_position = case
    when p_position is null or p_position < 0 then null
    else least(p_position, coalesce((select max(position) + 1 from public.panel_slots where panel_id = p_panel), 0))
  end
  where id = p_panel;
end;
$$;

-- When and where the caller's team presents, for each demo round its entries are slotted in.
create function public.my_demo_slots(p_event uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'submissionId', sl.submission_id, 'title', s.title, 'roundName', r.name,
      'panelName', p.name, 'location', p.location, 'position', sl.position,
      'startsAt', p.starts_at + make_interval(mins => sl.position * p.slot_minutes),
      'ahead', case when p.now_position is null then null else greatest(sl.position - p.now_position, 0) end
    ) order by r.ordinal, sl.position), '[]')
  from public.panel_slots sl
  join public.submissions s on s.id = sl.submission_id
  join public.judging_panels p on p.id = sl.panel_id
  join public.judging_rounds r on r.id = sl.round_id and r.format = 'demos'
  where sl.event_id = p_event and private.is_team_member(s.team_id)
    and private.active_round(s.id) = sl.round_id;
$$;

-- Organizers' scores for an offline round, [{submission, score}]; a null score clears one. Higher
-- ranks first, like every other method.
create function public.save_offline_scores(p_round uuid, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.judging_rounds;
  v_item jsonb;
  v_count integer := 0;
begin
  select * into v_round from public.judging_rounds where id = p_round;
  if v_round.id is null or not private.can_manage(v_round.event_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_round.format <> 'offline' then
    raise exception 'this round is judged in Bogey; switch it to offline first' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 2000 then
    raise exception 'up to 2000 scores at a time' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if (v_item ->> 'submission')::uuid not in (select rs.submission_id from private.round_submissions(p_round) rs) then
      raise exception 'that entry is not in this round' using errcode = '22023';
    end if;
    if v_item -> 'score' is null or jsonb_typeof(v_item -> 'score') = 'null' then
      delete from public.ranking_inputs
      where round_id = p_round and submission_id = (v_item ->> 'submission')::uuid;
    else
      insert into public.ranking_inputs (event_id, round_id, submission_id, provider, score)
      values (v_round.event_id, p_round, (v_item ->> 'submission')::uuid, 'offline', (v_item ->> 'score')::numeric)
      on conflict (round_id, submission_id) do update set
        provider = excluded.provider, score = excluded.score, detail = '{}', updated_at = now();
    end if;
    v_count := v_count + 1;
  end loop;
  perform private.audit(v_round.event_id, 'judging.offline_scores', 'judging_round', p_round,
    jsonb_build_object('round', v_round.name, 'count', v_count));
  return v_count;
end;
$$;


alter table public.judging_panels enable row level security;
alter table public.panel_judges enable row level security;
alter table public.panel_slots enable row level security;

-- the run of show is for organizers and judges; teams read their own slot through my_demo_slots
create policy judging_panels_select on public.judging_panels for select to authenticated
  using ((select private.can_manage(event_id)) or (select private.has_permission(event_id, 'judging.score')));
create policy panel_judges_select on public.panel_judges for select to authenticated
  using ((select private.can_manage(event_id)) or (select private.has_permission(event_id, 'judging.score')));
create policy panel_slots_select on public.panel_slots for select to authenticated
  using ((select private.can_manage(event_id)) or (select private.has_permission(event_id, 'judging.score')));

alter publication supabase_realtime add table public.judging_panels;

grant execute on function
  public.save_panels(uuid, jsonb),
  public.schedule_demos(uuid, boolean),
  public.move_demo(uuid, uuid, uuid, integer),
  public.set_panel_now(uuid, integer),
  public.my_demo_slots(uuid),
  public.save_offline_scores(uuid, jsonb)
to authenticated;
