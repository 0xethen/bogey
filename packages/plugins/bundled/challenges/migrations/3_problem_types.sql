-- each problem has a type: pass/fail, partial credit or shortest code. The contest's scoring only says how
-- the scoreboard ranks; each problem's type says what a solution to it is worth.

alter table public.challenges_problems add column if not exists kind text;
update public.challenges_problems p set kind = case private.challenges_settings(p.event_id) ->> 'scoring'
    when 'ioi' then 'partial' when 'golf' then 'shortest' else 'pass_fail' end
  where kind is null;
alter table public.challenges_problems alter column kind set not null;
alter table public.challenges_problems drop constraint if exists challenges_problems_kind_check;
alter table public.challenges_problems add constraint challenges_problems_kind_check
  check (kind in ('pass_fail', 'partial', 'shortest'));
grant select (kind) on public.challenges_problems to authenticated;

-- a new problem without a type takes the one that fits the contest's scoring
create or replace function private.challenges_problem_kind()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind is null then
    new.kind := case private.challenges_settings(new.event_id) ->> 'scoring'
      when 'ioi' then 'partial' when 'golf' then 'shortest' else 'pass_fail' end;
  end if;
  return new;
end;
$$;
revoke execute on function private.challenges_problem_kind() from public, anon, authenticated;
drop trigger if exists challenges_problems_kind on public.challenges_problems;
create trigger challenges_problems_kind before insert on public.challenges_problems
  for each row execute function private.challenges_problem_kind();

create or replace function public.challenges_claim_judging(p_runner text, p_lease_seconds integer default 120)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_judging public.challenges_judgings;
begin
  select j.* into v_judging
  from public.challenges_judgings j
  join public.events e on e.id = j.event_id
  where j.status = 'queued'
  order by (j.rejudging_id is not null), (
    select count(*) from public.challenges_judgings r
    join public.events re on re.id = r.event_id
    where r.status = 'running' and re.org_id = e.org_id
  ), j.queued_at
  for update of j skip locked
  limit 1;

  if v_judging.id is null then
    return null;
  end if;

  update public.challenges_judgings set
    status = 'running',
    runner_id = p_runner,
    lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    attempts = attempts + 1,
    started_at = now()
  where id = v_judging.id;

  return (
    select jsonb_build_object(
      'judging_id', v_judging.id,
      'event_id', s.event_id,
      'attempts', v_judging.attempts + 1,
      'solution', jsonb_build_object('id', s.id, 'source', s.source),
      'language', to_jsonb(l),
      'problem', jsonb_build_object(
        'id', p.id, 'label', p.label,
        'time_limit_ms', least(p.time_limit_ms, coalesce(private.org_limit(o.org_id, 'challenges.maxTimeLimitMs'), p.time_limit_ms)),
        'memory_limit_mb', least(p.memory_limit_mb, coalesce(private.org_limit(o.org_id, 'challenges.maxMemoryMb'), p.memory_limit_mb)),
        'output_limit_kb', least(p.output_limit_kb, coalesce(private.org_limit(o.org_id, 'challenges.maxOutputKb'), p.output_limit_kb)),
        'checker', p.checker,
        'checker_tolerance', p.checker_tolerance, 'checker_source', p.checker_source,
        'checker_language', (select to_jsonb(cl) from public.challenges_languages cl where cl.key = p.checker_language),
        'points', p.points, 'test_groups', p.test_groups
      ),
      -- the runner scores by the problem's type: partial credit sums tests, the rest are all or nothing
      'scoring', case p.kind when 'partial' then 'ioi' when 'shortest' then 'golf' else 'icpc' end,
      'testcases', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', t.id, 'ordinal', t.ordinal, 'is_sample', t.is_sample,
          'group_key', t.group_key, 'points', t.points
        ) order by t.is_sample desc, t.ordinal), '[]')
        from public.challenges_testcases t where t.problem_id = p.id
      )
    )
    from public.challenges_solutions s
    join public.challenges_problems p on p.id = s.problem_id
    join public.events o on o.id = s.event_id
    join public.challenges_languages l on l.key = s.language_key
    where s.id = v_judging.solution_id
  );
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
      select id, label, label_key, title, points, sort, golf_brackets, kind from public.challenges_problems
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
      join problems p on p.id = c.problem_id
      where p.kind = 'shortest' and c.best_length is not null
    ),
    golf_points as (
      select g.team_id, g.problem_id, g.best_length, g.place,
        case v_golf_points
          when 'rank' then greatest(0, p.points - v_golf_step * (g.place - 1))
          -- on a golf board the total length ranks; elsewhere a shortest-code problem earns points in proportion
          when 'length' then case when v_scoring = 'golf' then null
            else round(p.points * g.shortest::numeric / nullif(g.best_length, 0), 2) end
          when 'brackets' then coalesce((
            select (b ->> 'points')::numeric from jsonb_array_elements(p.golf_brackets) b
            where g.best_length <= (b ->> 'max')::integer
            order by (b ->> 'max')::integer limit 1), 0)
          else round(p.points * g.shortest::numeric / nullif(g.best_length, 0), 2)
        end as points
      from golf g join problems p on p.id = g.problem_id
    ),
    -- what each problem's type makes a team's best solution worth
    scored as (
      select c.*, p.kind, gp.place,
        case p.kind
          when 'partial' then c.best_score
          when 'shortest' then gp.points
          else case when c.solved_at is not null then p.points else 0 end
        end as points
      from cells c
      join problems p on p.id = c.problem_id
      left join golf_points gp on gp.team_id = c.team_id and gp.problem_id = c.problem_id
    ),
    team_rows as (
      select t.id as team_id, t.name as team_name, t.division_id,
        count(c.solved_at) as solved,
        coalesce(sum(
          floor(extract(epoch from c.solved_at - v_start) / 60) + v_penalty * c.wrong
        ) filter (where c.solved_at is not null), 0)::integer as penalty,
        coalesce(sum(c.points), 0) as score,
        coalesce(sum(c.best_length) filter (where c.solved_at is not null and c.kind = 'shortest'), 0)::integer
          as total_length,
        max(c.solved_at) as last_solve,
        coalesce(jsonb_agg(jsonb_build_object(
          'problem_id', c.problem_id,
          'solved', c.solved_at is not null,
          'minutes', floor(extract(epoch from c.solved_at - v_start) / 60),
          'attempts', c.wrong + (c.solved_at is not null)::integer,
          'pending', c.pending,
          'score', c.points,
          'length', case when c.kind = 'shortest' then c.best_length end,
          'place', c.place,
          'first', exists (select 1 from first_solvers fs where fs.problem_id = c.problem_id and fs.team_id = t.id)
        )) filter (where c.problem_id is not null), '[]') as cells
      from public.teams t
      left join scored c on c.team_id = t.id
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
          jsonb_build_object('id', id, 'label', label, 'title', title, 'points', points, 'kind', kind)
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
