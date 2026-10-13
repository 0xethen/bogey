create type public.challenges_checker as enum ('exact', 'tokens', 'float', 'custom');
create type public.challenges_judging_status as enum ('queued', 'running', 'done', 'failed');
create type public.challenges_verdict as enum ('AC', 'WA', 'TLE', 'MLE', 'RE', 'CE', 'OLE', 'JE');

insert into public.roles (key, label, source) values ('challenges.jury', 'Jury', 'challenges')
on conflict (key) do nothing;

insert into public.role_permissions (role_key, permission) values
  ('challenges.jury', 'challenges.jury'),
  ('challenges.jury', 'clarifications.answer'),
  ('challenges.jury', 'event.view');

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 20 * 1024 * 1024)
on conflict (id) do nothing;

create table public.challenges_languages (
  key text primary key check (key ~ '^[a-z][a-z0-9+-]*$'),
  name text not null,
  version text not null default '',
  image text not null,
  source_file text not null,
  compile_cmd text,
  run_cmd text not null,
  editor_mode text not null default 'plain',
  enabled boolean not null default true,
  sort smallint not null default 0
);

insert into public.challenges_languages (key, name, version, image, source_file, compile_cmd, run_cmd, editor_mode, sort) values
  ('python', 'Python', '3.13', 'bogey-runner-python:3.13', 'main.py', null, 'python3 main.py', 'python', 0),
  ('javascript', 'JavaScript', 'Node 22', 'bogey-runner-node:22', 'main.js', null, 'node main.js', 'javascript', 1),
  ('cpp', 'C++17', 'GCC 14', 'bogey-runner-gcc:14', 'main.cpp', 'g++ -O2 -std=c++17 -o main main.cpp', './main', 'cpp', 2),
  ('java', 'Java', '21', 'bogey-runner-java:21', 'Main.java', 'javac Main.java', 'java -Xss64m Main', 'java', 3);

create table public.challenges_problems (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  label text not null check (label ~ '^[A-Z][A-Z0-9]{0,3}$'),
  slug extensions.citext not null check (slug ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  title text not null check (length(title) between 1 and 120),
  statement_md text not null default '',
  statement_pdf_path text,
  time_limit_ms integer not null default 2000 check (time_limit_ms between 100 and 60000),
  memory_limit_mb integer not null default 256 check (memory_limit_mb between 16 and 4096),
  output_limit_kb integer not null default 8192 check (output_limit_kb between 1 and 65536),
  checker public.challenges_checker not null default 'tokens',
  checker_tolerance double precision check (checker_tolerance > 0),
  checker_source text,
  checker_language text references public.challenges_languages,
  points numeric(8, 2) not null default 100,
  visible boolean not null default true,
  sort smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, label),
  unique (event_id, slug),
  unique (event_id, id),
  check (checker <> 'custom' or (checker_source is not null and checker_language is not null))
);

create trigger challenges_problems_touch before update on public.challenges_problems
  for each row execute function private.touch_updated_at();

create table public.challenges_testcases (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  problem_id uuid not null,
  ordinal integer not null,
  is_sample boolean not null default false,
  group_key text,
  points numeric(8, 2),
  input text not null check (octet_length(input) <= 16 * 1024 * 1024),
  answer text not null check (octet_length(answer) <= 16 * 1024 * 1024),
  created_at timestamptz not null default now(),
  unique (problem_id, ordinal),
  foreign key (event_id, problem_id) references public.challenges_problems (event_id, id) on delete cascade
);

create table public.challenges_attachments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  problem_id uuid not null,
  name text not null,
  storage_path text not null unique,
  created_at timestamptz not null default now(),
  foreign key (event_id, problem_id) references public.challenges_problems (event_id, id) on delete cascade
);

create table public.challenges_solutions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  problem_id uuid not null,
  team_id uuid not null,
  user_id uuid references public.profiles on delete set null,
  language_key text not null references public.challenges_languages,
  source text not null check (octet_length(source) <= 256 * 1024),
  submitted_at timestamptz not null default now(),
  unique (event_id, id),
  foreign key (event_id, problem_id) references public.challenges_problems (event_id, id) on delete cascade,
  foreign key (event_id, team_id) references public.teams (event_id, id) on delete cascade
);
create index challenges_solutions_team_idx on public.challenges_solutions (team_id, problem_id, submitted_at);
create index challenges_solutions_event_idx on public.challenges_solutions (event_id, submitted_at);

create table public.challenges_judgings (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  solution_id uuid not null,
  status public.challenges_judging_status not null default 'queued',
  runner_id text,
  lease_expires_at timestamptz,
  attempts smallint not null default 0,
  verdict public.challenges_verdict,
  score numeric(8, 2),
  max_time_ms integer,
  max_memory_kb integer,
  compile_output text check (octet_length(compile_output) <= 16384),
  valid boolean not null default true,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  foreign key (event_id, solution_id) references public.challenges_solutions (event_id, id) on delete cascade
);
create index challenges_judgings_solution_idx on public.challenges_judgings (solution_id, queued_at desc);
create index challenges_judgings_queue_idx on public.challenges_judgings (queued_at) where status in ('queued', 'running');

create table public.challenges_judging_runs (
  id bigint generated always as identity primary key,
  judging_id uuid not null references public.challenges_judgings on delete cascade,
  testcase_id uuid not null references public.challenges_testcases on delete cascade,
  verdict public.challenges_verdict not null,
  time_ms integer,
  memory_kb integer,
  output_excerpt text check (octet_length(output_excerpt) <= 4096),
  stderr_excerpt text check (octet_length(stderr_excerpt) <= 4096)
);
create index challenges_judging_runs_judging_idx on public.challenges_judging_runs (judging_id);

create function private.challenges_is_jury(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_permission(p_event, 'challenges.jury');
$$;

create function private.challenges_can_see_problems(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.challenges_is_jury(p_event)
    or (
      private.plugin_enabled(p_event, 'challenges')
      and private.has_permission(p_event, 'event.view')
      and (private.window_open(p_event, 'challenges.contest') or private.window_open(p_event, 'challenges.scoreboard'))
    );
$$;

grant execute on function
  private.challenges_is_jury(uuid),
  private.challenges_can_see_problems(uuid)
to anon, authenticated;

create function public.challenges_problem_samples(p_problem uuid)
returns table (ordinal integer, input text, answer text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_problem public.challenges_problems;
begin
  select * into v_problem from public.challenges_problems where id = p_problem;
  if v_problem.id is null or not private.challenges_can_see_problems(v_problem.event_id)
     or (not v_problem.visible and not private.challenges_is_jury(v_problem.event_id)) then
    raise exception 'problem not available' using errcode = '42501';
  end if;
  return query
    select t.ordinal, t.input, t.answer from public.challenges_testcases t
    where t.problem_id = p_problem and t.is_sample order by t.ordinal;
end;
$$;

create function public.challenges_submit(p_problem uuid, p_language text, p_source text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem public.challenges_problems;
  v_settings jsonb;
  v_team uuid;
  v_limit integer;
  v_solution uuid;
begin
  select * into v_problem from public.challenges_problems where id = p_problem;
  if v_problem.id is null or not v_problem.visible then
    raise exception 'no such problem' using errcode = 'P0002';
  end if;
  if not private.plugin_enabled(v_problem.event_id, 'challenges')
     or not private.has_permission(v_problem.event_id, 'event.compete') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not private.window_open(v_problem.event_id, 'challenges.contest') then
    raise exception 'the contest is not running' using errcode = 'P0001';
  end if;

  v_settings := private.event_setting(v_problem.event_id, 'challenges');
  if not exists (select 1 from public.challenges_languages where key = p_language and enabled)
     or (jsonb_typeof(v_settings -> 'languages') = 'array'
         and jsonb_array_length(v_settings -> 'languages') > 0
         and not (v_settings -> 'languages') ? p_language) then
    raise exception 'language "%" is not allowed in this contest', p_language using errcode = '22023';
  end if;

  v_team := private.my_team(v_problem.event_id);
  if v_team is null then
    raise exception 'join a team first' using errcode = 'P0001';
  end if;

  v_limit := nullif(v_settings ->> 'attemptLimit', '')::integer;
  if v_limit is not null and (
    select count(*) from public.challenges_solutions where team_id = v_team and problem_id = p_problem
  ) >= v_limit then
    raise exception 'no attempts left for this problem' using errcode = 'P0001';
  end if;

  if private.plugin_enabled(v_problem.event_id, 'lockdown')
    and to_regprocedure('private.lockdown_assert_can_submit(uuid)') is not null then
    perform private.lockdown_assert_can_submit(v_problem.event_id);
  end if;

  insert into public.challenges_solutions (event_id, problem_id, team_id, user_id, language_key, source)
  values (v_problem.event_id, p_problem, v_team, (select auth.uid()), p_language, p_source)
  returning id into v_solution;
  insert into public.challenges_judgings (event_id, solution_id) values (v_problem.event_id, v_solution);

  perform private.audit(v_problem.event_id, 'challenges.submitted', 'challenges_solution', v_solution,
    jsonb_build_object('problem', v_problem.label, 'language', p_language));
  return v_solution;
end;
$$;

grant execute on function
  public.challenges_problem_samples(uuid),
  public.challenges_submit(uuid, text, text)
to authenticated;

create function public.challenges_claim_judging(p_runner text, p_lease_seconds integer default 120)
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
  order by (
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
      'solution', jsonb_build_object('id', s.id, 'source', s.source),
      'language', to_jsonb(l),
      'problem', jsonb_build_object(
        'id', p.id, 'label', p.label,
        'time_limit_ms', p.time_limit_ms, 'memory_limit_mb', p.memory_limit_mb,
        'output_limit_kb', p.output_limit_kb, 'checker', p.checker,
        'checker_tolerance', p.checker_tolerance, 'checker_source', p.checker_source,
        'checker_language', p.checker_language, 'points', p.points
      ),
      'scoring', coalesce(private.event_setting(s.event_id, 'challenges') ->> 'scoring', 'icpc'),
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
    join public.challenges_languages l on l.key = s.language_key
    where s.id = v_judging.solution_id
  );
end;
$$;

create function public.challenges_heartbeat(p_judging uuid, p_runner text, p_lease_seconds integer default 120)
returns boolean
language sql
security definer
set search_path = ''
as $$
  update public.challenges_judgings
  set lease_expires_at = now() + make_interval(secs => p_lease_seconds)
  where id = p_judging and runner_id = p_runner and status = 'running'
  returning true;
$$;

create function public.challenges_record_judging(
  p_judging uuid, p_runner text, p_verdict public.challenges_verdict, p_score numeric,
  p_max_time_ms integer, p_max_memory_kb integer, p_compile_output text, p_runs jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_judging public.challenges_judgings;
begin
  update public.challenges_judgings set
    status = 'done', verdict = p_verdict, score = p_score,
    max_time_ms = p_max_time_ms, max_memory_kb = p_max_memory_kb,
    compile_output = left(p_compile_output, 16000),
    finished_at = now(), lease_expires_at = null
  where id = p_judging and runner_id = p_runner and status = 'running'
  returning * into v_judging;

  if v_judging.id is null then
    return false;
  end if;

  insert into public.challenges_judging_runs
    (judging_id, testcase_id, verdict, time_ms, memory_kb, output_excerpt, stderr_excerpt)
  select p_judging, (r ->> 'testcase_id')::uuid, (r ->> 'verdict')::public.challenges_verdict,
    (r ->> 'time_ms')::integer, (r ->> 'memory_kb')::integer,
    case when t.is_sample then left(r ->> 'output_excerpt', 4000) end,
    case when t.is_sample then left(r ->> 'stderr_excerpt', 4000) end
  from jsonb_array_elements(coalesce(p_runs, '[]')) as r
  join public.challenges_testcases t on t.id = (r ->> 'testcase_id')::uuid;

  update public.challenges_judgings set valid = false
  where solution_id = v_judging.solution_id and id <> v_judging.id and status = 'done';

  perform private.audit(v_judging.event_id, 'challenges.judged', 'challenges_judging', v_judging.id,
    jsonb_build_object('verdict', p_verdict, 'runner', p_runner));
  return true;
end;
$$;

create function public.challenges_release_judging(p_judging uuid, p_runner text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.challenges_judgings
  set status = 'queued', runner_id = null, lease_expires_at = null, attempts = greatest(attempts - 1, 0)
  where id = p_judging and runner_id = p_runner and status = 'running';
$$;

create function private.challenges_expire_leases()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.challenges_judgings set
    status = case when attempts >= 3 then 'failed' else 'queued' end::public.challenges_judging_status,
    verdict = case when attempts >= 3 then 'JE' end::public.challenges_verdict,
    finished_at = case when attempts >= 3 then now() end,
    runner_id = null,
    lease_expires_at = null
  where status = 'running' and lease_expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function
  public.challenges_claim_judging(text, integer),
  public.challenges_heartbeat(uuid, text, integer),
  public.challenges_record_judging(uuid, text, public.challenges_verdict, numeric, integer, integer, text, jsonb),
  public.challenges_release_judging(uuid, text)
from authenticated;
grant execute on function
  public.challenges_claim_judging(text, integer),
  public.challenges_heartbeat(uuid, text, integer),
  public.challenges_record_judging(uuid, text, public.challenges_verdict, numeric, integer, integer, text, jsonb),
  public.challenges_release_judging(uuid, text)
to service_role;

select cron.schedule('bogey-challenges-leases', '* * * * *', 'select private.challenges_expire_leases()');

create function public.challenges_rejudge(
  p_event uuid, p_solution uuid default null, p_problem uuid default null, p_team uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not private.challenges_is_jury(p_event) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.challenges_judgings (event_id, solution_id)
  select s.event_id, s.id from public.challenges_solutions s
  where s.event_id = p_event
    and (p_solution is null or s.id = p_solution)
    and (p_problem is null or s.problem_id = p_problem)
    and (p_team is null or s.team_id = p_team);
  get diagnostics v_count = row_count;
  perform private.audit(p_event, 'challenges.rejudged', 'event', p_event, jsonb_build_object(
    'solution', p_solution, 'problem', p_problem, 'team', p_team, 'count', v_count));
  return v_count;
end;
$$;

create function public.challenges_override_verdict(p_judging uuid, p_verdict public.challenges_verdict, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_judging public.challenges_judgings;
begin
  select * into v_judging from public.challenges_judgings where id = p_judging;
  if v_judging.id is null or not private.challenges_is_jury(v_judging.event_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.challenges_judgings set verdict = p_verdict, status = 'done', finished_at = coalesce(finished_at, now())
  where id = p_judging;
  perform private.audit(v_judging.event_id, 'challenges.verdict_overridden', 'challenges_judging', p_judging,
    jsonb_build_object('from', v_judging.verdict, 'to', p_verdict, 'reason', p_reason));
end;
$$;

grant execute on function
  public.challenges_rejudge(uuid, uuid, uuid, uuid),
  public.challenges_override_verdict(uuid, public.challenges_verdict, text)
to authenticated;

create function public.challenges_scoreboard(p_event uuid, p_jury boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings jsonb := private.event_setting(p_event, 'challenges');
  v_scoring text := coalesce(v_settings ->> 'scoring', 'icpc');
  v_penalty integer := coalesce((v_settings ->> 'penaltyMinutes')::integer, 20);
  v_count_ce boolean := coalesce((v_settings ->> 'countCompileErrors')::boolean, false);
  v_freeze timestamptz := nullif(v_settings ->> 'freezeAt', '')::timestamptz;
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

  v_frozen := not p_jury and v_freeze is not null and now() >= v_freeze
    and not coalesce((v_settings ->> 'revealed')::boolean, false);
  select coalesce(w.opens_at, e.starts_at, now()) into v_start
  from public.events e
  left join public.event_windows w on w.event_id = e.id and w.key = 'challenges.contest'
  where e.id = p_event;

  return (
    with problems as (
      select id, label, title, points, sort from public.challenges_problems
      where event_id = p_event and visible
    ),
    attempts as (
      select s.team_id, s.problem_id, s.submitted_at,
        case when v_frozen and s.submitted_at >= v_freeze then null else j.verdict end as verdict,
        case when v_frozen and s.submitted_at >= v_freeze then null else j.score end as score
      from public.challenges_solutions s
      join problems p on p.id = s.problem_id
      left join lateral (
        select verdict, score from public.challenges_judgings j
        where j.solution_id = s.id and j.valid and j.status in ('done', 'failed')
        order by j.finished_at desc limit 1
      ) j on true
      where s.event_id = p_event
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
        max(a.score) as best_score
      from attempts a
      left join first_ac f on f.team_id = a.team_id and f.problem_id = a.problem_id
      group by a.team_id, a.problem_id, f.at
    ),
    first_solvers as (
      select distinct on (problem_id) problem_id, team_id
      from first_ac order by problem_id, at
    ),
    team_rows as (
      select t.id as team_id, t.name as team_name, t.division_id,
        count(c.solved_at) as solved,
        coalesce(sum(
          floor(extract(epoch from c.solved_at - v_start) / 60) + v_penalty * c.wrong
        ) filter (where c.solved_at is not null), 0)::integer as penalty,
        coalesce(sum(c.best_score), 0) as score,
        max(c.solved_at) as last_solve,
        coalesce(jsonb_agg(jsonb_build_object(
          'problem_id', c.problem_id,
          'solved', c.solved_at is not null,
          'minutes', floor(extract(epoch from c.solved_at - v_start) / 60),
          'attempts', c.wrong + (c.solved_at is not null)::integer,
          'pending', c.pending,
          'score', c.best_score,
          'first', exists (select 1 from first_solvers fs where fs.problem_id = c.problem_id and fs.team_id = t.id)
        )) filter (where c.problem_id is not null), '[]') as cells
      from public.teams t
      left join cells c on c.team_id = t.id
      where t.event_id = p_event
        and exists (select 1 from public.team_members tm where tm.team_id = t.id)
      group by t.id
    )
    select jsonb_build_object(
      'scoring', v_scoring,
      'frozen', v_frozen,
      'freezeAt', v_freeze,
      'startedAt', v_start,
      'problems', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'label', label, 'title', title, 'points', points) order by sort, label), '[]') from problems),
      'rows', coalesce(jsonb_agg(
        to_jsonb(r) - 'last_solve' || jsonb_build_object('rank', r.rank)
        order by r.rank, r.team_name
      ), '[]')
    )
    from (
      select team_rows.*,
        case when v_scoring = 'ioi'
          then rank() over (order by score desc)
          else rank() over (order by solved desc, penalty asc)
        end as rank
      from team_rows
    ) r
  );
end;
$$;
grant execute on function public.challenges_scoreboard(uuid, boolean) to anon, authenticated;

create index challenges_attachments_event_id_problem_id_fk_idx on public.challenges_attachments (event_id, problem_id);
create index challenges_judging_runs_testcase_id_fk_idx on public.challenges_judging_runs (testcase_id);
create index challenges_judgings_event_id_solution_id_fk_idx on public.challenges_judgings (event_id, solution_id);
create index challenges_solutions_event_id_problem_id_fk_idx on public.challenges_solutions (event_id, problem_id);
create index challenges_solutions_event_id_team_id_fk_idx on public.challenges_solutions (event_id, team_id);
create index challenges_testcases_event_id_problem_id_fk_idx on public.challenges_testcases (event_id, problem_id);

alter table public.challenges_languages enable row level security;
alter table public.challenges_problems enable row level security;
alter table public.challenges_testcases enable row level security;
alter table public.challenges_attachments enable row level security;
alter table public.challenges_solutions enable row level security;
alter table public.challenges_judgings enable row level security;
alter table public.challenges_judging_runs enable row level security;

create policy challenges_languages_select on public.challenges_languages for select to anon, authenticated
  using (true);
create policy challenges_languages_write_insert on public.challenges_languages for insert to authenticated
  with check ((select private.is_platform_admin()));
create policy challenges_languages_write_update on public.challenges_languages for update to authenticated
  using ((select private.is_platform_admin()))
  with check ((select private.is_platform_admin()));
create policy challenges_languages_write_delete on public.challenges_languages for delete to authenticated
  using ((select private.is_platform_admin()));

create policy challenges_problems_select on public.challenges_problems for select to authenticated
  using (
    (select private.challenges_is_jury(event_id))
    or (visible and (select private.challenges_can_see_problems(event_id)))
  );
create policy challenges_problems_jury_insert on public.challenges_problems for insert to authenticated
  with check ((select private.challenges_is_jury(event_id)));
create policy challenges_problems_jury_update on public.challenges_problems for update to authenticated
  using ((select private.challenges_is_jury(event_id)))
  with check ((select private.challenges_is_jury(event_id)));
create policy challenges_problems_jury_delete on public.challenges_problems for delete to authenticated
  using ((select private.challenges_is_jury(event_id)));

create policy challenges_testcases_jury on public.challenges_testcases for all to authenticated
  using ((select private.challenges_is_jury(event_id)))
  with check ((select private.challenges_is_jury(event_id)));

create policy challenges_attachments_select on public.challenges_attachments for select to authenticated
  using ((select private.challenges_can_see_problems(event_id)));
create policy challenges_attachments_jury_insert on public.challenges_attachments for insert to authenticated
  with check ((select private.challenges_is_jury(event_id)));
create policy challenges_attachments_jury_update on public.challenges_attachments for update to authenticated
  using ((select private.challenges_is_jury(event_id)))
  with check ((select private.challenges_is_jury(event_id)));
create policy challenges_attachments_jury_delete on public.challenges_attachments for delete to authenticated
  using ((select private.challenges_is_jury(event_id)));

create policy challenges_solutions_select on public.challenges_solutions for select to authenticated
  using ((select private.is_team_member(team_id)) or (select private.challenges_is_jury(event_id)));

create policy challenges_judgings_select on public.challenges_judgings for select to authenticated
  using (
    (select private.challenges_is_jury(event_id))
    or exists (
      select 1 from public.challenges_solutions s
      where s.id = solution_id and private.is_team_member(s.team_id)
    )
  );

create function private.challenges_can_see_run(p_judging uuid, p_testcase uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.challenges_judgings j
    join public.challenges_solutions s on s.id = j.solution_id
    join public.challenges_testcases t on t.id = p_testcase
    where j.id = p_judging
      and (private.challenges_is_jury(j.event_id) or (t.is_sample and private.is_team_member(s.team_id)))
  );
$$;
grant execute on function private.challenges_can_see_run(uuid, uuid) to authenticated;

create policy challenges_judging_runs_select on public.challenges_judging_runs for select to authenticated
  using (private.challenges_can_see_run(judging_id, testcase_id));

create policy attachments_read on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and (select private.challenges_can_see_problems(private.path_uuid(name, 1))));
create policy attachments_jury on storage.objects for all to authenticated
  using (bucket_id = 'attachments' and (select private.challenges_is_jury(private.path_uuid(name, 1))))
  with check (bucket_id = 'attachments' and (select private.challenges_is_jury(private.path_uuid(name, 1))));

alter publication supabase_realtime add table public.challenges_judgings;

insert into public.settings (scope, org_id, event_id, namespace, value)
select s.scope, s.org_id, s.event_id, 'plugin.challenges', jsonb_strip_nulls(jsonb_build_object(
  'scoring', s.value -> 'scoring',
  'penaltyMinutes', s.value -> 'penaltyMinutes',
  'revealed', s.value -> 'revealed',
  'countCompileErrors', s.value -> 'countCompileErrors',
  'attemptLimit', s.value -> 'attemptLimit',
  'languages', case when jsonb_typeof(s.value -> 'languages') = 'array'
    then to_jsonb(array_to_string(array(select jsonb_array_elements_text(s.value -> 'languages')), ', '))
  end,
  'freezeMinutes', (
    select greatest(0, floor(extract(epoch from w.closes_at - (s.value ->> 'freezeAt')::timestamptz) / 60))::integer
    from public.event_windows w
    where w.event_id = s.event_id and w.key = 'challenges.contest' and w.closes_at is not null
      and nullif(s.value ->> 'freezeAt', '') is not null
  )
))
from public.settings s
where s.namespace = 'challenges'
on conflict (scope, org_id, event_id, namespace) do update set value = excluded.value || public.settings.value;

delete from public.settings where namespace = 'challenges';

create function private.challenges_settings(p_event uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'scoring', 'icpc', 'penaltyMinutes', 20, 'freezeMinutes', 60, 'revealed', false,
    'languages', '', 'attemptLimit', 0, 'countCompileErrors', false
  ) || coalesce(private.event_setting(p_event, 'plugin.challenges'), '{}');
$$;
grant execute on function private.challenges_settings(uuid) to authenticated, service_role;

create or replace function public.challenges_submit(p_problem uuid, p_language text, p_source text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem public.challenges_problems;
  v_settings jsonb;
  v_languages text[];
  v_team uuid;
  v_limit integer;
  v_solution uuid;
begin
  select * into v_problem from public.challenges_problems where id = p_problem;
  if v_problem.id is null or not v_problem.visible then
    raise exception 'no such problem' using errcode = 'P0002';
  end if;
  if not private.plugin_enabled(v_problem.event_id, 'challenges')
     or not private.has_permission(v_problem.event_id, 'event.compete') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not private.window_open(v_problem.event_id, 'challenges.contest') then
    raise exception 'the contest is not running' using errcode = 'P0001';
  end if;

  v_settings := private.challenges_settings(v_problem.event_id);
  v_languages := array(
    select trim(each) from unnest(string_to_array(v_settings ->> 'languages', ',')) each
    where trim(each) <> ''
  );
  if not exists (select 1 from public.challenges_languages where key = p_language and enabled)
     or (cardinality(v_languages) > 0 and not p_language = any (v_languages)) then
    raise exception 'language "%" is not allowed in this contest', p_language using errcode = '22023';
  end if;

  v_team := private.my_team(v_problem.event_id);
  if v_team is null then
    raise exception 'join a team first' using errcode = 'P0001';
  end if;

  v_limit := nullif((v_settings ->> 'attemptLimit')::integer, 0);
  if v_limit is not null and (
    select count(*) from public.challenges_solutions where team_id = v_team and problem_id = p_problem
  ) >= v_limit then
    raise exception 'no tries left for this problem' using errcode = 'P0001';
  end if;

  if private.plugin_enabled(v_problem.event_id, 'lockdown')
    and to_regprocedure('private.lockdown_assert_can_submit(uuid)') is not null then
    perform private.lockdown_assert_can_submit(v_problem.event_id);
  end if;

  insert into public.challenges_solutions (event_id, problem_id, team_id, user_id, language_key, source)
  values (v_problem.event_id, p_problem, v_team, (select auth.uid()), p_language, p_source)
  returning id into v_solution;
  insert into public.challenges_judgings (event_id, solution_id) values (v_problem.event_id, v_solution);

  perform private.audit(v_problem.event_id, 'challenges.submitted', 'challenges_solution', v_solution,
    jsonb_build_object('problem', v_problem.label, 'language', p_language));
  return v_solution;
end;
$$;

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
  order by (
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
      'solution', jsonb_build_object('id', s.id, 'source', s.source),
      'language', to_jsonb(l),
      'problem', jsonb_build_object(
        'id', p.id, 'label', p.label,
        'time_limit_ms', p.time_limit_ms, 'memory_limit_mb', p.memory_limit_mb,
        'output_limit_kb', p.output_limit_kb, 'checker', p.checker,
        'checker_tolerance', p.checker_tolerance, 'checker_source', p.checker_source,
        'checker_language', p.checker_language, 'points', p.points
      ),
      'scoring', private.challenges_settings(s.event_id) ->> 'scoring',
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
  v_scoring text := v_settings ->> 'scoring';
  v_penalty integer := (v_settings ->> 'penaltyMinutes')::integer;
  v_count_ce boolean := (v_settings ->> 'countCompileErrors')::boolean;
  v_freeze_minutes integer := (v_settings ->> 'freezeMinutes')::integer;
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
      select id, label, title, points, sort from public.challenges_problems
      where event_id = p_event and visible
    ),
    attempts as (
      select s.team_id, s.problem_id, s.submitted_at,
        case when v_frozen and s.submitted_at >= v_freeze then null else j.verdict end as verdict,
        case when v_frozen and s.submitted_at >= v_freeze then null else j.score end as score
      from public.challenges_solutions s
      join problems p on p.id = s.problem_id
      left join lateral (
        select verdict, score from public.challenges_judgings j
        where j.solution_id = s.id and j.valid and j.status in ('done', 'failed')
        order by j.finished_at desc limit 1
      ) j on true
      where s.event_id = p_event
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
        max(a.score) as best_score
      from attempts a
      left join first_ac f on f.team_id = a.team_id and f.problem_id = a.problem_id
      group by a.team_id, a.problem_id, f.at
    ),
    first_solvers as (
      select distinct on (problem_id) problem_id, team_id
      from first_ac order by problem_id, at
    ),
    team_rows as (
      select t.id as team_id, t.name as team_name, t.division_id,
        count(c.solved_at) as solved,
        coalesce(sum(
          floor(extract(epoch from c.solved_at - v_start) / 60) + v_penalty * c.wrong
        ) filter (where c.solved_at is not null), 0)::integer as penalty,
        coalesce(sum(c.best_score), 0) as score,
        max(c.solved_at) as last_solve,
        coalesce(jsonb_agg(jsonb_build_object(
          'problem_id', c.problem_id,
          'solved', c.solved_at is not null,
          'minutes', floor(extract(epoch from c.solved_at - v_start) / 60),
          'attempts', c.wrong + (c.solved_at is not null)::integer,
          'pending', c.pending,
          'score', c.best_score,
          'first', exists (select 1 from first_solvers fs where fs.problem_id = c.problem_id and fs.team_id = t.id)
        )) filter (where c.problem_id is not null), '[]') as cells
      from public.teams t
      left join cells c on c.team_id = t.id
      where t.event_id = p_event
        and exists (select 1 from public.team_members tm where tm.team_id = t.id)
      group by t.id
    )
    select jsonb_build_object(
      'scoring', v_scoring,
      'frozen', v_frozen,
      'freezeAt', v_freeze,
      'startedAt', v_start,
      'problems', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'label', label, 'title', title, 'points', points) order by sort, label), '[]') from problems),
      'rows', coalesce(jsonb_agg(
        to_jsonb(r) - 'last_solve' || jsonb_build_object('rank', r.rank)
        order by r.rank, r.team_name
      ), '[]')
    )
    from (
      select team_rows.*,
        case when v_scoring = 'ioi'
          then rank() over (order by score desc)
          else rank() over (order by solved desc, penalty asc)
        end as rank
      from team_rows
    ) r
  );
end;
$$;

alter table public.challenges_problems
  add column difficulty text check (difficulty in ('easy', 'medium', 'hard'));

create or replace function private.challenges_settings(p_event uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'scoring', 'icpc', 'penaltyMinutes', 20, 'freezeMinutes', 60, 'revealed', false,
    'languages', '', 'attemptLimit', 0, 'countCompileErrors', false, 'resultDetail', 'tests'
  ) || coalesce(private.event_setting(p_event, 'plugin.challenges'), '{}');
$$;

create function private.challenges_started(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.window_open(p_event, 'challenges.contest') or exists (
    select 1 from public.event_windows w
    where w.event_id = p_event and w.key = 'challenges.contest'
      and w.opens_at is not null and w.opens_at <= now()
  );
$$;
grant execute on function private.challenges_started(uuid) to anon, authenticated;

create or replace function private.challenges_can_see_problems(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.challenges_is_jury(p_event)
    or (
      private.plugin_enabled(p_event, 'challenges')
      and private.has_permission(p_event, 'event.view')
      and (
        private.window_open(p_event, 'challenges.contest')
        or (private.window_open(p_event, 'challenges.scoreboard') and private.challenges_started(p_event))
      )
    );
$$;

create function private.challenges_problem_readable(p_problem uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.challenges_problems p
    where p.id = p_problem
      and (
        private.challenges_is_jury(p.event_id)
        or (p.visible and private.challenges_can_see_problems(p.event_id))
      )
  );
$$;
grant execute on function private.challenges_problem_readable(uuid) to authenticated;

drop policy challenges_attachments_select on public.challenges_attachments;
create policy challenges_attachments_select on public.challenges_attachments for select to authenticated
  using ((select private.challenges_problem_readable(problem_id)));

drop policy attachments_read on storage.objects;
create policy attachments_read on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and private.path_uuid(name, 1) is not null
    and exists (
      select 1 from public.challenges_problems p
      where p.id = private.path_uuid(name, 2) and p.event_id = private.path_uuid(name, 1)
    )
    and (select private.challenges_problem_readable(private.path_uuid(name, 2)))
  );

create or replace function public.challenges_submit(p_problem uuid, p_language text, p_source text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem public.challenges_problems;
  v_settings jsonb;
  v_languages text[];
  v_team uuid;
  v_limit integer;
  v_solution uuid;
begin
  select * into v_problem from public.challenges_problems where id = p_problem;
  if v_problem.id is null or not v_problem.visible then
    raise exception 'no such problem' using errcode = 'P0002';
  end if;
  if not private.plugin_enabled(v_problem.event_id, 'challenges')
     or not private.has_permission(v_problem.event_id, 'event.compete') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not private.window_open(v_problem.event_id, 'challenges.contest') then
    raise exception 'the contest is not running' using errcode = 'P0001';
  end if;
  if p_source is null or length(trim(p_source)) = 0 then
    raise exception 'the solution is empty' using errcode = '22023';
  end if;

  v_settings := private.challenges_settings(v_problem.event_id);
  v_languages := array(
    select trim(each) from unnest(string_to_array(v_settings ->> 'languages', ',')) each
    where trim(each) <> ''
  );
  if not exists (select 1 from public.challenges_languages where key = p_language and enabled)
     or (cardinality(v_languages) > 0 and not p_language = any (v_languages)) then
    raise exception 'language "%" is not allowed in this contest', p_language using errcode = '22023';
  end if;

  v_team := private.my_team(v_problem.event_id);
  if v_team is null then
    raise exception 'join a team first' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_team::text, 0));
  if exists (
    select 1 from public.challenges_solutions
    where team_id = v_team and submitted_at > now() - interval '10 seconds'
  ) then
    raise exception 'wait a few seconds between solutions' using errcode = 'P0001';
  end if;

  v_limit := nullif((v_settings ->> 'attemptLimit')::integer, 0);
  if v_limit is not null and (
    select count(*) from public.challenges_solutions where team_id = v_team and problem_id = p_problem
  ) >= v_limit then
    raise exception 'no tries left for this problem' using errcode = 'P0001';
  end if;

  if private.plugin_enabled(v_problem.event_id, 'lockdown')
    and to_regprocedure('private.lockdown_assert_can_submit(uuid)') is not null then
    perform private.lockdown_assert_can_submit(v_problem.event_id);
  end if;

  insert into public.challenges_solutions (event_id, problem_id, team_id, user_id, language_key, source)
  values (v_problem.event_id, p_problem, v_team, (select auth.uid()), p_language, p_source)
  returning id into v_solution;
  insert into public.challenges_judgings (event_id, solution_id) values (v_problem.event_id, v_solution);

  perform private.audit(v_problem.event_id, 'challenges.submitted', 'challenges_solution', v_solution,
    jsonb_build_object('problem', v_problem.label, 'language', p_language));
  return v_solution;
end;
$$;

create or replace function public.challenges_record_judging(
  p_judging uuid, p_runner text, p_verdict public.challenges_verdict, p_score numeric,
  p_max_time_ms integer, p_max_memory_kb integer, p_compile_output text, p_runs jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_judging public.challenges_judgings;
begin
  update public.challenges_judgings set
    status = 'done', verdict = p_verdict, score = p_score,
    max_time_ms = p_max_time_ms, max_memory_kb = p_max_memory_kb,
    compile_output = left(p_compile_output, 16000),
    finished_at = now(), lease_expires_at = null
  where id = p_judging and runner_id = p_runner and status = 'running'
  returning * into v_judging;

  if v_judging.id is null then
    return false;
  end if;

  insert into public.challenges_judging_runs
    (judging_id, testcase_id, verdict, time_ms, memory_kb, output_excerpt, stderr_excerpt)
  select p_judging, t.id, (r ->> 'verdict')::public.challenges_verdict,
    (r ->> 'time_ms')::integer, (r ->> 'memory_kb')::integer,
    left(r ->> 'output_excerpt', 4000), left(r ->> 'stderr_excerpt', 4000)
  from jsonb_array_elements(coalesce(p_runs, '[]')) as r
  join public.challenges_testcases t on t.id = (r ->> 'testcase_id')::uuid
  join public.challenges_solutions s on s.id = v_judging.solution_id and s.problem_id = t.problem_id;

  update public.challenges_judgings set valid = false
  where solution_id = v_judging.solution_id and id <> v_judging.id and status = 'done';

  perform private.audit(v_judging.event_id, 'challenges.judged', 'challenges_judging', v_judging.id,
    jsonb_build_object('verdict', p_verdict, 'runner', p_runner));
  return true;
end;
$$;

create function public.challenges_attempt_tests(p_solution uuid)
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
begin
  select * into v_solution from public.challenges_solutions where id = p_solution;
  if v_solution.id is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_jury := private.challenges_is_jury(v_solution.event_id);
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

  return query
    select t.ordinal, t.is_sample, r.verdict, r.time_ms, r.memory_kb,
      case when v_jury or t.is_sample then left(t.input, 4000) end,
      case when v_jury or t.is_sample then left(t.answer, 4000) end,
      case when v_jury or t.is_sample then r.output_excerpt end,
      case when v_jury or t.is_sample then r.stderr_excerpt end
    from public.challenges_judging_runs r
    join public.challenges_testcases t on t.id = r.testcase_id
    where r.judging_id = v_judging
    order by t.is_sample desc, t.ordinal;
end;
$$;
grant execute on function public.challenges_attempt_tests(uuid) to authenticated;

revoke select on public.challenges_problems from anon, authenticated;
grant select (
  id, event_id, label, slug, title, statement_md, statement_pdf_path, time_limit_ms,
  memory_limit_mb, output_limit_kb, checker, checker_tolerance, checker_language, points,
  visible, sort, created_at, updated_at, difficulty
) on public.challenges_problems to authenticated;

create function public.challenges_set_testcases(p_problem uuid, p_cases jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem public.challenges_problems;
  v_count integer;
begin
  select * into v_problem from public.challenges_problems where id = p_problem;
  if v_problem.id is null or not private.challenges_is_jury(v_problem.event_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_cases) is distinct from 'array' or jsonb_array_length(p_cases) > 200 then
    raise exception 'give up to 200 test cases' using errcode = '22023';
  end if;
  delete from public.challenges_testcases where problem_id = p_problem;
  insert into public.challenges_testcases (event_id, problem_id, ordinal, is_sample, input, answer, points)
  select v_problem.event_id, p_problem, c.position::integer,
    coalesce((c.value ->> 'is_sample')::boolean, false),
    coalesce(c.value ->> 'input', ''), coalesce(c.value ->> 'answer', ''),
    nullif(c.value ->> 'points', '')::numeric
  from jsonb_array_elements(p_cases) with ordinality as c(value, position);
  get diagnostics v_count = row_count;
  perform private.audit(v_problem.event_id, 'challenges.tests_saved', 'challenges_problem', p_problem,
    jsonb_build_object('problem', v_problem.label, 'count', v_count));
  return v_count;
end;
$$;
grant execute on function public.challenges_set_testcases(uuid, jsonb) to authenticated;

create function private.challenges_audit_problem()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.challenges_problems := case when tg_op = 'DELETE' then old else new end;
begin
  if (select auth.uid()) is not null then
    perform private.audit(v_row.event_id,
      case tg_op when 'DELETE' then 'challenges.problem_removed' else 'challenges.problem_saved' end,
      'challenges_problem', v_row.id, jsonb_build_object('problem', v_row.label, 'title', v_row.title));
  end if;
  return null;
end;
$$;

create trigger challenges_problems_audit after insert or update or delete on public.challenges_problems
  for each row execute function private.challenges_audit_problem();

alter table public.challenges_problems drop constraint challenges_problems_label_check;
alter table public.challenges_problems add constraint challenges_problems_label_check
  check (label = btrim(label) and length(label) between 1 and 16 and label !~ '[\r\n]');

create function private.challenges_natural_key(p_label text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(string_agg(
    case when m.parts[1] is not null then lpad(m.parts[1], 12, '0') else lower(m.parts[2]) end,
    '' order by m.position
  ), '')
  from regexp_matches(p_label, '(\d+)|(\D+)', 'g') with ordinality as m(parts, position);
$$;
grant execute on function private.challenges_natural_key(text) to authenticated, service_role;

alter table public.challenges_problems
  add column label_key text generated always as (private.challenges_natural_key(label)) stored;

create table public.challenges_difficulties (
  event_id uuid not null references public.events on delete cascade,
  key text not null check (key ~ '^[a-z0-9][a-z0-9-]{0,31}$'),
  label text not null check (length(btrim(label)) between 1 and 40),
  tone text not null default 'gray'
    check (tone in ('gray', 'green', 'amber', 'red', 'blue', 'violet', 'pink', 'teal', 'orange')),
  sort smallint not null default 0,
  primary key (event_id, key)
);

insert into public.challenges_difficulties (event_id, key, label, tone, sort)
select distinct p.event_id, d.key, d.label, d.tone, d.sort
from public.challenges_problems p
cross join (values
  ('easy', 'Easy', 'green', 0), ('medium', 'Medium', 'amber', 1), ('hard', 'Hard', 'red', 2)
) as d(key, label, tone, sort)
where p.difficulty is not null;

alter table public.challenges_problems drop constraint challenges_problems_difficulty_check;
alter table public.challenges_problems add constraint challenges_problems_difficulty_fkey
  foreign key (event_id, difficulty) references public.challenges_difficulties (event_id, key)
  on delete set null (difficulty);
create index challenges_problems_event_id_difficulty_fk_idx on public.challenges_problems (event_id, difficulty);

alter table public.challenges_difficulties enable row level security;
create policy challenges_difficulties_select on public.challenges_difficulties for select to authenticated
  using ((select private.challenges_can_see_problems(event_id)));
create policy challenges_difficulties_jury_insert on public.challenges_difficulties for insert to authenticated
  with check ((select private.challenges_is_jury(event_id)));
create policy challenges_difficulties_jury_update on public.challenges_difficulties for update to authenticated
  using ((select private.challenges_is_jury(event_id)))
  with check ((select private.challenges_is_jury(event_id)));
create policy challenges_difficulties_jury_delete on public.challenges_difficulties for delete to authenticated
  using ((select private.challenges_is_jury(event_id)));

alter table public.challenges_solutions
  add column source_chars integer generated always as (char_length(source)) stored,
  add column source_bytes integer generated always as (octet_length(source)) stored,
  add column source_chars_no_space integer generated always as (char_length(regexp_replace(source, '\s', '', 'g'))) stored;

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
    'golfMeasure', 'characters', 'golfPoints', 'ratio', 'golfRankStep', 10
  ) || coalesce(private.event_setting(p_event, 'plugin.challenges'), '{}');
$$;

create function private.challenges_enforce_limits()
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
        raise exception 'this organization can have at most % problems in an event', v_limit
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
      raise exception 'a problem can have at most % tests for this organization', v_limit
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger challenges_problems_enforce_limits before insert or update on public.challenges_problems
  for each row execute function private.challenges_enforce_limits();
create trigger challenges_testcases_enforce_limits before insert on public.challenges_testcases
  for each row execute function private.challenges_enforce_limits();

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
  order by (
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
      'solution', jsonb_build_object('id', s.id, 'source', s.source),
      'language', to_jsonb(l),
      'problem', jsonb_build_object(
        'id', p.id, 'label', p.label,
        'time_limit_ms', least(p.time_limit_ms, coalesce(private.org_limit(o.org_id, 'challenges.maxTimeLimitMs'), p.time_limit_ms)),
        'memory_limit_mb', least(p.memory_limit_mb, coalesce(private.org_limit(o.org_id, 'challenges.maxMemoryMb'), p.memory_limit_mb)),
        'output_limit_kb', least(p.output_limit_kb, coalesce(private.org_limit(o.org_id, 'challenges.maxOutputKb'), p.output_limit_kb)),
        'checker', p.checker,
        'checker_tolerance', p.checker_tolerance, 'checker_source', p.checker_source,
        'checker_language', p.checker_language, 'points', p.points
      ),
      'scoring', private.challenges_settings(s.event_id) ->> 'scoring',
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
      select id, label, label_key, title, points, sort from public.challenges_problems
      where event_id = p_event and visible
    ),
    attempts as (
      select s.team_id, s.problem_id, s.submitted_at,
        case v_measure
          when 'bytes' then s.source_bytes
          when 'characters-no-space' then s.source_chars_no_space
          else s.source_chars
        end as length,
        case when v_frozen and s.submitted_at >= v_freeze then null else j.verdict end as verdict,
        case when v_frozen and s.submitted_at >= v_freeze then null else j.score end as score
      from public.challenges_solutions s
      join problems p on p.id = s.problem_id
      left join lateral (
        select verdict, score from public.challenges_judgings j
        where j.solution_id = s.id and j.valid and j.status in ('done', 'failed')
        order by j.finished_at desc limit 1
      ) j on true
      where s.event_id = p_event
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
          when 'golf' then rank() over (order by score desc, (solved = 0), total_length asc)
          else rank() over (order by solved desc, penalty asc)
        end as rank
      from team_rows
    ) r
  );
end;
$$;

insert into public.challenges_languages (key, name, version, image, source_file, compile_cmd, run_cmd, editor_mode, sort) values
  ('c', 'C', 'GCC 14', 'bogey-runner-gcc:14', 'main.c', 'gcc -O2 -std=c11 -o main main.c -lm', './main', 'c', 4),
  ('kotlin', 'Kotlin', '2.1', 'bogey-runner-kotlin:2.1', 'main.kt', 'kotlinc main.kt -include-runtime -d main.jar', 'java -Xss64m -jar main.jar', 'kotlin', 5),
  ('rust', 'Rust', '1.85', 'bogey-runner-rust:1.85', 'main.rs', 'rustc -O -o main main.rs', './main', 'rust', 6),
  ('go', 'Go', '1.24', 'bogey-runner-go:1.24', 'main.go', 'go build -o main main.go', './main', 'go', 7)
on conflict (key) do nothing;

alter table public.challenges_problems
  add column test_groups jsonb not null default '{}' check (jsonb_typeof(test_groups) = 'object');

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
  order by (
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
      'scoring', private.challenges_settings(s.event_id) ->> 'scoring',
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

create function public.challenges_requeue_judging(p_judging uuid, p_runner text, p_reason text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.challenges_judgings set
    status = case when attempts >= 3 then 'failed' else 'queued' end::public.challenges_judging_status,
    verdict = case when attempts >= 3 then 'JE' end::public.challenges_verdict,
    compile_output = case when attempts >= 3 then left(coalesce(p_reason, 'the runner failed'), 16000) end,
    finished_at = case when attempts >= 3 then now() end,
    runner_id = null,
    lease_expires_at = null
  where id = p_judging and runner_id = p_runner and status = 'running';
$$;

revoke execute on function public.challenges_requeue_judging(uuid, text, text) from public, anon, authenticated;
grant execute on function public.challenges_requeue_judging(uuid, text, text) to service_role;

create type public.challenges_rejudging_status as enum ('pending', 'applied', 'cancelled');

create table public.challenges_rejudgings (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  reason text not null check (length(btrim(reason)) between 1 and 300),
  status public.challenges_rejudging_status not null default 'pending',
  created_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  unique (event_id, id)
);
create index challenges_rejudgings_event_idx on public.challenges_rejudgings (event_id, created_at desc);
create index challenges_rejudgings_created_by_fk_idx on public.challenges_rejudgings (created_by);

alter table public.challenges_judgings
  add column rejudging_id uuid references public.challenges_rejudgings on delete cascade,
  add column verified_at timestamptz,
  add column verified_by uuid references public.profiles on delete set null;
create index challenges_judgings_rejudging_idx on public.challenges_judgings (rejudging_id) where rejudging_id is not null;
create index challenges_judgings_verified_by_fk_idx on public.challenges_judgings (verified_by);

alter table public.challenges_solutions alter column team_id drop not null;
alter table public.challenges_solutions
  add column jury_label text check (length(jury_label) between 1 and 80),
  add column expected_verdict public.challenges_verdict,
  add column ignored_at timestamptz,
  add column ignored_by uuid references public.profiles on delete set null,
  add column ignored_reason text check (length(ignored_reason) <= 500),
  add constraint challenges_solutions_jury_check check ((team_id is null) = (expected_verdict is not null));
create index challenges_solutions_ignored_by_fk_idx on public.challenges_solutions (ignored_by);

alter table public.challenges_rejudgings enable row level security;
create policy challenges_rejudgings_jury_select on public.challenges_rejudgings for select to authenticated
  using ((select private.challenges_is_jury(event_id)));

create function private.challenges_verification_required(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((private.challenges_settings(p_event) ->> 'verificationRequired')::boolean, false);
$$;
grant execute on function private.challenges_verification_required(uuid) to authenticated, service_role;

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
    'golfMeasure', 'characters', 'golfPoints', 'ratio', 'golfRankStep', 10,
    'verificationRequired', false
  ) || coalesce(private.event_setting(p_event, 'plugin.challenges'), '{}');
$$;
drop policy challenges_judgings_select on public.challenges_judgings;
create policy challenges_judgings_select on public.challenges_judgings for select to authenticated
  using (
    (select private.challenges_is_jury(event_id))
    or exists (
      select 1 from public.challenges_solutions s
      where s.id = solution_id and private.is_team_member(s.team_id)
        and (verified_at is not null or not private.challenges_verification_required(s.event_id))
    )
  );

create or replace function private.challenges_can_see_run(p_judging uuid, p_testcase uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.challenges_judgings j
    join public.challenges_solutions s on s.id = j.solution_id
    join public.challenges_testcases t on t.id = p_testcase
    where j.id = p_judging
      and (
        private.challenges_is_jury(j.event_id)
        or (t.is_sample and private.is_team_member(s.team_id)
          and (j.verified_at is not null or not private.challenges_verification_required(j.event_id)))
      )
  );
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
begin
  select * into v_solution from public.challenges_solutions where id = p_solution;
  if v_solution.id is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_jury := private.challenges_is_jury(v_solution.event_id);
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
      case when v_jury or t.is_sample then r.stderr_excerpt end
    from public.challenges_judging_runs r
    join public.challenges_testcases t on t.id = r.testcase_id
    where r.judging_id = v_judging
    order by t.is_sample desc, t.ordinal;
end;
$$;
create or replace function public.challenges_record_judging(
  p_judging uuid, p_runner text, p_verdict public.challenges_verdict, p_score numeric,
  p_max_time_ms integer, p_max_memory_kb integer, p_compile_output text, p_runs jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_judging public.challenges_judgings;
begin
  update public.challenges_judgings set
    status = 'done', verdict = p_verdict, score = p_score,
    max_time_ms = p_max_time_ms, max_memory_kb = p_max_memory_kb,
    compile_output = left(p_compile_output, 16000),
    finished_at = now(), lease_expires_at = null
  where id = p_judging and runner_id = p_runner and status = 'running'
  returning * into v_judging;

  if v_judging.id is null then
    return false;
  end if;

  insert into public.challenges_judging_runs
    (judging_id, testcase_id, verdict, time_ms, memory_kb, output_excerpt, stderr_excerpt)
  select p_judging, t.id, (r ->> 'verdict')::public.challenges_verdict,
    (r ->> 'time_ms')::integer, (r ->> 'memory_kb')::integer,
    left(r ->> 'output_excerpt', 4000), left(r ->> 'stderr_excerpt', 4000)
  from jsonb_array_elements(coalesce(p_runs, '[]')) as r
  join public.challenges_testcases t on t.id = (r ->> 'testcase_id')::uuid
  join public.challenges_solutions s on s.id = v_judging.solution_id and s.problem_id = t.problem_id;

  if v_judging.valid then
    update public.challenges_judgings set valid = false
    where solution_id = v_judging.solution_id and id <> v_judging.id and status = 'done';
  end if;

  perform private.audit(v_judging.event_id, 'challenges.judged', 'challenges_judging', v_judging.id,
    jsonb_build_object('verdict', p_verdict, 'runner', p_runner));
  return true;
end;
$$;
create or replace function public.challenges_override_verdict(p_judging uuid, p_verdict public.challenges_verdict, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_judging public.challenges_judgings;
begin
  select * into v_judging from public.challenges_judgings where id = p_judging;
  if v_judging.id is null or not private.challenges_is_jury(v_judging.event_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.challenges_judgings set verdict = p_verdict, status = 'done', finished_at = coalesce(finished_at, now()),
    verified_at = coalesce(verified_at, now()), verified_by = coalesce(verified_by, (select auth.uid()))
  where id = p_judging;
  perform private.audit(v_judging.event_id, 'challenges.verdict_overridden', 'challenges_judging', p_judging,
    jsonb_build_object('from', v_judging.verdict, 'to', p_verdict, 'reason', p_reason));
end;
$$;
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
      'scoring', private.challenges_settings(s.event_id) ->> 'scoring',
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
      select id, label, label_key, title, points, sort from public.challenges_problems
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
          when 'golf' then rank() over (order by score desc, (solved = 0), total_length asc)
          else rank() over (order by solved desc, penalty asc)
        end as rank
      from team_rows
    ) r
  );
end;
$$;

drop function public.challenges_rejudge(uuid, uuid, uuid, uuid);

create function public.challenges_rejudge(
  p_event uuid, p_reason text,
  p_solution uuid default null, p_problem uuid default null, p_team uuid default null, p_language text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_count integer;
begin
  if not private.challenges_is_jury(p_event) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'say why you are rejudging' using errcode = '22023';
  end if;
  insert into public.challenges_rejudgings (event_id, reason, created_by)
  values (p_event, btrim(p_reason), (select auth.uid()))
  returning id into v_id;
  insert into public.challenges_judgings (event_id, solution_id, rejudging_id, valid)
  select s.event_id, s.id, v_id, false from public.challenges_solutions s
  where s.event_id = p_event and s.team_id is not null
    and (p_solution is null or s.id = p_solution)
    and (p_problem is null or s.problem_id = p_problem)
    and (p_team is null or s.team_id = p_team)
    and (p_language is null or s.language_key = p_language);
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'no solutions match' using errcode = 'P0002';
  end if;
  perform private.audit(p_event, 'challenges.rejudging_created', 'challenges_rejudging', v_id, jsonb_build_object(
    'solution', p_solution, 'problem', p_problem, 'team', p_team, 'language', p_language,
    'count', v_count, 'reason', left(p_reason, 200)));
  return jsonb_build_object('id', v_id, 'count', v_count);
end;
$$;

create function public.challenges_rejudging_diff(p_rejudging uuid)
returns table (
  solution_id uuid, problem_id uuid, team_id uuid, language_key text, submitted_at timestamptz,
  old_verdict public.challenges_verdict, old_score numeric,
  new_verdict public.challenges_verdict, new_score numeric, new_status public.challenges_judging_status
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_event uuid;
begin
  select event_id into v_event from public.challenges_rejudgings where id = p_rejudging;
  if v_event is null or not private.challenges_is_jury(v_event) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select s.id, s.problem_id, s.team_id, s.language_key, s.submitted_at,
      cur.verdict, cur.score, nj.verdict, nj.score, nj.status
    from public.challenges_judgings nj
    join public.challenges_solutions s on s.id = nj.solution_id
    left join lateral (
      select j.verdict, j.score from public.challenges_judgings j
      where j.solution_id = s.id and j.valid and j.status in ('done', 'failed')
      order by j.finished_at desc nulls last limit 1
    ) cur on true
    where nj.rejudging_id = p_rejudging
    order by s.submitted_at;
end;
$$;

create function public.challenges_apply_rejudging(p_rejudging uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set public.challenges_rejudgings;
  v_open integer;
  v_count integer;
begin
  select * into v_set from public.challenges_rejudgings where id = p_rejudging for update;
  if v_set.id is null or not private.challenges_is_jury(v_set.event_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_set.status <> 'pending' then
    raise exception 'that rejudging is already %', v_set.status using errcode = 'P0001';
  end if;
  select count(*) into v_open from public.challenges_judgings
  where rejudging_id = p_rejudging and status in ('queued', 'running');
  if v_open > 0 then
    raise exception '% judgings are still running', v_open using errcode = 'P0001';
  end if;
  update public.challenges_judgings old set valid = false
  from public.challenges_judgings nj
  where nj.rejudging_id = p_rejudging and nj.status = 'done'
    and old.solution_id = nj.solution_id and old.id <> nj.id and old.valid;
  update public.challenges_judgings set valid = true
  where rejudging_id = p_rejudging and status = 'done';
  get diagnostics v_count = row_count;
  update public.challenges_rejudgings set status = 'applied', applied_at = now() where id = p_rejudging;
  perform private.audit(v_set.event_id, 'challenges.rejudging_applied', 'challenges_rejudging', p_rejudging,
    jsonb_build_object('count', v_count));
  return v_count;
end;
$$;

create function public.challenges_cancel_rejudging(p_rejudging uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set public.challenges_rejudgings;
begin
  select * into v_set from public.challenges_rejudgings where id = p_rejudging for update;
  if v_set.id is null or not private.challenges_is_jury(v_set.event_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_set.status <> 'pending' then
    raise exception 'that rejudging is already %', v_set.status using errcode = 'P0001';
  end if;
  delete from public.challenges_judgings where rejudging_id = p_rejudging and status = 'queued';
  update public.challenges_rejudgings set status = 'cancelled' where id = p_rejudging;
  perform private.audit(v_set.event_id, 'challenges.rejudging_cancelled', 'challenges_rejudging', p_rejudging, '{}');
end;
$$;

create function public.challenges_set_ignored(p_solution uuid, p_ignored boolean, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_solution public.challenges_solutions;
begin
  select * into v_solution from public.challenges_solutions where id = p_solution;
  if v_solution.id is null or v_solution.team_id is null or not private.challenges_is_jury(v_solution.event_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.challenges_solutions set
    ignored_at = case when p_ignored then now() end,
    ignored_by = case when p_ignored then (select auth.uid()) end,
    ignored_reason = case when p_ignored then nullif(left(btrim(coalesce(p_reason, '')), 500), '') end
  where id = p_solution;
  perform private.audit(v_solution.event_id,
    case when p_ignored then 'challenges.solution_ignored' else 'challenges.solution_unignored' end,
    'challenges_solution', p_solution, jsonb_build_object('reason', left(coalesce(p_reason, ''), 200)));
end;
$$;

create function public.challenges_verify_judgings(p_event uuid, p_judgings uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not private.challenges_is_jury(p_event) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.challenges_judgings j set verified_at = now(), verified_by = (select auth.uid())
  from public.challenges_solutions s
  where s.id = j.solution_id and j.event_id = p_event and j.verified_at is null
    and s.team_id is not null and j.status in ('done', 'failed')
    and (case when p_judgings is null then j.valid else j.id = any (p_judgings) end);
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform private.audit(p_event, 'challenges.judgings_verified', 'event', p_event, jsonb_build_object('count', v_count));
  end if;
  return v_count;
end;
$$;

create function public.challenges_add_jury_solution(
  p_problem uuid, p_language text, p_source text, p_expected public.challenges_verdict, p_label text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem public.challenges_problems;
  v_id uuid;
begin
  select * into v_problem from public.challenges_problems where id = p_problem;
  if v_problem.id is null or not private.challenges_is_jury(v_problem.event_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.challenges_languages where key = p_language and enabled) then
    raise exception 'unknown language' using errcode = '22023';
  end if;
  insert into public.challenges_solutions (event_id, problem_id, team_id, user_id, language_key, source, expected_verdict, jury_label)
  values (v_problem.event_id, p_problem, null, (select auth.uid()), p_language, p_source, p_expected,
    nullif(left(btrim(coalesce(p_label, '')), 80), ''))
  returning id into v_id;
  insert into public.challenges_judgings (event_id, solution_id) values (v_problem.event_id, v_id);
  perform private.audit(v_problem.event_id, 'challenges.jury_solution_added', 'challenges_solution', v_id,
    jsonb_build_object('problem', v_problem.label, 'expected', p_expected));
  return v_id;
end;
$$;

create function public.challenges_remove_jury_solution(p_solution uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_solution public.challenges_solutions;
begin
  select * into v_solution from public.challenges_solutions where id = p_solution;
  if v_solution.id is null or v_solution.team_id is not null or not private.challenges_is_jury(v_solution.event_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from public.challenges_solutions where id = p_solution;
  perform private.audit(v_solution.event_id, 'challenges.jury_solution_removed', 'challenges_solution', p_solution, '{}');
end;
$$;

create function public.challenges_verify_problem(p_problem uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem public.challenges_problems;
  v_count integer;
begin
  select * into v_problem from public.challenges_problems where id = p_problem;
  if v_problem.id is null or not private.challenges_is_jury(v_problem.event_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.challenges_judgings (event_id, solution_id)
  select s.event_id, s.id from public.challenges_solutions s
  where s.problem_id = p_problem and s.team_id is null;
  get diagnostics v_count = row_count;
  perform private.audit(v_problem.event_id, 'challenges.problem_verified', 'challenges_problem', p_problem,
    jsonb_build_object('problem', v_problem.label, 'solutions', v_count));
  return v_count;
end;
$$;

grant execute on function
  public.challenges_rejudge(uuid, text, uuid, uuid, uuid, text),
  public.challenges_rejudging_diff(uuid),
  public.challenges_apply_rejudging(uuid),
  public.challenges_cancel_rejudging(uuid),
  public.challenges_set_ignored(uuid, boolean, text),
  public.challenges_verify_judgings(uuid, uuid[]),
  public.challenges_add_jury_solution(uuid, text, text, public.challenges_verdict, text),
  public.challenges_remove_jury_solution(uuid),
  public.challenges_verify_problem(uuid)
to authenticated;

create function public.challenges_checker_source(p_problem uuid)
returns table (checker_source text, checker_language text, test_groups jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_problem public.challenges_problems;
begin
  select * into v_problem from public.challenges_problems where id = p_problem;
  if v_problem.id is null or not private.challenges_is_jury(v_problem.event_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query select v_problem.checker_source, v_problem.checker_language, v_problem.test_groups;
end;
$$;

create function public.challenges_log_package(p_problem uuid, p_imported boolean, p_tests integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem public.challenges_problems;
begin
  select * into v_problem from public.challenges_problems where id = p_problem;
  if v_problem.id is null or not private.challenges_is_jury(v_problem.event_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform private.audit(v_problem.event_id,
    case when p_imported then 'challenges.package_imported' else 'challenges.package_exported' end,
    'challenges_problem', p_problem,
    jsonb_build_object('problem', v_problem.label, 'tests', p_tests));
end;
$$;

create function public.challenges_log_ccs_export(p_event uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.challenges_is_jury(p_event) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform private.audit(p_event, 'challenges.ccs_exported', 'event', p_event, '{}');
end;
$$;

grant execute on function
  public.challenges_checker_source(uuid),
  public.challenges_log_package(uuid, boolean, integer),
  public.challenges_log_ccs_export(uuid)
to authenticated;

alter publication supabase_realtime add table public.challenges_rejudgings;

create table public.ctf_challenges (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  title text not null check (length(title) between 1 and 120),
  category text not null default 'misc' check (length(category) between 1 and 40),
  description_md text not null default '' check (length(description_md) <= 20000),
  scoring text not null default 'static' check (scoring in ('static', 'dynamic')),
  points_initial integer not null default 100 check (points_initial between 0 and 100000),
  points_min integer not null default 100 check (points_min between 0 and 100000),
  decay integer not null default 20 check (decay between 1 and 10000),
  visible boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  unique (event_id, id),
  check (points_min <= points_initial)
);
create index ctf_challenges_event_id_idx on public.ctf_challenges (event_id, sort);
alter table public.ctf_challenges enable row level security;
create policy ctf_challenges_select on public.ctf_challenges for select to authenticated
  using ((select private.can_manage(event_id)));

create table public.ctf_flags (
  challenge_id uuid primary key references public.ctf_challenges on delete cascade,
  flag_kind text not null check (flag_kind in ('static', 'regex')),
  flag_hash text,
  flag_regex text check (length(flag_regex) <= 500),
  case_sensitive boolean not null default true,
  check ((flag_kind = 'static' and flag_hash is not null) or (flag_kind = 'regex' and flag_regex is not null))
);
alter table public.ctf_flags enable row level security;

create table public.ctf_hints (
  event_id uuid not null,
  challenge_id uuid not null,
  ordinal smallint not null check (ordinal between 1 and 20),
  cost integer not null default 0 check (cost between 0 and 100000),
  content_md text not null check (length(content_md) between 1 and 5000),
  primary key (challenge_id, ordinal),
  foreign key (event_id, challenge_id) references public.ctf_challenges (event_id, id) on delete cascade
);
create index ctf_hints_event_id_challenge_id_fk_idx on public.ctf_hints (event_id, challenge_id);
alter table public.ctf_hints enable row level security;
create policy ctf_hints_select on public.ctf_hints for select to authenticated
  using ((select private.can_manage(event_id)));

create table public.ctf_hint_unlocks (
  event_id uuid not null,
  team_id uuid not null,
  challenge_id uuid not null,
  ordinal smallint not null,
  cost integer not null,
  unlocked_by uuid references public.profiles on delete set null,
  unlocked_at timestamptz not null default now(),
  primary key (team_id, challenge_id, ordinal),
  foreign key (event_id, team_id) references public.teams (event_id, id) on delete cascade,
  foreign key (challenge_id, ordinal) references public.ctf_hints (challenge_id, ordinal) on delete cascade
);
create index ctf_hint_unlocks_event_id_team_id_fk_idx on public.ctf_hint_unlocks (event_id, team_id);
create index ctf_hint_unlocks_challenge_id_ordinal_fk_idx on public.ctf_hint_unlocks (challenge_id, ordinal);
create index ctf_hint_unlocks_unlocked_by_fk_idx on public.ctf_hint_unlocks (unlocked_by);
alter table public.ctf_hint_unlocks enable row level security;
create policy ctf_hint_unlocks_select on public.ctf_hint_unlocks for select to authenticated
  using ((select private.can_manage(event_id)) or (select private.is_team_member(team_id)));

create table public.ctf_solves (
  event_id uuid not null,
  challenge_id uuid not null,
  team_id uuid not null,
  solved_by uuid references public.profiles on delete set null,
  solved_at timestamptz not null default now(),
  primary key (challenge_id, team_id),
  foreign key (event_id, challenge_id) references public.ctf_challenges (event_id, id) on delete cascade,
  foreign key (event_id, team_id) references public.teams (event_id, id) on delete cascade
);
create index ctf_solves_event_id_challenge_id_fk_idx on public.ctf_solves (event_id, challenge_id);
create index ctf_solves_event_id_team_id_fk_idx on public.ctf_solves (event_id, team_id);
create index ctf_solves_solved_by_fk_idx on public.ctf_solves (solved_by);
alter table public.ctf_solves enable row level security;
create policy ctf_solves_select on public.ctf_solves for select to authenticated
  using ((select private.can_manage(event_id)) or (select private.is_team_member(team_id)));

create table public.ctf_attempts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  challenge_id uuid not null,
  team_id uuid not null,
  user_id uuid references public.profiles on delete set null,
  correct boolean not null,
  created_at timestamptz not null default now(),
  foreign key (event_id, challenge_id) references public.ctf_challenges (event_id, id) on delete cascade,
  foreign key (event_id, team_id) references public.teams (event_id, id) on delete cascade
);
create index ctf_attempts_challenge_id_team_id_idx on public.ctf_attempts (challenge_id, team_id, created_at desc);
create index ctf_attempts_event_id_challenge_id_fk_idx on public.ctf_attempts (event_id, challenge_id);
create index ctf_attempts_event_id_team_id_fk_idx on public.ctf_attempts (event_id, team_id);
create index ctf_attempts_user_id_fk_idx on public.ctf_attempts (user_id);
alter table public.ctf_attempts enable row level security;
create policy ctf_attempts_select on public.ctf_attempts for select to authenticated
  using ((select private.can_manage(event_id)));

create function private.ctf_hash(p_challenge uuid, p_flag text, p_case_sensitive boolean)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_challenge::text || ':' ||
    case when p_case_sensitive then btrim(p_flag) else lower(btrim(p_flag)) end, 'UTF8')), 'hex');
$$;
revoke execute on function private.ctf_hash(uuid, text, boolean) from public, anon, authenticated;

create function private.ctf_value(p_challenge uuid, p_asof timestamptz default 'infinity')
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when c.scoring = 'static' then c.points_initial
    when s.n >= c.decay then c.points_min
    else ceil(((c.points_min - c.points_initial)::double precision / (c.decay * c.decay)) * s.n * s.n + c.points_initial)::integer
  end
  from public.ctf_challenges c
  cross join lateral (
    select greatest(count(*) - 1, 0)::double precision as n
    from public.ctf_solves v where v.challenge_id = c.id and v.solved_at <= p_asof) s
  where c.id = p_challenge;
$$;
revoke execute on function private.ctf_value(uuid, timestamptz) from public, anon, authenticated;

create function private.ctf_asof(p_event uuid)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_freeze timestamptz;
begin
  if private.can_manage(p_event) then
    return 'infinity';
  end if;
  begin
    v_freeze := nullif(private.event_setting(p_event, 'plugin.challenges') ->> 'freezeAt', '')::timestamptz;
  exception when others then
    v_freeze := null;
  end;
  return case when v_freeze is not null and now() >= v_freeze then v_freeze else 'infinity' end;
end;
$$;
revoke execute on function private.ctf_asof(uuid) from public, anon, authenticated;

create function private.ctf_assert_player(p_event uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_team uuid := private.my_team(p_event);
begin
  if not private.plugin_enabled(p_event, 'challenges') or not private.has_permission(p_event, 'event.compete') or v_team is null then
    raise exception 'join a team to play' using errcode = '42501';
  end if;
  if not private.window_open(p_event, 'challenges.contest') then
    raise exception 'the CTF isn''t open' using errcode = '42501';
  end if;
  return v_team;
end;
$$;
revoke execute on function private.ctf_assert_player(uuid) from public, anon, authenticated;

create function public.ctf_save_challenge(p_event uuid, p_id uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_kind text := p_data ->> 'flag_kind';
  v_case boolean := coalesce((p_data ->> 'case_sensitive')::boolean, true);
  v_flag text := p_data ->> 'flag';
  v_hint jsonb;
  v_ordinal smallint := 0;
begin
  if not private.plugin_enabled(p_event, 'challenges') or not private.can_manage(p_event) then
    raise exception 'only organizers can edit challenges' using errcode = '42501';
  end if;
  if v_id is null then
    if v_kind is null then
      raise exception 'a new challenge needs a flag' using errcode = '22023';
    end if;
    insert into public.ctf_challenges (event_id, title, category, description_md, scoring, points_initial, points_min, decay, visible, sort)
    values (p_event, p_data ->> 'title', coalesce(nullif(p_data ->> 'category', ''), 'misc'),
      coalesce(p_data ->> 'description_md', ''), coalesce(p_data ->> 'scoring', 'static'),
      coalesce((p_data ->> 'points_initial')::integer, 100),
      coalesce((p_data ->> 'points_min')::integer, (p_data ->> 'points_initial')::integer, 100),
      coalesce((p_data ->> 'decay')::integer, 20), coalesce((p_data ->> 'visible')::boolean, true),
      coalesce((select max(sort) + 1 from public.ctf_challenges where event_id = p_event), 0))
    returning id into v_id;
  else
    update public.ctf_challenges set
      title = coalesce(p_data ->> 'title', title),
      category = coalesce(nullif(p_data ->> 'category', ''), category),
      description_md = coalesce(p_data ->> 'description_md', description_md),
      scoring = coalesce(p_data ->> 'scoring', scoring),
      points_initial = coalesce((p_data ->> 'points_initial')::integer, points_initial),
      points_min = coalesce((p_data ->> 'points_min')::integer, points_min),
      decay = coalesce((p_data ->> 'decay')::integer, decay),
      visible = coalesce((p_data ->> 'visible')::boolean, visible)
    where id = v_id and event_id = p_event;
    if not found then
      raise exception 'that challenge is gone' using errcode = 'P0002';
    end if;
  end if;

  if v_kind is not null then
    if v_flag is null or btrim(v_flag) = '' then
      raise exception 'enter the flag' using errcode = '22023';
    end if;
    if v_kind = 'regex' then
      perform '' ~ v_flag;
      insert into public.ctf_flags (challenge_id, flag_kind, flag_regex, case_sensitive)
      values (v_id, 'regex', v_flag, v_case)
      on conflict (challenge_id) do update set flag_kind = 'regex', flag_regex = excluded.flag_regex,
        flag_hash = null, case_sensitive = excluded.case_sensitive;
    elsif v_kind = 'static' then
      insert into public.ctf_flags (challenge_id, flag_kind, flag_hash, case_sensitive)
      values (v_id, 'static', private.ctf_hash(v_id, v_flag, v_case), v_case)
      on conflict (challenge_id) do update set flag_kind = 'static', flag_hash = excluded.flag_hash,
        flag_regex = null, case_sensitive = excluded.case_sensitive;
    else
      raise exception 'flag_kind is static or regex' using errcode = '22023';
    end if;
  end if;

  if p_data ? 'hints' then
    delete from public.ctf_hints where challenge_id = v_id;
    for v_hint in select * from jsonb_array_elements(p_data -> 'hints') loop
      v_ordinal := v_ordinal + 1;
      insert into public.ctf_hints (event_id, challenge_id, ordinal, cost, content_md)
      values (p_event, v_id, v_ordinal, coalesce((v_hint ->> 'cost')::integer, 0), v_hint ->> 'content_md');
    end loop;
  end if;

  perform private.audit(p_event, 'challenges.ctf_challenge_saved', 'ctf_challenge', v_id,
    jsonb_build_object('title', p_data ->> 'title'));
  return v_id;
end;
$$;
revoke execute on function public.ctf_save_challenge(uuid, uuid, jsonb) from public, anon;
grant execute on function public.ctf_save_challenge(uuid, uuid, jsonb) to authenticated;

create function public.ctf_delete_challenge(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event uuid;
  v_title text;
begin
  select event_id, title into v_event, v_title from public.ctf_challenges where id = p_id;
  if v_event is null or not private.plugin_enabled(v_event, 'challenges') or not private.can_manage(v_event) then
    raise exception 'only organizers can delete challenges' using errcode = '42501';
  end if;
  delete from public.ctf_challenges where id = p_id;
  perform private.audit(v_event, 'challenges.ctf_challenge_deleted', 'ctf_challenge', p_id, jsonb_build_object('title', v_title));
end;
$$;
revoke execute on function public.ctf_delete_challenge(uuid) from public, anon;
grant execute on function public.ctf_delete_challenge(uuid) to authenticated;

create function public.ctf_challenges_for_team(p_event uuid)
returns table (
  id uuid, title text, category text, description_md text, points integer, solves integer,
  solved boolean, first_blood text, hints jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_team uuid := private.my_team(p_event);
  v_manager boolean := private.can_manage(p_event);
begin
  if not private.plugin_enabled(p_event, 'challenges') then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if not v_manager and (v_team is null or not private.window_open(p_event, 'challenges.contest')) then
    raise exception 'the CTF isn''t open' using errcode = '42501';
  end if;
  return query
  select c.id, c.title, c.category, c.description_md, private.ctf_value(c.id),
    (select count(*)::integer from public.ctf_solves s where s.challenge_id = c.id),
    exists (select 1 from public.ctf_solves s where s.challenge_id = c.id and s.team_id = v_team),
    (select t.name from public.ctf_solves s join public.teams t on t.id = s.team_id
     where s.challenge_id = c.id order by s.solved_at limit 1),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'ordinal', h.ordinal, 'cost', h.cost,
        'content_md', case when u.ordinal is not null or h.cost = 0 or v_manager then h.content_md end)
        order by h.ordinal)
      from public.ctf_hints h
      left join public.ctf_hint_unlocks u on u.challenge_id = h.challenge_id and u.ordinal = h.ordinal and u.team_id = v_team
      where h.challenge_id = c.id), '[]')
  from public.ctf_challenges c
  where c.event_id = p_event and (c.visible or v_manager)
  order by c.category, private.ctf_value(c.id), c.sort;
end;
$$;
revoke execute on function public.ctf_challenges_for_team(uuid) from public, anon;
grant execute on function public.ctf_challenges_for_team(uuid) to authenticated;

create function public.ctf_submit_flag(p_challenge uuid, p_flag text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chal public.ctf_challenges;
  v_flag public.ctf_flags;
  v_team uuid;
  v_limit integer;
  v_ok boolean;
begin
  select * into v_chal from public.ctf_challenges where id = p_challenge and visible;
  if v_chal.id is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  v_team := private.ctf_assert_player(v_chal.event_id);
  if length(coalesce(p_flag, '')) not between 1 and 500 then
    raise exception 'a flag is 1 to 500 characters' using errcode = '22023';
  end if;
  if exists (select 1 from public.ctf_solves where challenge_id = p_challenge and team_id = v_team) then
    return 'solved';
  end if;
  v_limit := coalesce((private.event_setting(v_chal.event_id, 'plugin.challenges') ->> 'attemptsPerMinute')::integer, 5);
  if (select count(*) from public.ctf_attempts a
      where a.challenge_id = p_challenge and a.team_id = v_team and not a.correct
        and a.created_at > now() - interval '1 minute') >= v_limit then
    raise exception 'too many wrong flags; wait a minute' using errcode = '54000';
  end if;
  select * into v_flag from public.ctf_flags where challenge_id = p_challenge;
  v_ok := case v_flag.flag_kind
    when 'static' then private.ctf_hash(p_challenge, p_flag, v_flag.case_sensitive) = v_flag.flag_hash
    when 'regex' then case when v_flag.case_sensitive then btrim(p_flag) ~ ('^(?:' || v_flag.flag_regex || ')$')
                           else btrim(p_flag) ~* ('^(?:' || v_flag.flag_regex || ')$') end
    else false
  end;
  insert into public.ctf_attempts (event_id, challenge_id, team_id, user_id, correct)
  values (v_chal.event_id, p_challenge, v_team, (select auth.uid()), coalesce(v_ok, false));
  if not coalesce(v_ok, false) then
    return 'incorrect';
  end if;
  insert into public.ctf_solves (event_id, challenge_id, team_id, solved_by)
  values (v_chal.event_id, p_challenge, v_team, (select auth.uid()))
  on conflict do nothing;
  perform private.audit(v_chal.event_id, 'challenges.ctf_solved', 'ctf_challenge', p_challenge,
    jsonb_build_object('team', v_team, 'title', v_chal.title));
  return 'correct';
end;
$$;
revoke execute on function public.ctf_submit_flag(uuid, text) from public, anon;
grant execute on function public.ctf_submit_flag(uuid, text) to authenticated;

create function public.ctf_unlock_hint(p_challenge uuid, p_ordinal smallint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chal public.ctf_challenges;
  v_hint public.ctf_hints;
  v_team uuid;
begin
  select * into v_chal from public.ctf_challenges where id = p_challenge and visible;
  if v_chal.id is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  v_team := private.ctf_assert_player(v_chal.event_id);
  select * into v_hint from public.ctf_hints where challenge_id = p_challenge and ordinal = p_ordinal;
  if v_hint.challenge_id is null then
    raise exception 'no such hint' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.ctf_hint_unlocks where team_id = v_team and challenge_id = p_challenge and ordinal = p_ordinal) then
    insert into public.ctf_hint_unlocks (event_id, team_id, challenge_id, ordinal, cost, unlocked_by)
    values (v_chal.event_id, v_team, p_challenge, p_ordinal, v_hint.cost, (select auth.uid()));
    perform private.audit(v_chal.event_id, 'challenges.ctf_hint_unlocked', 'ctf_challenge', p_challenge,
      jsonb_build_object('team', v_team, 'ordinal', p_ordinal, 'cost', v_hint.cost));
  end if;
  return v_hint.content_md;
end;
$$;
revoke execute on function public.ctf_unlock_hint(uuid, smallint) from public, anon;
grant execute on function public.ctf_unlock_hint(uuid, smallint) to authenticated;

create function public.ctf_scoreboard(p_event uuid)
returns table (rank integer, team_name text, score integer, solves integer, first_bloods integer, last_solve_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_asof timestamptz;
begin
  if not private.plugin_enabled(p_event, 'challenges') or not private.can_view_event(p_event) then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if not private.can_manage(p_event) and not private.window_open(p_event, 'challenges.scoreboard') then
    raise exception 'the scoreboard isn''t open' using errcode = '42501';
  end if;
  v_asof := private.ctf_asof(p_event);
  return query
  with solved as (
    select s.team_id, s.solved_at, private.ctf_value(s.challenge_id, v_asof) as points,
      row_number() over (partition by s.challenge_id order by s.solved_at) as place
    from public.ctf_solves s
    where s.event_id = p_event and s.solved_at <= v_asof
  ), won as (
    select team_id, sum(points)::integer as points, count(*)::integer as n,
      count(*) filter (where place = 1)::integer as bloods, max(solved_at) as last_at
    from solved group by team_id
  ), spent as (
    select u.team_id, sum(u.cost)::integer as cost
    from public.ctf_hint_unlocks u
    where u.event_id = p_event and u.unlocked_at <= v_asof group by u.team_id
  )
  select (rank() over (order by w.points - coalesce(sp.cost, 0) desc, w.last_at))::integer,
    case when private.hides_team_names(p_event) then 'Team' else t.name end,
    w.points - coalesce(sp.cost, 0), w.n, w.bloods, w.last_at
  from won w
  join public.teams t on t.id = w.team_id
  left join spent sp on sp.team_id = w.team_id
  order by 1, w.last_at;
end;
$$;
revoke execute on function public.ctf_scoreboard(uuid) from public, anon;
grant execute on function public.ctf_scoreboard(uuid) to authenticated;
