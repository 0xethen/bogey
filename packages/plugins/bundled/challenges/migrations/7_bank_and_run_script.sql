-- The problem bank, reusing problems, and run scripts.
--
-- An organization keeps problems outside any event in its bank (challenges_bank_*), sorted by
-- category. A problem is copied, never shared: using one from the bank (or another of the org's
-- contests) copies its statement, limits, scripts, tests and jury solutions into the event, so
-- editing it there can't change a contest that already ran. Saving a problem to the bank again
-- updates the bank's copy it came from. Statement PDFs and attached files stay with the event.
--
-- A run script (DOMjudge's "run" executable) is POSIX sh that runs the solution itself. The runner
-- calls it as `sh run <input> <output> <program...>` in the solution's image: it reads the test's
-- input from the first file, writes what counts as the program's output to the second, and the
-- rest of its arguments run the program. The compare script is the custom checker.

alter table public.challenges_problems
  add column if not exists run_script text check (octet_length(run_script) <= 65536),
  add column if not exists bank_problem_id uuid;
-- like checker_source, read through challenges_scripts, so participants never see it
grant select (bank_problem_id) on public.challenges_problems to authenticated;

-- ── the bank ─────────────────────────────────────────────────────────────

create table if not exists public.challenges_bank_problems (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  category text not null default '' check (length(category) <= 60 and category = btrim(category)),
  slug extensions.citext not null check (slug ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  title text not null check (length(title) between 1 and 120),
  statement_md text not null default '' check (length(statement_md) <= 100000),
  time_limit_ms integer not null default 2000 check (time_limit_ms between 100 and 60000),
  memory_limit_mb integer not null default 256 check (memory_limit_mb between 16 and 4096),
  output_limit_kb integer not null default 8192 check (output_limit_kb between 1 and 65536),
  checker public.challenges_checker not null default 'tokens',
  checker_tolerance double precision check (checker_tolerance > 0),
  checker_source text,
  checker_language text references public.challenges_languages,
  run_script text check (octet_length(run_script) <= 65536),
  points numeric(8, 2) not null default 100,
  kind text not null default 'pass_fail' check (kind in ('pass_fail', 'partial', 'shortest')),
  golf_brackets jsonb not null default '[]' check (jsonb_typeof(golf_brackets) = 'array'),
  test_groups jsonb not null default '{}' check (jsonb_typeof(test_groups) = 'object'),
  -- the event problem it was last saved from, for saving it again
  source_problem_id uuid,
  created_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, slug),
  check (checker <> 'custom' or (checker_source is not null and checker_language is not null))
);
create index if not exists challenges_bank_problems_source_idx on public.challenges_bank_problems (source_problem_id);
create index if not exists challenges_bank_problems_created_by_idx on public.challenges_bank_problems (created_by);
create index if not exists challenges_bank_problems_language_idx on public.challenges_bank_problems (checker_language);

drop trigger if exists challenges_bank_problems_touch on public.challenges_bank_problems;
create trigger challenges_bank_problems_touch before update on public.challenges_bank_problems
  for each row execute function private.touch_updated_at();

create table if not exists public.challenges_bank_testcases (
  id uuid primary key default gen_random_uuid(),
  bank_problem_id uuid not null references public.challenges_bank_problems on delete cascade,
  ordinal integer not null,
  is_sample boolean not null default false,
  group_key text,
  points numeric(8, 2),
  input text not null check (octet_length(input) <= 16 * 1024 * 1024),
  answer text not null check (octet_length(answer) <= 16 * 1024 * 1024),
  unique (bank_problem_id, ordinal)
);

create table if not exists public.challenges_bank_solutions (
  id uuid primary key default gen_random_uuid(),
  bank_problem_id uuid not null references public.challenges_bank_problems on delete cascade,
  language_key text not null references public.challenges_languages,
  source text not null check (octet_length(source) <= 256 * 1024),
  expected_verdict public.challenges_verdict not null,
  label text not null default '' check (length(label) <= 80)
);
create index if not exists challenges_bank_solutions_problem_idx on public.challenges_bank_solutions (bank_problem_id);
create index if not exists challenges_bank_solutions_language_idx on public.challenges_bank_solutions (language_key);

-- Who works on the org's bank: its admins, and the jury of any of its events.
create or replace function private.challenges_bank_editor(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_org_admin(p_org) or exists (
    select 1 from public.events e
    where e.org_id = p_org
      and private.plugin_enabled(e.id, 'challenges')
      and private.challenges_is_jury(e.id)
  );
$$;
grant execute on function private.challenges_bank_editor(uuid) to authenticated;

alter table public.challenges_bank_problems enable row level security;
alter table public.challenges_bank_testcases enable row level security;
alter table public.challenges_bank_solutions enable row level security;

drop policy if exists challenges_bank_problems_editor on public.challenges_bank_problems;
create policy challenges_bank_problems_editor on public.challenges_bank_problems for all to authenticated
  using ((select private.challenges_bank_editor(org_id)))
  with check ((select private.challenges_bank_editor(org_id)));

drop policy if exists challenges_bank_testcases_editor on public.challenges_bank_testcases;
create policy challenges_bank_testcases_editor on public.challenges_bank_testcases for all to authenticated
  using (exists (
    select 1 from public.challenges_bank_problems b
    where b.id = bank_problem_id and (select private.challenges_bank_editor(b.org_id))
  ))
  with check (exists (
    select 1 from public.challenges_bank_problems b
    where b.id = bank_problem_id and (select private.challenges_bank_editor(b.org_id))
  ));

drop policy if exists challenges_bank_solutions_editor on public.challenges_bank_solutions;
create policy challenges_bank_solutions_editor on public.challenges_bank_solutions for all to authenticated
  using (exists (
    select 1 from public.challenges_bank_problems b
    where b.id = bank_problem_id and (select private.challenges_bank_editor(b.org_id))
  ))
  with check (exists (
    select 1 from public.challenges_bank_problems b
    where b.id = bank_problem_id and (select private.challenges_bank_editor(b.org_id))
  ));

grant select, insert, update, delete on
  public.challenges_bank_problems, public.challenges_bank_testcases, public.challenges_bank_solutions
to authenticated;

-- `base`, or `base-2`, `base-3`... whichever is free in the event (or the bank, with p_org)
create or replace function private.challenges_free_slug(p_event uuid, p_org uuid, p_base text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base text := left(coalesce(nullif(p_base, ''), 'problem'), 56);
  v_slug text := v_base;
  v_n integer := 1;
begin
  loop
    exit when not (
      (p_event is not null and exists (
        select 1 from public.challenges_problems where event_id = p_event and slug = v_slug))
      or (p_org is not null and exists (
        select 1 from public.challenges_bank_problems where org_id = p_org and slug = v_slug))
    );
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;
  return v_slug;
end;
$$;

-- Copies a problem (to_jsonb of a challenges_problems or challenges_bank_problems row), its tests
-- and its jury solutions into an event under p_label. Jury solutions are judged again there.
create or replace function private.challenges_copy_into(
  p_event uuid, p_label text, p_problem jsonb, p_tests jsonb, p_solutions jsonb, p_bank uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_solution jsonb;
begin
  if exists (select 1 from public.challenges_problems where event_id = p_event and label = btrim(p_label)) then
    raise exception 'another problem already has the ID %', btrim(p_label) using errcode = '23505';
  end if;
  insert into public.challenges_problems (
    event_id, label, slug, title, statement_md, time_limit_ms, memory_limit_mb, output_limit_kb,
    checker, checker_tolerance, checker_source, checker_language, run_script, points, kind,
    golf_brackets, test_groups, sort, bank_problem_id
  ) values (
    p_event, btrim(p_label),
    private.challenges_free_slug(p_event, null, p_problem ->> 'slug'),
    p_problem ->> 'title', coalesce(p_problem ->> 'statement_md', ''),
    (p_problem ->> 'time_limit_ms')::integer, (p_problem ->> 'memory_limit_mb')::integer,
    (p_problem ->> 'output_limit_kb')::integer,
    (p_problem ->> 'checker')::public.challenges_checker, (p_problem ->> 'checker_tolerance')::double precision,
    p_problem ->> 'checker_source', p_problem ->> 'checker_language', p_problem ->> 'run_script',
    (p_problem ->> 'points')::numeric, p_problem ->> 'kind',
    coalesce(p_problem -> 'golf_brackets', '[]'), coalesce(p_problem -> 'test_groups', '{}'),
    coalesce((select max(sort) + 1 from public.challenges_problems where event_id = p_event), 0),
    p_bank
  ) returning id into v_id;

  insert into public.challenges_testcases (event_id, problem_id, ordinal, is_sample, group_key, points, input, answer)
  select p_event, v_id, (t ->> 'ordinal')::integer, (t ->> 'is_sample')::boolean, t ->> 'group_key',
    (t ->> 'points')::numeric, t ->> 'input', t ->> 'answer'
  from jsonb_array_elements(coalesce(p_tests, '[]')) t;

  for v_solution in select * from jsonb_array_elements(coalesce(p_solutions, '[]')) loop
    if exists (select 1 from public.challenges_languages where key = v_solution ->> 'language_key' and enabled) then
      perform public.challenges_add_jury_solution(v_id, v_solution ->> 'language_key',
        v_solution ->> 'source', (v_solution ->> 'expected_verdict')::public.challenges_verdict,
        v_solution ->> 'label');
    end if;
  end loop;
  return v_id;
end;
$$;

-- An event problem's jury solutions, as the copier takes them
create or replace function private.challenges_jury_solutions_of(p_problem uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'language_key', s.language_key, 'source', s.source,
    'expected_verdict', s.expected_verdict, 'label', coalesce(s.jury_label, '')
  ) order by s.submitted_at), '[]')
  from public.challenges_solutions s
  where s.problem_id = p_problem and s.team_id is null and s.expected_verdict is not null;
$$;

-- Saves an event's problem to its org's bank: a new entry, or the one it was saved to before.
create or replace function public.challenges_bank_save(p_problem uuid, p_category text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem public.challenges_problems;
  v_org uuid;
  v_id uuid;
begin
  select * into v_problem from public.challenges_problems where id = p_problem;
  if v_problem.id is null or not private.challenges_is_jury(v_problem.event_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_org := private.event_org(v_problem.event_id);
  select id into v_id from public.challenges_bank_problems
  where org_id = v_org and id = v_problem.bank_problem_id;
  if v_id is null then
    select id into v_id from public.challenges_bank_problems
    where org_id = v_org and source_problem_id = p_problem;
  end if;

  if v_id is null then
    insert into public.challenges_bank_problems (org_id, category, slug, title, created_by)
    values (v_org, btrim(coalesce(p_category, '')),
      private.challenges_free_slug(null, v_org, v_problem.slug), v_problem.title, (select auth.uid()))
    returning id into v_id;
  end if;
  update public.challenges_bank_problems set
    category = coalesce(btrim(p_category), category),
    title = v_problem.title, statement_md = v_problem.statement_md,
    time_limit_ms = v_problem.time_limit_ms, memory_limit_mb = v_problem.memory_limit_mb,
    output_limit_kb = v_problem.output_limit_kb, checker = v_problem.checker,
    checker_tolerance = v_problem.checker_tolerance, checker_source = v_problem.checker_source,
    checker_language = v_problem.checker_language, run_script = v_problem.run_script,
    points = v_problem.points, kind = v_problem.kind, golf_brackets = v_problem.golf_brackets,
    test_groups = v_problem.test_groups, source_problem_id = p_problem
  where id = v_id;

  delete from public.challenges_bank_testcases where bank_problem_id = v_id;
  insert into public.challenges_bank_testcases (bank_problem_id, ordinal, is_sample, group_key, points, input, answer)
  select v_id, t.ordinal, t.is_sample, t.group_key, t.points, t.input, t.answer
  from public.challenges_testcases t where t.problem_id = p_problem;

  delete from public.challenges_bank_solutions where bank_problem_id = v_id;
  insert into public.challenges_bank_solutions (bank_problem_id, language_key, source, expected_verdict, label)
  select v_id, s.language_key, s.source, s.expected_verdict, coalesce(s.jury_label, '')
  from public.challenges_solutions s
  where s.problem_id = p_problem and s.team_id is null and s.expected_verdict is not null;

  update public.challenges_problems set bank_problem_id = v_id where id = p_problem;
  perform private.audit(v_problem.event_id, 'challenges.problem_banked', 'challenges_problem', p_problem,
    jsonb_build_object('problem', v_problem.label, 'bank', v_id));
  return v_id;
end;
$$;

-- Puts a copy of a bank problem in an event of the same org, under p_label.
create or replace function public.challenges_bank_use(p_bank uuid, p_event uuid, p_label text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bank public.challenges_bank_problems;
  v_id uuid;
begin
  select * into v_bank from public.challenges_bank_problems where id = p_bank;
  if v_bank.id is null or not private.challenges_is_jury(p_event)
     or v_bank.org_id is distinct from private.event_org(p_event) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_id := private.challenges_copy_into(p_event, p_label, to_jsonb(v_bank),
    (select coalesce(jsonb_agg(to_jsonb(t) order by t.ordinal), '[]')
     from public.challenges_bank_testcases t where t.bank_problem_id = p_bank),
    (select coalesce(jsonb_agg(to_jsonb(s)), '[]')
     from public.challenges_bank_solutions s where s.bank_problem_id = p_bank),
    p_bank);
  perform private.audit(p_event, 'challenges.problem_reused', 'challenges_problem', v_id,
    jsonb_build_object('problem', btrim(p_label), 'bank', p_bank));
  return v_id;
end;
$$;

-- Puts a copy of one contest's problem in another of the same org's events, under p_label.
create or replace function public.challenges_problem_copy(p_problem uuid, p_event uuid, p_label text)
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
  if v_problem.id is null or not private.challenges_is_jury(v_problem.event_id)
     or not private.challenges_is_jury(p_event)
     or private.event_org(v_problem.event_id) is distinct from private.event_org(p_event) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_id := private.challenges_copy_into(p_event, p_label, to_jsonb(v_problem),
    (select coalesce(jsonb_agg(to_jsonb(t) order by t.ordinal), '[]')
     from public.challenges_testcases t where t.problem_id = p_problem),
    private.challenges_jury_solutions_of(p_problem),
    v_problem.bank_problem_id);
  perform private.audit(p_event, 'challenges.problem_reused', 'challenges_problem', v_id,
    jsonb_build_object('problem', btrim(p_label), 'from', p_problem));
  return v_id;
end;
$$;

-- The org's other events with challenges whose jury the caller is on, to copy a problem into
create or replace function public.challenges_jury_events(p_org uuid)
returns table (id uuid, slug text, name text, starts_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.slug::text, e.name, e.starts_at
  from public.events e
  where e.org_id = p_org
    and private.plugin_enabled(e.id, 'challenges')
    and private.challenges_is_jury(e.id)
  order by e.starts_at desc nulls last, e.name;
$$;

-- The scripts that aren't selectable by browsers, for the jury's editor
create or replace function public.challenges_scripts(p_problem uuid)
returns jsonb
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
  return jsonb_build_object(
    'checker_source', v_problem.checker_source,
    'checker_language', v_problem.checker_language,
    'run_script', v_problem.run_script
  );
end;
$$;

grant execute on function
  public.challenges_bank_save(uuid, text),
  public.challenges_bank_use(uuid, uuid, text),
  public.challenges_problem_copy(uuid, uuid, text),
  public.challenges_jury_events(uuid),
  public.challenges_scripts(uuid)
to authenticated;

-- ── the runner gets the run script with its claim ───────────────────────

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
        'run_script', p.run_script,
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
