-- contest presets fill in two new settings: the type a new problem starts as (`defaultKind`, "style" follows
-- the scoring) and which solution a partial-credit problem scores by (`scoreFrom`: best or last judged)

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
    'verificationRequired', false, 'problemsAfterContest', false, 'waitForJudging', true,
    'defaultKind', 'style', 'scoreFrom', 'best'
  ) || coalesce(private.event_setting(p_event, 'plugin.challenges'), '{}');
$$;

-- a new problem without a type takes the contest's default, or the one that fits its scoring
create or replace function private.challenges_problem_kind()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings jsonb;
begin
  if new.kind is null then
    v_settings := private.challenges_settings(new.event_id);
    new.kind := case
      when v_settings ->> 'defaultKind' in ('pass_fail', 'partial', 'shortest') then v_settings ->> 'defaultKind'
      when v_settings ->> 'scoring' = 'ioi' then 'partial'
      when v_settings ->> 'scoring' = 'golf' then 'shortest'
      else 'pass_fail'
    end;
  end if;
  return new;
end;
$$;
revoke execute on function private.challenges_problem_kind() from public, anon, authenticated;

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
  v_last boolean := v_settings ->> 'scoreFrom' = 'last';
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
        case when v_last
          then (array_agg(a.score order by a.submitted_at desc)
            filter (where a.verdict is not null and a.verdict not in ('JE', 'CE')))[1]
          else max(a.score) end as best_score,
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
