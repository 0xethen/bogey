-- golf scored by total length (the new default) or by per-problem length ranges; judged errors can be hidden;
-- limit errors say problem(s) and test(s)

alter table public.challenges_problems add column if not exists golf_brackets jsonb not null default '[]';
alter table public.challenges_problems drop constraint if exists challenges_problems_golf_brackets_check;
alter table public.challenges_problems add constraint challenges_problems_golf_brackets_check check (
  jsonb_typeof(golf_brackets) = 'array' and jsonb_array_length(golf_brackets) <= 20
);
-- problems are readable column by column (the checker source isn't), so the new column needs its own grant
grant select (golf_brackets) on public.challenges_problems to authenticated;

create or replace function private.challenges_settings(p_event uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'scoring', 'icpc', 'penaltyMinutes', 20, 'freezeMinutes', 60, 'revealed', false,
    'languages', '', 'attemptLimit', 0, 'countCompileErrors', false, 'resultDetail', 'tests',
    'idKind', 'letter', 'problemOrder', 'id', 'separateErrors', false,
    'golfMeasure', 'characters', 'golfPoints', 'length', 'golfRankStep', 10, 'showErrors', true,
    'verificationRequired', false
  ) || coalesce(private.event_setting(p_event, 'plugin.challenges'), '{}');
$$;

create or replace function public.challenges_attempt_tests(p_solution uuid)
returns table (
  ordinal integer, is_sample boolean, verdict public.challenges_verdict, time_ms integer,
  memory_kb integer, input text, answer text, output text, stderr text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_solution public.challenges_solutions;
  v_jury boolean;
  v_judging uuid;
  v_errors boolean;
begin
  select * into v_solution from public.challenges_solutions where id = p_solution;
  if v_solution.id is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_jury := private.challenges_is_jury(v_solution.event_id);
  v_errors := v_jury
    or coalesce((private.challenges_settings(v_solution.event_id) ->> 'showErrors')::boolean, true);
  if not v_jury then
    if not private.plugin_enabled(v_solution.event_id, 'challenges')
       or not private.is_team_member(v_solution.team_id) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    if private.challenges_settings(v_solution.event_id) ->> 'resultDetail' <> 'tests' then
      return;
    end if;
  end if;

  select j.id into v_judging from public.challenges_judgings j
  where j.solution_id = p_solution and j.valid and j.status = 'done'
  order by j.finished_at desc nulls last
  limit 1;
  if v_judging is null then
    return;
  end if;
  if not v_jury and private.challenges_verification_required(v_solution.event_id) and not exists (
    select 1 from public.challenges_judgings where id = v_judging and verified_at is not null
  ) then
    return;
  end if;

  return query
    select t.ordinal, t.is_sample, r.verdict, r.time_ms, r.memory_kb,
      case when v_jury or t.is_sample then left(t.input, 4000) end,
      case when v_jury or t.is_sample then left(t.answer, 4000) end,
      case when v_jury or t.is_sample then r.output_excerpt end,
      case when v_jury or t.is_sample then
        case when v_errors or coalesce(r.stderr_excerpt, '') = '' then r.stderr_excerpt
          else 'There was an error. This contest doesn''t show error messages.' end
      end
    from public.challenges_judging_runs r
    join public.challenges_testcases t on t.id = r.testcase_id
    where r.judging_id = v_judging
    order by t.is_sample desc, t.ordinal;
end;
$$;

create or replace function public.challenges_scoreboard(p_event uuid, p_jury boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings jsonb := private.challenges_settings(p_event);
  v_verify boolean := coalesce((v_settings ->> 'verificationRequired')::boolean, false);
  v_scoring text := v_settings ->> 'scoring';
  v_penalty integer := (v_settings ->> 'penaltyMinutes')::integer;
  v_count_ce boolean := (v_settings ->> 'countCompileErrors')::boolean;
  v_freeze_minutes integer := (v_settings ->> 'freezeMinutes')::integer;
  v_custom_order boolean := v_settings ->> 'problemOrder' = 'custom';
  v_measure text := v_settings ->> 'golfMeasure';
  v_golf_points text := v_settings ->> 'golfPoints';
  v_golf_step numeric := (v_settings ->> 'golfRankStep')::numeric;
  v_freeze timestamptz;
  v_frozen boolean;
  v_start timestamptz;
begin
  if p_jury then
    if not private.challenges_is_jury(p_event) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
  elsif not (
    private.challenges_is_jury(p_event)
    or (
      private.plugin_enabled(p_event, 'challenges')
      and private.window_open(p_event, 'challenges.scoreboard')
      and (private.is_public_event(p_event) or private.has_permission(p_event, 'event.view'))
    )
  ) then
    raise exception 'the scoreboard is not public yet' using errcode = '42501';
  end if;

  select coalesce(w.opens_at, e.starts_at, now()),
    case when v_freeze_minutes > 0 then w.closes_at - make_interval(mins => v_freeze_minutes) end
  into v_start, v_freeze
  from public.events e
  left join public.event_windows w on w.event_id = e.id and w.key = 'challenges.contest'
  where e.id = p_event;
  v_frozen := not p_jury and v_freeze is not null and now() >= v_freeze
    and not (v_settings ->> 'revealed')::boolean;

  return (
    with problems as (
      select id, label, label_key, title, points, sort, golf_brackets from public.challenges_problems
      where event_id = p_event and visible
    ),
    attempts as (
      select s.team_id, s.problem_id, s.submitted_at,
        case v_measure
          when 'bytes' then s.source_bytes
          when 'characters-no-space' then s.source_chars_no_space
          else s.source_chars
        end as length,
        case when (v_frozen and s.submitted_at >= v_freeze) or (v_verify and not p_jury and j.verified_at is null)
          then null else j.verdict end as verdict,
        case when (v_frozen and s.submitted_at >= v_freeze) or (v_verify and not p_jury and j.verified_at is null)
          then null else j.score end as score
      from public.challenges_solutions s
      join problems p on p.id = s.problem_id
      left join lateral (
        select verdict, score, verified_at from public.challenges_judgings j
        where j.solution_id = s.id and j.valid and j.status in ('done', 'failed')
        order by j.finished_at desc limit 1
      ) j on true
      where s.event_id = p_event and s.team_id is not null and s.ignored_at is null
    ),
    first_ac as (
      select team_id, problem_id, min(submitted_at) as at
      from attempts where verdict = 'AC' group by team_id, problem_id
    ),
    cells as (
      select a.team_id, a.problem_id,
        f.at as solved_at,
        count(*) filter (
          where (f.at is null or a.submitted_at < f.at)
            and a.verdict is not null and a.verdict <> 'JE'
            and (v_count_ce or a.verdict <> 'CE')
            and a.verdict <> 'AC'
        ) as wrong,
        count(*) filter (where a.verdict is null and (f.at is null or a.submitted_at < f.at)) as pending,
        count(*) as total,
        max(a.score) as best_score,
        min(a.length) filter (where a.verdict = 'AC') as best_length
      from attempts a
      left join first_ac f on f.team_id = a.team_id and f.problem_id = a.problem_id
      group by a.team_id, a.problem_id, f.at
    ),
    first_solvers as (
      select distinct on (problem_id) problem_id, team_id
      from first_ac order by problem_id, at
    ),
    golf as (
      select c.team_id, c.problem_id, c.best_length,
        dense_rank() over (partition by c.problem_id order by c.best_length) as place,
        min(c.best_length) over (partition by c.problem_id) as shortest
      from cells c
      where v_scoring = 'golf' and c.best_length is not null
    ),
    golf_points as (
      select g.team_id, g.problem_id, g.best_length, g.place,
        case v_golf_points
          when 'rank' then greatest(0, p.points - v_golf_step * (g.place - 1))
          when 'length' then null
          when 'brackets' then coalesce((
            select (b ->> 'points')::numeric from jsonb_array_elements(p.golf_brackets) b
            where g.best_length <= (b ->> 'max')::integer
            order by (b ->> 'max')::integer limit 1), 0)
          else round(p.points * g.shortest::numeric / nullif(g.best_length, 0), 2)
        end as points
      from golf g join problems p on p.id = g.problem_id
    ),
    team_rows as (
      select t.id as team_id, t.name as team_name, t.division_id,
        count(c.solved_at) as solved,
        coalesce(sum(
          floor(extract(epoch from c.solved_at - v_start) / 60) + v_penalty * c.wrong
        ) filter (where c.solved_at is not null), 0)::integer as penalty,
        case when v_scoring = 'golf'
          then coalesce((select sum(gp.points) from golf_points gp where gp.team_id = t.id), 0)
          else coalesce(sum(c.best_score), 0)
        end as score,
        coalesce(sum(c.best_length) filter (where c.solved_at is not null), 0)::integer as total_length,
        max(c.solved_at) as last_solve,
        coalesce(jsonb_agg(jsonb_build_object(
          'problem_id', c.problem_id,
          'solved', c.solved_at is not null,
          'minutes', floor(extract(epoch from c.solved_at - v_start) / 60),
          'attempts', c.wrong + (c.solved_at is not null)::integer,
          'pending', c.pending,
          'score', case when v_scoring = 'golf' then gp.points else c.best_score end,
          'length', c.best_length,
          'place', gp.place,
          'first', exists (select 1 from first_solvers fs where fs.problem_id = c.problem_id and fs.team_id = t.id)
        )) filter (where c.problem_id is not null), '[]') as cells
      from public.teams t
      left join cells c on c.team_id = t.id
      left join golf_points gp on gp.team_id = c.team_id and gp.problem_id = c.problem_id
      where t.event_id = p_event
        and exists (select 1 from public.team_members tm where tm.team_id = t.id)
      group by t.id
    )
    select jsonb_build_object(
      'scoring', v_scoring,
      'frozen', v_frozen,
      'freezeAt', v_freeze,
      'startedAt', v_start,
      'measure', v_measure,
      'golfPoints', v_golf_points,
      'problems', (
        select coalesce(jsonb_agg(
          jsonb_build_object('id', id, 'label', label, 'title', title, 'points', points)
          order by case when v_custom_order then sort end, label_key, label
        ), '[]') from problems
      ),
      'rows', coalesce(jsonb_agg(
        to_jsonb(r) - 'last_solve' || jsonb_build_object('rank', r.rank)
        order by r.rank, r.team_name
      ), '[]')
    )
    from (
      select team_rows.*,
        case v_scoring
          when 'ioi' then rank() over (order by score desc)
          when 'golf' then case when v_golf_points = 'length'
            then rank() over (order by solved desc, total_length asc)
            else rank() over (order by score desc, (solved = 0), total_length asc) end
          else rank() over (order by solved desc, penalty asc)
        end as rank
      from team_rows
    ) r
  );
end;
$$;

create or replace function private.challenges_enforce_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_limit bigint;
begin
  if (select auth.role()) = 'service_role' or private.is_platform_admin() then
    return new;
  end if;
  v_org := private.event_org(new.event_id);

  if tg_table_name = 'challenges_problems' then
    if tg_op = 'INSERT' then
      v_limit := private.org_limit(v_org, 'challenges.maxProblemsPerEvent');
      if v_limit is not null and (
        select count(*) from public.challenges_problems where event_id = new.event_id
      ) >= v_limit then
        raise exception 'this organization can have at most % problem(s) in an event', v_limit
          using errcode = '23514';
      end if;
    end if;
    v_limit := private.org_limit(v_org, 'challenges.maxTimeLimitMs');
    if v_limit is not null and new.time_limit_ms > v_limit then
      raise exception 'time limits can be at most % ms for this organization', v_limit using errcode = '23514';
    end if;
    v_limit := private.org_limit(v_org, 'challenges.maxMemoryMb');
    if v_limit is not null and new.memory_limit_mb > v_limit then
      raise exception 'memory limits can be at most % MB for this organization', v_limit using errcode = '23514';
    end if;
    v_limit := private.org_limit(v_org, 'challenges.maxOutputKb');
    if v_limit is not null and new.output_limit_kb > v_limit then
      raise exception 'output limits can be at most % KB for this organization', v_limit using errcode = '23514';
    end if;
  else
    v_limit := private.org_limit(v_org, 'challenges.maxTestsPerProblem');
    if v_limit is not null and (
      select count(*) from public.challenges_testcases where problem_id = new.problem_id
    ) >= v_limit then
      raise exception 'a problem can have at most % test(s) for this organization', v_limit
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
