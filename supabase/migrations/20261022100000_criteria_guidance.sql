-- criteria_guidance: score-band guidance on criteria (criteria.guidance), and rubrics assigned to
-- divisions (rubric_divisions). A project with no rubric pick is judged on its division's only rubric.

-- criteria.guidance: [{min, max, body}], whole-number bands inside the criterion's range
create function private.guidance_ok(p_guidance jsonb, p_min smallint, p_max smallint)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p_guidance) = 'array' then
    jsonb_array_length(p_guidance) <= 20 and not exists (
      select 1 from jsonb_array_elements(p_guidance) g
      where case
        when jsonb_typeof(g) = 'object' and jsonb_typeof(g -> 'min') = 'number'
          and jsonb_typeof(g -> 'max') = 'number' and jsonb_typeof(g -> 'body') = 'string' then
          (g ->> 'min')::numeric <> trunc((g ->> 'min')::numeric)
          or (g ->> 'max')::numeric <> trunc((g ->> 'max')::numeric)
          or (g ->> 'min')::numeric < p_min or (g ->> 'max')::numeric > p_max
          or (g ->> 'min')::numeric > (g ->> 'max')::numeric
          or length(g ->> 'body') > 2000
        else true
      end)
  else false end;
$$;
-- criteria writes check it as the caller
grant execute on function private.guidance_ok(jsonb, smallint, smallint) to authenticated, service_role;

alter table public.criteria add column guidance jsonb not null default '[]';
alter table public.criteria add constraint criteria_check1
  check (private.guidance_ok(guidance, min_score, max_score));

-- rubrics meant for a division's projects; a rubric with no divisions is open to every project
create table public.rubric_divisions (
  event_id uuid not null,
  rubric_id uuid not null,
  division_id uuid not null,
  primary key (rubric_id, division_id),
  foreign key (event_id, rubric_id) references public.rubrics (event_id, id) on delete cascade,
  foreign key (event_id, division_id) references public.divisions (event_id, id) on delete cascade
);
create index rubric_divisions_event_id_rubric_id_fk_idx on public.rubric_divisions (event_id, rubric_id);
create index rubric_divisions_event_id_division_id_fk_idx on public.rubric_divisions (event_id, division_id);

alter table public.rubric_divisions enable row level security;

create policy rubric_divisions_select on public.rubric_divisions for select to anon, authenticated
  using ((select private.can_view_event(event_id)));

-- a division's rubric when it has exactly one
create function private.division_rubric(p_division uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select (array_agg(rubric_id))[1] from public.rubric_divisions
  where division_id = p_division
  having count(*) = 1;
$$;

-- the rubrics a project may be judged on: those without divisions, plus its division's
create function private.allowed_rubrics(p_event uuid, p_division uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(r.id order by r.sort), '{}') from public.rubrics r
  where r.event_id = p_event
    and (not exists (select 1 from public.rubric_divisions rd where rd.rubric_id = r.id)
      or exists (select 1 from public.rubric_divisions rd where rd.rubric_id = r.id and rd.division_id = p_division));
$$;

-- the rubric a project is judged on: its pick, else its division's only rubric
create function private.submission_rubric(p_submission uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select x.rubric_id from public.submission_rubrics x where x.submission_id = p_submission),
    (select private.division_rubric(t.division_id)
     from public.submissions s join public.teams t on t.id = s.team_id
     where s.id = p_submission));
$$;

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
      case when r.format = 'offline' then 'offline' else r.method end as method,
      private.submission_rubric(s.id) as rubric_id
    from public.judging_rounds r
    join public.submission_forms f on f.id = r.form_id and f.judged
    join public.submissions s on s.form_id = f.id and s.status = 'submitted'
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

create or replace function public.team_scores(p_submission uuid)
returns table (
  round_name text, round_ordinal smallint, label text, min_score smallint, max_score smallint,
  average numeric, judges bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sub public.submissions;
begin
  select * into v_sub from public.submissions where id = p_submission;
  if v_sub.id is null
     or not (private.can_manage(v_sub.event_id) or private.is_team_member(v_sub.team_id)) then
    return;
  end if;
  if not private.can_manage(v_sub.event_id) and not (
    (private.event_setting(v_sub.event_id, 'judging') ->> 'shareWithTeams') = 'scores'
    and private.window_open(v_sub.event_id, 'results')
    and private.latest_publication(v_sub.event_id) is not null
  ) then
    return;
  end if;
  return query
  select r.name, r.ordinal, c.label, c.min_score, c.max_score, round(avg(sc.value), 2), count(distinct sc.judge_id)
  from public.scores sc
  join public.criteria c on c.id = sc.criterion_id
  join public.judging_rounds r on r.id = sc.round_id
  where sc.submission_id = p_submission
    and (c.rubric_id is null or c.rubric_id = private.submission_rubric(p_submission))
    and not exists (select 1 from public.judge_conflicts jc where jc.judge_id = sc.judge_id and jc.team_id = v_sub.team_id)
  group by r.name, r.ordinal, c.label, c.min_score, c.max_score, c.sort
  order by r.ordinal, c.sort;
end;
$$;

-- flags a project once when its judges' totals are further apart than judging.flagGap points of 100
create or replace function private.check_score_gap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_judging jsonb := private.event_setting(new.event_id, 'judging');
  v_limit numeric := coalesce((v_judging ->> 'flagGap')::numeric, 0);
  v_team uuid;
  v_gap numeric;
begin
  if v_limit <= 0 or coalesce(v_judging ->> 'deliberation', 'assigned') = 'off'
    or exists (
      select 1 from public.judging_flags f
      where f.submission_id = new.submission_id and (f.resolved_at is null or f.gap is not null)) then
    return null;
  end if;
  select team_id into v_team from public.submissions where id = new.submission_id;
  with applicable as (
    select c.id, c.min_score, c.max_score, c.weight from public.criteria c
    where c.event_id = new.event_id
      and (c.round_id is null or c.round_id = new.round_id)
      and (c.rubric_id is null or c.rubric_id = private.submission_rubric(new.submission_id))
  ),
  totals as (
    select sc.judge_id, count(*) as scored,
      100 * sum((sc.value - a.min_score) / (a.max_score - a.min_score) * a.weight) / sum(a.weight) as total
    from public.scores sc
    join applicable a on a.id = sc.criterion_id
    where sc.submission_id = new.submission_id and sc.round_id = new.round_id
      and not exists (select 1 from public.judge_conflicts jc where jc.judge_id = sc.judge_id and jc.team_id = v_team)
    group by sc.judge_id
  )
  select max(total) - min(total) into v_gap
  from totals where scored = (select count(*) from applicable)
  having count(*) >= 2;
  if v_gap > v_limit then
    insert into public.judging_flags (event_id, submission_id, round_id, gap)
    values (new.event_id, new.submission_id, new.round_id, round(v_gap, 2))
    on conflict (submission_id) where resolved_at is null do nothing;
  end if;
  return null;
end;
$$;

create or replace function public.set_submission_rubric(p_submission uuid, p_rubric uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.submissions;
  v_judging jsonb;
begin
  select * into v_sub from public.submissions where id = p_submission;
  if v_sub.id is null then
    raise exception 'that project isn''t available' using errcode = '42501';
  end if;
  v_judging := private.event_setting(v_sub.event_id, 'judging');
  if not (
    private.can_manage(v_sub.event_id)
    or (
      coalesce((v_judging ->> 'judgeRubric')::boolean, true)
      and private.has_permission(v_sub.event_id, 'judging.score')
      and not private.has_conflict((select auth.uid()), p_submission)
      and private.round_window_open(private.active_round(p_submission))
    )
    or (
      coalesce((v_judging ->> 'teamRubric')::boolean, false)
      and private.is_team_member(v_sub.team_id)
      and private.team_write_allowed(v_sub.form_id)
    )
  ) then
    raise exception 'you can''t pick this project''s rubric' using errcode = '42501';
  end if;
  if p_rubric is null then
    delete from public.submission_rubrics where submission_id = p_submission;
  else
    if not exists (select 1 from public.rubrics where id = p_rubric and event_id = v_sub.event_id) then
      raise exception 'that rubric isn''t in this event' using errcode = '22023';
    end if;
    if not p_rubric = any (private.allowed_rubrics(v_sub.event_id,
        (select t.division_id from public.teams t where t.id = v_sub.team_id))) then
      raise exception 'that rubric is for other divisions' using errcode = '22023';
    end if;
    insert into public.submission_rubrics (event_id, submission_id, rubric_id, set_by)
    values (v_sub.event_id, p_submission, p_rubric, (select auth.uid()))
    on conflict (submission_id) do update
      set rubric_id = excluded.rubric_id, set_by = excluded.set_by, updated_at = now();
  end if;
  perform private.audit(v_sub.event_id, 'judging.rubric_set', 'submission', p_submission,
    jsonb_build_object('rubric', p_rubric));
end;
$$;

create or replace function public.save_criteria(p_event uuid, p_items jsonb, p_rubrics jsonb default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removed integer;
begin
  if not private.can_manage(p_event) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_rubrics is not null then
    delete from public.rubrics
    where event_id = p_event
      and id not in (
        select (item ->> 'id')::uuid from jsonb_array_elements(p_rubrics) item where item ->> 'id' is not null
      );
    update public.rubrics set name = id::text where event_id = p_event;
    insert into public.rubrics (id, event_id, name, description_md, sort)
    select coalesce((item ->> 'id')::uuid, gen_random_uuid()), p_event, trim(item ->> 'name'),
      coalesce(item ->> 'description_md', ''), (ordinality - 1)::smallint
    from jsonb_array_elements(p_rubrics) with ordinality as t(item, ordinality)
    on conflict (id) do update set
      name = excluded.name, description_md = excluded.description_md, sort = excluded.sort;
    -- a rubric item with division_ids replaces its divisions
    delete from public.rubric_divisions
    where event_id = p_event and rubric_id in (
      select (item ->> 'id')::uuid from jsonb_array_elements(p_rubrics) item
      where jsonb_typeof(item -> 'division_ids') = 'array');
    insert into public.rubric_divisions (event_id, rubric_id, division_id)
    select p_event, (item ->> 'id')::uuid, (division #>> '{}')::uuid
    from jsonb_array_elements(p_rubrics) item,
      jsonb_array_elements(case when jsonb_typeof(item -> 'division_ids') = 'array'
        then item -> 'division_ids' else '[]' end) division
    where item ->> 'id' is not null
    on conflict do nothing;
  end if;

  delete from public.criteria
  where event_id = p_event
    and id not in (
      select (item ->> 'id')::uuid from jsonb_array_elements(p_items) item where item ->> 'id' is not null
    );
  get diagnostics v_removed = row_count;

  update public.criteria set label = id::text where event_id = p_event;
  insert into public.criteria (
    id, event_id, label, description_md, min_score, max_score, weight, sort, round_id, rubric_id, guidance)
  select coalesce((item ->> 'id')::uuid, gen_random_uuid()), p_event, item ->> 'label',
    coalesce(item ->> 'description_md', ''), coalesce((item ->> 'min_score')::smallint, 0),
    (item ->> 'max_score')::smallint,
    (item ->> 'weight')::numeric, (ordinality - 1)::smallint, nullif(item ->> 'round_id', '')::uuid,
    nullif(item ->> 'rubric_id', '')::uuid, coalesce(item -> 'guidance', '[]')
  from jsonb_array_elements(p_items) with ordinality as t(item, ordinality)
  on conflict (id) do update set
    label = excluded.label, description_md = excluded.description_md,
    min_score = excluded.min_score, max_score = excluded.max_score, weight = excluded.weight, sort = excluded.sort,
    round_id = excluded.round_id, rubric_id = excluded.rubric_id, guidance = excluded.guidance;

  perform private.audit(p_event, 'judging.criteria_saved', 'event', p_event,
    jsonb_build_object('count', jsonb_array_length(p_items), 'removed', v_removed,
      'rubrics', case when p_rubrics is null then null else jsonb_array_length(p_rubrics) end));
  return v_removed;
end;
$$;

create or replace function public.clone_event(
  p_source uuid, p_slug text, p_name text, p_starts_at timestamptz default null,
  p_include text[] default array['details', 'windows', 'divisions', 'tracks', 'forms', 'judging',
    'agenda', 'pages', 'homepage', 'settings', 'onboarding', 'invites'],
  p_template boolean default false, p_ends_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_src public.events;
  v_new public.events;
  v_shift interval;
  v_all constant text[] := array['details', 'windows', 'divisions', 'tracks', 'forms', 'judging',
    'agenda', 'pages', 'homepage', 'settings', 'onboarding', 'invites'];
  v_has boolean;
  r record;
  v_id uuid;
  v_forms jsonb := '{}';
  v_rounds jsonb := '{}';
  v_rubrics jsonb := '{}';
  v_divisions jsonb := '{}';
  v_slots jsonb := '{}';
  v_categories jsonb := '{}';
  v_sessions jsonb := '{}';
  v_reenter text[];
begin
  select * into v_src from public.events where id = p_source;
  if not found or not private.is_org_admin(v_src.org_id) then
    raise exception 'only org admins can copy events' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(p_include) i where i <> all (v_all)) then
    raise exception 'unknown section' using errcode = '22023';
  end if;
  if 'judging' = any (p_include) and not 'forms' = any (p_include) then
    raise exception 'judging is copied together with forms' using errcode = '22023';
  end if;
  v_shift := case
    when p_template or p_starts_at is null or v_src.starts_at is null then interval '0'
    else p_starts_at - v_src.starts_at
  end;
  if not p_template and p_ends_at is not null
    and p_ends_at <= v_src.starts_at + v_shift then
    raise exception 'the end has to be after the start' using errcode = '22023';
  end if;

  insert into public.events (org_id, slug, name, kind, timezone, starts_at, ends_at, short_name,
    location, website_url, team_size_min, team_size_max, is_template, created_by)
  select v_src.org_id, lower(p_slug), trim(p_name), v_src.kind, v_src.timezone,
    v_src.starts_at + v_shift,
    case when p_ends_at is not null and not p_template then p_ends_at else v_src.ends_at + v_shift end,
    case when 'details' = any (p_include) then v_src.short_name end,
    case when 'details' = any (p_include) then v_src.location end,
    case when 'details' = any (p_include) then v_src.website_url end,
    case when 'details' = any (p_include) then v_src.team_size_min else 1 end,
    case when 'details' = any (p_include) then v_src.team_size_max else 4 end,
    p_template, (select auth.uid())
  returning * into v_new;

  if 'windows' = any (p_include) then
    insert into public.event_windows (event_id, key, opens_at, closes_at, reminder_minutes, updated_by)
    select v_new.id, key, opens_at + v_shift, closes_at + v_shift, reminder_minutes, (select auth.uid())
    from public.event_windows where event_id = p_source;
  end if;

  if 'divisions' = any (p_include) then
    for r in select * from public.divisions where event_id = p_source order by sort, name loop
      insert into public.divisions (event_id, name, description, sort, selectable, switchable)
      values (v_new.id, r.name, r.description, r.sort, r.selectable, r.switchable)
      returning id into v_id;
      v_divisions := v_divisions || jsonb_build_object(r.id::text, v_id);
    end loop;
  end if;

  if 'forms' = any (p_include) then
    for r in select * from public.submission_forms where event_id = p_source order by sort, key loop
      insert into public.submission_forms (event_id, key, title, description_md, window_key, judged, sort)
      values (v_new.id, r.key, r.title, r.description_md, r.window_key, r.judged, r.sort)
      returning id into v_id;
      v_forms := v_forms || jsonb_build_object(r.id::text, v_id);
      insert into public.submission_items (event_id, form_id, key, label, help, kind, required, options, config, sort)
      select v_new.id, v_id, key, label, help, kind, required, options, config, sort
      from public.submission_items where form_id = r.id;
    end loop;
  end if;

  if 'tracks' = any (p_include) then
    insert into public.tracks (event_id, name, description_md, prize_md, sponsor_name, sponsor_logo_url,
      max_winners, opt_in, form_id, sort)
    select v_new.id, name, description_md, prize_md, sponsor_name, sponsor_logo_url, max_winners, opt_in,
      (v_forms ->> form_id::text)::uuid, sort
    from public.tracks where event_id = p_source;
  end if;

  if 'judging' = any (p_include) then
    for r in select * from public.judging_rounds where event_id = p_source order by form_id, ordinal loop
      insert into public.judging_rounds (event_id, form_id, ordinal, name, window_key)
      values (v_new.id, (v_forms ->> r.form_id::text)::uuid, r.ordinal, r.name, r.window_key)
      on conflict (form_id, ordinal) do update set name = excluded.name, window_key = excluded.window_key
      returning id into v_id;
      v_rounds := v_rounds || jsonb_build_object(r.id::text, v_id);
    end loop;
    for r in select * from public.rubrics where event_id = p_source loop
      insert into public.rubrics (event_id, name, description_md, sort)
      values (v_new.id, r.name, r.description_md, r.sort) returning id into v_id;
      v_rubrics := v_rubrics || jsonb_build_object(r.id::text, v_id);
    end loop;
    insert into public.criteria (
      event_id, label, description_md, min_score, max_score, weight, sort, round_id, rubric_id, guidance)
    select v_new.id, label, description_md, min_score, max_score, weight, sort,
      (v_rounds ->> round_id::text)::uuid, (v_rubrics ->> rubric_id::text)::uuid, guidance
    from public.criteria where event_id = p_source;
    insert into public.rubric_divisions (event_id, rubric_id, division_id)
    select v_new.id, (v_rubrics ->> rd.rubric_id::text)::uuid, (v_divisions ->> rd.division_id::text)::uuid
    from public.rubric_divisions rd
    where rd.event_id = p_source and v_divisions ? rd.division_id::text;
  end if;

  if 'agenda' = any (p_include) then
    for r in select * from public.session_categories where event_id = p_source loop
      insert into public.session_categories (event_id, kind, label, sort)
      values (v_new.id, r.kind, r.label, r.sort) returning id into v_id;
      v_categories := v_categories || jsonb_build_object(r.id::text, v_id);
    end loop;
    for r in select * from public.session_slots where event_id = p_source loop
      insert into public.session_slots (event_id, name, kind, starts_at, ends_at)
      values (v_new.id, r.name, r.kind, r.starts_at + v_shift, r.ends_at + v_shift)
      returning id into v_id;
      v_slots := v_slots || jsonb_build_object(r.id::text, v_id);
    end loop;
    for r in select * from public.event_sessions where event_id = p_source loop
      insert into public.event_sessions (event_id, slot_id, category_id, kind, name, description_md,
        page_md, location, starts_at, ends_at, host_note, capacity, required, takes_attendance, visibility, sort)
      values (v_new.id, (v_slots ->> r.slot_id::text)::uuid, (v_categories ->> r.category_id::text)::uuid,
        r.kind, r.name, r.description_md, r.page_md, r.location, r.starts_at + v_shift, r.ends_at + v_shift,
        r.host_note, r.capacity, r.required, r.takes_attendance, r.visibility, r.sort)
      returning id into v_id;
      v_sessions := v_sessions || jsonb_build_object(r.id::text, v_id);
    end loop;
    if not p_template then
      for r in
        select distinct h.user_id from public.session_hosts h
        join public.org_members om on om.org_id = v_src.org_id and om.user_id = h.user_id
        where h.event_id = p_source
      loop
        insert into public.event_members (event_id, user_id, role, added_by)
        values (v_new.id, r.user_id, 'staff', (select auth.uid()))
        on conflict do nothing;
      end loop;
      insert into public.session_hosts (event_id, session_id, user_id)
      select v_new.id, (v_sessions ->> h.session_id::text)::uuid, h.user_id
      from public.session_hosts h
      where h.event_id = p_source
        and exists (select 1 from public.event_members m where m.event_id = v_new.id and m.user_id = h.user_id);
    end if;
  end if;

  if 'pages' = any (p_include) then
    insert into public.event_pages (event_id, slug, title, body_md, window_key, audience, sort)
    select v_new.id, slug, title, body_md, window_key, audience, sort
    from public.event_pages where event_id = p_source;
  end if;

  insert into public.settings (scope, event_id, namespace, value, locked_keys, updated_by)
  select 'event', v_new.id, namespace, value, locked_keys, (select auth.uid())
  from public.settings
  where scope = 'event' and event_id = p_source
    and case namespace
      when 'home' then 'homepage' = any (p_include)
      when 'about' then 'details' = any (p_include)
      else 'settings' = any (p_include)
    end;

  if 'onboarding' = any (p_include) then
    insert into public.onboarding_forms (event_id, fields)
    select v_new.id, fields from public.onboarding_forms where event_id = p_source;
  end if;

  if 'invites' = any (p_include) then
    insert into public.invite_links (event_id, label, auto_approve, capacity, division_id, opens_at,
      closes_at, disabled_at, created_by)
    select v_new.id, label, auto_approve, capacity, (v_divisions ->> division_id::text)::uuid,
      opens_at + v_shift, closes_at + v_shift, now(), (select auth.uid())
    from public.invite_links where event_id = p_source;
  end if;

  select coalesce(array_agg(name order by name), '{}') into v_reenter
  from public.secrets where scope = 'event' and event_id = p_source;

  perform private.audit(v_new.id, 'event.cloned', 'event', v_new.id,
    jsonb_build_object('from', p_source, 'template', p_template, 'sections', to_jsonb(p_include)));
  return jsonb_build_object('id', v_new.id, 'slug', v_new.slug, 'reenter', to_jsonb(v_reenter));
end;
$$;

-- a project's rubric pick, the division rubric it falls back to, and the rubrics it may pick
create function public.project_rubric(p_submission uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sub public.submissions;
  v_division uuid;
begin
  select * into v_sub from public.submissions where id = p_submission;
  if v_sub.id is null or not (
    private.can_manage(v_sub.event_id)
    or private.has_permission(v_sub.event_id, 'judging.score')
    or private.is_team_member(v_sub.team_id)
  ) then
    return null;
  end if;
  select division_id into v_division from public.teams where id = v_sub.team_id;
  return jsonb_build_object(
    'picked', (select rubric_id from public.submission_rubrics where submission_id = p_submission),
    'fallback', private.division_rubric(v_division),
    'allowed', to_jsonb(private.allowed_rubrics(v_sub.event_id, v_division)));
end;
$$;

-- replaces the rubrics of each listed division; p_items is [{division_id, rubric_ids}]
create function public.set_division_rubrics(p_event uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can_manage(p_event) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from public.rubric_divisions
  where event_id = p_event
    and division_id in (select (item ->> 'division_id')::uuid from jsonb_array_elements(p_items) item);
  insert into public.rubric_divisions (event_id, rubric_id, division_id)
  select p_event, (rubric #>> '{}')::uuid, (item ->> 'division_id')::uuid
  from jsonb_array_elements(p_items) item,
    jsonb_array_elements(coalesce(item -> 'rubric_ids', '[]')) rubric
  on conflict do nothing;
  perform private.audit(p_event, 'judging.rubric_divisions_saved', 'event', p_event,
    jsonb_build_object('divisions', jsonb_array_length(p_items)));
end;
$$;

grant execute on function public.project_rubric(uuid), public.set_division_rubrics(uuid, jsonb)
to authenticated;
