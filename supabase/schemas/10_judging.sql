create table public.judging_rounds (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  form_id uuid not null,
  ordinal smallint not null check (ordinal between 1 and 20),
  name text not null check (length(name) between 1 and 60),
  window_key text,
  method text not null default 'rubric' check (method = 'rubric' or method ~ '^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$'),
  -- how judges meet the entries: 'online' (each judge reviews their assigned projects on their own),
  -- 'demos' (teams present in turn to panels of judges, who score as they go) or 'offline' (judging
  -- happens outside Bogey and organizers enter each entry's score)
  format text not null default 'online' check (format in ('online', 'demos', 'offline')),
  created_at timestamptz not null default now(),
  unique (event_id, id),
  unique (form_id, ordinal),
  foreign key (event_id, form_id) references public.submission_forms (event_id, id) on delete cascade
);
create index judging_rounds_event_id_form_id_fk_idx on public.judging_rounds (event_id, form_id);

create table public.round_entries (
  event_id uuid not null,
  round_id uuid not null,
  submission_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (round_id, submission_id),
  foreign key (event_id, round_id) references public.judging_rounds (event_id, id) on delete cascade,
  foreign key (event_id, submission_id) references public.submissions (event_id, id) on delete cascade
);
create index round_entries_event_id_round_id_fk_idx on public.round_entries (event_id, round_id);
create index round_entries_event_id_submission_id_fk_idx on public.round_entries (event_id, submission_id);

create table public.ranking_inputs (
  event_id uuid not null,
  round_id uuid not null,
  submission_id uuid not null,
  -- a plugin's method, or 'offline' for the scores organizers enter for an offline round
  provider text not null check (provider = 'offline' or provider ~ '^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$'),
  score numeric not null,
  detail jsonb not null default '{}' check (jsonb_typeof(detail) = 'object' and pg_column_size(detail) <= 4096),
  updated_at timestamptz not null default now(),
  primary key (round_id, submission_id),
  foreign key (event_id, round_id) references public.judging_rounds (event_id, id) on delete cascade,
  foreign key (event_id, submission_id) references public.submissions (event_id, id) on delete cascade
);
create index ranking_inputs_event_id_round_id_fk_idx on public.ranking_inputs (event_id, round_id);
create index ranking_inputs_event_id_submission_id_fk_idx on public.ranking_inputs (event_id, submission_id);
alter table public.ranking_inputs enable row level security;
create policy ranking_inputs_select on public.ranking_inputs for select to authenticated
  using ((select private.can_manage(event_id)));

create function private.check_round_method()
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
create trigger judging_rounds_method before update on public.judging_rounds
  for each row execute function private.check_round_method();

create function private.set_ranking_input(
  p_round uuid, p_submission uuid, p_provider text, p_score numeric, p_detail jsonb default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.judging_rounds;
begin
  select * into v_round from public.judging_rounds where id = p_round;
  if v_round.id is null or v_round.method is distinct from p_provider then
    raise exception 'that round does not rank with %', p_provider using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.submissions s
    where s.id = p_submission and s.event_id = v_round.event_id and s.form_id = v_round.form_id
      and s.status = 'submitted'
      and (v_round.ordinal = 1 or exists (
        select 1 from public.round_entries e where e.round_id = p_round and e.submission_id = s.id))
  ) then
    raise exception 'that entry is not in this round' using errcode = '22023';
  end if;
  insert into public.ranking_inputs (event_id, round_id, submission_id, provider, score, detail)
  values (v_round.event_id, p_round, p_submission, p_provider, p_score, coalesce(p_detail, '{}'))
  on conflict (round_id, submission_id) do update set
    provider = excluded.provider, score = excluded.score, detail = excluded.detail, updated_at = now();
end;
$$;
revoke execute on function private.set_ranking_input(uuid, uuid, text, numeric, jsonb) from anon, authenticated;

create function private.add_first_round()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.judging_rounds (event_id, form_id, ordinal, name)
  values (new.event_id, new.id, 1, 'Round 1');
  return new;
end;
$$;
create trigger submission_forms_first_round after insert on public.submission_forms
  for each row execute function private.add_first_round();

create function private.active_round(p_submission uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select r.id
  from public.submissions s
  join public.judging_rounds r on r.form_id = s.form_id
  where s.id = p_submission
    and (r.ordinal = 1 or exists (
      select 1 from public.round_entries e where e.round_id = r.id and e.submission_id = s.id))
  order by r.ordinal desc
  limit 1;
$$;

create function private.round_window_open(p_round uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select private.window_open(r.event_id, coalesce(r.window_key, 'judging'))
     from public.judging_rounds r where r.id = p_round),
    false);
$$;
grant execute on function private.active_round(uuid), private.round_window_open(uuid) to authenticated;

create function private.set_judging_round()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.round_id := private.active_round(new.submission_id);
    if new.round_id is null then
      raise exception 'that submission is not in a judged form' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

-- a named set of criteria for one kind of project (a theme); criteria without one count for every project
create table public.rubrics (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  name text not null check (length(name) between 1 and 60),
  description_md text not null default '' check (length(description_md) <= 2000),
  sort smallint not null default 0,
  unique (event_id, name),
  unique (event_id, id)
);

create table public.criteria (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  label text not null check (length(label) between 1 and 80),
  description_md text not null default '',
  min_score smallint not null default 0,
  max_score smallint not null default 10 check (max_score between 1 and 100),
  weight numeric(5, 2) not null default 1 check (weight > 0),
  sort smallint not null default 0,
  round_id uuid,
  rubric_id uuid,
  check (min_score >= 0 and min_score < max_score),
  unique (event_id, label),
  unique (event_id, id),
  foreign key (event_id, round_id) references public.judging_rounds (event_id, id) on delete set null (round_id),
  foreign key (event_id, rubric_id) references public.rubrics (event_id, id) on delete cascade
);
create index criteria_event_id_round_id_fk_idx on public.criteria (event_id, round_id);
create index criteria_event_id_rubric_id_fk_idx on public.criteria (event_id, rubric_id);

-- which rubric a project is judged on, picked by its team or its judges (judging.teamRubric, judging.judgeRubric)
create table public.submission_rubrics (
  event_id uuid not null,
  submission_id uuid primary key,
  rubric_id uuid not null,
  set_by uuid references public.profiles on delete set null,
  updated_at timestamptz not null default now(),
  foreign key (event_id, submission_id) references public.submissions (event_id, id) on delete cascade,
  foreign key (event_id, rubric_id) references public.rubrics (event_id, id) on delete cascade
);
create index submission_rubrics_event_id_rubric_id_fk_idx on public.submission_rubrics (event_id, rubric_id);
create index submission_rubrics_set_by_fk_idx on public.submission_rubrics (set_by);

create table public.judge_assignments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  judge_id uuid not null,
  submission_id uuid not null,
  status public.assignment_status not null default 'assigned',
  round_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (judge_id, submission_id, round_id),
  foreign key (event_id, judge_id) references public.event_members (event_id, user_id) on delete cascade,
  foreign key (event_id, submission_id) references public.submissions (event_id, id) on delete cascade,
  foreign key (event_id, round_id) references public.judging_rounds (event_id, id) on delete cascade
);
create index judge_assignments_submission_idx on public.judge_assignments (submission_id);
create trigger judge_assignments_round before insert on public.judge_assignments
  for each row execute function private.set_judging_round();

create trigger judge_assignments_touch before update on public.judge_assignments
  for each row execute function private.touch_updated_at();

create table public.scores (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  submission_id uuid not null,
  judge_id uuid not null,
  criterion_id uuid not null,
  value numeric(6, 2) not null,
  round_id uuid not null,
  updated_at timestamptz not null default now(),
  unique (judge_id, submission_id, criterion_id, round_id),
  foreign key (event_id, round_id) references public.judging_rounds (event_id, id) on delete cascade,
  foreign key (event_id, submission_id) references public.submissions (event_id, id) on delete cascade,
  foreign key (event_id, criterion_id) references public.criteria (event_id, id) on delete cascade,
  foreign key (event_id, judge_id) references public.event_members (event_id, user_id) on delete cascade
);
create index scores_submission_idx on public.scores (submission_id);
create trigger scores_round before insert on public.scores
  for each row execute function private.set_judging_round();

create function private.prepare_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_min smallint;
  v_max smallint;
begin
  if (select auth.uid()) is not null and not private.can_manage(new.event_id) then
    new.judge_id := (select auth.uid());
  end if;
  select min_score, max_score into v_min, v_max from public.criteria where id = new.criterion_id;
  if new.value < v_min or new.value > v_max then
    raise exception 'score must be between % and %', v_min, v_max using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger scores_prepare before insert or update on public.scores
  for each row execute function private.prepare_score();

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  submission_id uuid not null,
  judge_id uuid not null,
  body_md text not null check (length(body_md) between 1 and 10000),
  visibility public.feedback_visibility not null default 'judges',
  round_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (event_id, submission_id) references public.submissions (event_id, id) on delete cascade,
  foreign key (event_id, judge_id) references public.event_members (event_id, user_id) on delete cascade,
  foreign key (event_id, round_id) references public.judging_rounds (event_id, id) on delete cascade
);
create index feedback_submission_idx on public.feedback (submission_id);
create trigger feedback_round before insert on public.feedback
  for each row execute function private.set_judging_round();

create trigger feedback_touch before update on public.feedback
  for each row execute function private.touch_updated_at();

create table public.judge_conflicts (
  event_id uuid not null,
  judge_id uuid not null,
  team_id uuid not null,
  reason text not null default '' check (length(reason) <= 500),
  declared_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  primary key (judge_id, team_id),
  foreign key (event_id, judge_id) references public.event_members (event_id, user_id) on delete cascade,
  foreign key (event_id, team_id) references public.teams (event_id, id) on delete cascade
);
create index judge_conflicts_event_id_judge_id_fk_idx on public.judge_conflicts (event_id, judge_id);
create index judge_conflicts_event_id_team_id_fk_idx on public.judge_conflicts (event_id, team_id);
create index judge_conflicts_declared_by_fk_idx on public.judge_conflicts (declared_by);

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

create function private.has_conflict(p_judge uuid, p_submission uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.judge_conflicts c
    join public.submissions s on s.team_id = c.team_id
    where c.judge_id = p_judge and s.id = p_submission);
$$;
grant execute on function private.has_conflict(uuid, uuid) to authenticated;

create table public.awards (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  form_id uuid,
  track_id uuid,
  division_id uuid,
  kind text not null check (kind in ('overall', 'division', 'track', 'popular', 'special')),
  label text not null check (length(label) between 1 and 120),
  place smallint check (place between 1 and 50),
  submission_id uuid not null,
  note_md text not null default '' check (length(note_md) <= 1000),
  sort smallint not null default 0,
  created_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  unique (event_id, id),
  foreign key (event_id, submission_id) references public.submissions (event_id, id) on delete cascade,
  foreign key (event_id, form_id) references public.submission_forms (event_id, id) on delete cascade,
  foreign key (event_id, track_id) references public.tracks (event_id, id) on delete cascade,
  foreign key (event_id, division_id) references public.divisions (event_id, id) on delete cascade
);
create index awards_event_sort_idx on public.awards (event_id, sort);
create index awards_event_id_submission_id_fk_idx on public.awards (event_id, submission_id);
create index awards_event_id_form_id_fk_idx on public.awards (event_id, form_id);
create index awards_event_id_track_id_fk_idx on public.awards (event_id, track_id);
create index awards_event_id_division_id_fk_idx on public.awards (event_id, division_id);
create index awards_created_by_fk_idx on public.awards (created_by);

create table public.result_publications (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  rows jsonb not null check (jsonb_typeof(rows) = 'array'),
  awards jsonb not null default '[]' check (jsonb_typeof(awards) = 'array'),
  published_by uuid references public.profiles on delete set null,
  published_at timestamptz not null default now()
);
create index result_publications_event_idx on public.result_publications (event_id, published_at desc);

create function private.latest_publication(p_event uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.result_publications where event_id = p_event order by published_at desc limit 1;
$$;
grant execute on function private.latest_publication(uuid) to anon, authenticated;

create function private.rank_submissions(p_event uuid)
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

create function public.preview_results(p_event uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_manage(p_event) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return private.rank_submissions(p_event);
end;
$$;

-- what the projects spreadsheet may include for the caller: 'all' for organizers, and for judges what
-- judging.judgeExport allows ('off', 'projects' or 'results')
create function private.project_export_access(p_event uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.can_manage(p_event) then 'all'
    when private.has_permission(p_event, 'judging.score')
      then coalesce(private.event_setting(p_event, 'judging') ->> 'judgeExport', 'off')
    else 'off'
  end;
$$;
grant execute on function private.project_export_access(uuid) to authenticated;

create function public.project_export_access(p_event uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select private.project_export_access(p_event);
$$;

-- each project's latest round for the spreadsheet: rank, score and its average per criterion, without
-- team names (blind judging still hides those from judges)
create function public.project_export_results(p_event uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.project_export_access(p_event) not in ('results', 'all') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return (
    with latest as (
      select distinct on (r ->> 'submission_id') r
      from jsonb_array_elements(private.rank_submissions(p_event)) r
      order by r ->> 'submission_id', (r ->> 'round_ordinal')::int desc
    ),
    means as (
      select sc.submission_id, sc.round_id,
        jsonb_object_agg(sc.criterion_id, sc.mean) as criteria
      from (
        select s.submission_id, s.round_id, s.criterion_id, round(avg(s.value), 2) as mean
        from public.scores s
        join public.submissions sub on sub.id = s.submission_id
        where s.event_id = p_event
          and not exists (select 1 from public.judge_conflicts jc
                          where jc.judge_id = s.judge_id and jc.team_id = sub.team_id)
        group by s.submission_id, s.round_id, s.criterion_id
      ) sc
      group by sc.submission_id, sc.round_id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'submission_id', l.r ->> 'submission_id',
      'round_name', l.r ->> 'round_name',
      'rank', l.r -> 'rank',
      'division_rank', l.r -> 'division_rank',
      'score', l.r -> 'score',
      'raw_score', l.r -> 'raw_score',
      'judges', l.r -> 'judges',
      'criteria', coalesce(m.criteria, '{}')
    )), '[]')
    from latest l
    left join means m on m.submission_id = (l.r ->> 'submission_id')::uuid
      and m.round_id = (l.r ->> 'round_id')::uuid
  );
end;
$$;

create function private.submission_blurb(p_submission uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select left(btrim(s.answers ->> i.key), 160)
  from public.submissions s
  join public.submission_items i on i.form_id = s.form_id and i.kind in ('text', 'longtext', 'markdown')
  where s.id = p_submission and coalesce(btrim(s.answers ->> i.key), '') <> ''
  order by i.sort
  limit 1;
$$;
revoke execute on function private.submission_blurb(uuid) from anon, authenticated;

create function private.awards_snapshot(p_event uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'kind', a.kind, 'label', a.label, 'place', a.place, 'note_md', a.note_md,
    'form_id', a.form_id, 'track_id', a.track_id, 'division_id', a.division_id,
    'submission_id', a.submission_id, 'title', s.title,
    'team_id', s.team_id, 'team_name', t.name,
    'blurb', private.submission_blurb(s.id),
    'sponsor_name', k.sponsor_name, 'sponsor_logo_url', k.sponsor_logo_url, 'prize_md', k.prize_md
  ) order by a.sort), '[]')
  from public.awards a
  join public.submissions s on s.id = a.submission_id
  join public.teams t on t.id = s.team_id
  left join public.tracks k on k.id = a.track_id
  where a.event_id = p_event;
$$;
revoke execute on function private.awards_snapshot(uuid) from anon, authenticated;

create function public.publish_results(p_event uuid)
returns public.result_publications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.result_publications;
  v_first boolean;
  v_slug text;
  v_person uuid;
  v_won text;
begin
  if not private.can_manage(p_event) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if coalesce((private.event_setting(p_event, 'judging') ->> 'holdFlagged')::boolean, true)
    and exists (select 1 from public.judging_flags where event_id = p_event and resolved_at is null) then
    raise exception 'resolve the flagged projects before publishing' using errcode = '55000';
  end if;
  v_first := not exists (select 1 from public.result_publications where event_id = p_event);
  insert into public.result_publications (event_id, rows, awards, published_by)
  values (
    p_event,
    case when private.event_setting(p_event, 'judging') ->> 'showRankings' = 'everyone'
      then private.rank_submissions(p_event) else '[]'::jsonb end,
    private.awards_snapshot(p_event),
    (select auth.uid()))
  returning * into v_row;
  perform private.audit(p_event, 'results.published', 'result_publication', v_row.id,
    jsonb_build_object('awards', jsonb_array_length(v_row.awards)));

  if v_first then
    select slug into v_slug from public.events where id = p_event;
    for v_person in
      select user_id from public.event_members
      where event_id = p_event and role = 'participant' and status = 'active'
    loop
      select string_agg(a.label, ', ' order by a.sort) into v_won
      from public.awards a
      join public.submissions s on s.id = a.submission_id
      join public.team_members tm on tm.team_id = s.team_id and tm.user_id = v_person
      where a.event_id = p_event;
      perform private.notify(array[v_person], p_event, 'results.published',
        'Results are in',
        case when v_won is null then '' else 'Your team won: ' || v_won end,
        '/events/' || v_slug || '/results',
        jsonb_build_object('award', case when v_won is null then '' else 'Your team won: ' || v_won || '.' end));
    end loop;
  end if;
  return v_row;
end;
$$;

create function public.save_awards(p_event uuid, p_items jsonb)
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
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 200 then
    raise exception 'awards are an array of up to 200' using errcode = '22023';
  end if;
  delete from public.awards
  where event_id = p_event
    and id not in (
      select (item ->> 'id')::uuid from jsonb_array_elements(p_items) item where item ->> 'id' is not null
    );
  get diagnostics v_removed = row_count;

  insert into public.awards (
    id, event_id, kind, label, place, submission_id, form_id, track_id, division_id, note_md, sort, created_by
  )
  select coalesce((item ->> 'id')::uuid, gen_random_uuid()), p_event, item ->> 'kind', btrim(item ->> 'label'),
    nullif(item ->> 'place', '')::smallint, (item ->> 'submission_id')::uuid,
    nullif(item ->> 'form_id', '')::uuid, nullif(item ->> 'track_id', '')::uuid,
    nullif(item ->> 'division_id', '')::uuid, coalesce(item ->> 'note_md', ''),
    (ordinality - 1)::smallint, (select auth.uid())
  from jsonb_array_elements(p_items) with ordinality as t(item, ordinality)
  on conflict (id) do update set
    kind = excluded.kind, label = excluded.label, place = excluded.place,
    submission_id = excluded.submission_id, form_id = excluded.form_id, track_id = excluded.track_id,
    division_id = excluded.division_id, note_md = excluded.note_md, sort = excluded.sort;

  perform private.audit(p_event, 'results.awards_saved', 'event', p_event,
    jsonb_build_object('count', jsonb_array_length(p_items), 'removed', v_removed));
  return v_removed;
end;
$$;

-- Tops every entry up to p_per_submission judges, least-loaded first. The event's
-- judging.assignment rules come first: each asks for judges holding a tag (one Adult Judge, one
-- Student Judge), optionally only in one division. A rule that isn't strict stops at an even share
-- of the work and lets anyone take the slot; a strict one doubles judges up instead, and fails if
-- no one with the tag can take an entry. Judges holding an excluded tag are left out.
create function public.assign_round_robin(
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

create function public.declare_conflict(p_submission uuid, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.submissions;
  v_judge uuid := (select auth.uid());
begin
  select * into v_sub from public.submissions where id = p_submission;
  if v_sub.id is null or not private.has_permission(v_sub.event_id, 'judging.score') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform private.add_conflict(v_sub.event_id, v_judge, v_sub.team_id, p_reason);
end;
$$;

create function private.add_conflict(p_event uuid, p_judge uuid, p_team uuid, p_reason text)
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
revoke execute on function private.add_conflict(uuid, uuid, uuid, text) from anon, authenticated;

create function public.set_conflicts(p_event uuid, p_items jsonb)
returns table (recorded integer, unmatched jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_judge uuid;
  v_team uuid;
  v_count integer := 0;
  v_missed jsonb := '[]';
begin
  if not private.can_manage(p_event) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 500 then
    raise exception 'conflicts are an array of up to 500' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_judge := coalesce(
      nullif(v_item ->> 'judge_id', '')::uuid,
      (select m.user_id from public.event_members m join auth.users u on u.id = m.user_id
       where m.event_id = p_event and m.role = 'judge' and lower(u.email) = lower(btrim(v_item ->> 'email'))));
    v_team := coalesce(
      nullif(v_item ->> 'team_id', '')::uuid,
      (select t.id from public.teams t where t.event_id = p_event and lower(t.name) = lower(btrim(v_item ->> 'team'))));
    if v_judge is null or v_team is null
       or not exists (select 1 from public.event_members m where m.event_id = p_event and m.user_id = v_judge and m.role = 'judge')
       or not exists (select 1 from public.teams t where t.event_id = p_event and t.id = v_team) then
      v_missed := v_missed || jsonb_build_array(v_item);
      continue;
    end if;
    perform private.add_conflict(p_event, v_judge, v_team, v_item ->> 'reason');
    v_count := v_count + 1;
  end loop;
  return query select v_count, v_missed;
end;
$$;

create function public.remove_conflict(p_event uuid, p_judge uuid, p_team uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can_manage(p_event) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from public.judge_conflicts where event_id = p_event and judge_id = p_judge and team_id = p_team;
  if found then
    perform private.audit(p_event, 'judging.conflict_removed', 'team', p_team, jsonb_build_object('judge', p_judge));
  end if;
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

create function public.judge_calibration(p_event uuid, p_round uuid default null)
returns table (judge_id uuid, name text, scores bigint, entries bigint, mean_pct numeric, sd_pct numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_manage(p_event) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
  select sc.judge_id, coalesce(p.display_name, 'Judge'), count(*),
    count(distinct sc.submission_id),
    round(100 * avg((sc.value - c.min_score) / (c.max_score - c.min_score)), 1),
    round(100 * coalesce(stddev_pop((sc.value - c.min_score) / (c.max_score - c.min_score)), 0), 1)
  from public.scores sc
  join public.criteria c on c.id = sc.criterion_id
  join public.submissions s on s.id = sc.submission_id
  left join public.profiles p on p.id = sc.judge_id
  where sc.event_id = p_event
    and (p_round is null or sc.round_id = p_round)
    and not exists (select 1 from public.judge_conflicts jc where jc.judge_id = sc.judge_id and jc.team_id = s.team_id)
  group by sc.judge_id, p.display_name
  order by 2;
end;
$$;

create function public.team_scores(p_submission uuid)
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
    and (c.rubric_id is null
      or c.rubric_id = (select x.rubric_id from public.submission_rubrics x where x.submission_id = p_submission))
    and not exists (select 1 from public.judge_conflicts jc where jc.judge_id = sc.judge_id and jc.team_id = v_sub.team_id)
  group by r.name, r.ordinal, c.label, c.min_score, c.max_score, c.sort
  order by r.ordinal, c.sort;
end;
$$;

create function public.assign_tables(
  p_form uuid, p_scheme text default 'numeric', p_start integer default 1,
  p_prefix text default '', p_group text default 'none', p_replace boolean default false
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event uuid;
  v_n integer := p_start;
  v_sub record;
  v_count integer := 0;
begin
  select event_id into v_event from public.submission_forms where id = p_form;
  if v_event is null or not private.can_manage(v_event) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_scheme not in ('numeric', 'prefix') or p_group not in ('none', 'division', 'track') then
    raise exception 'unknown numbering' using errcode = '22023';
  end if;
  if p_scheme = 'prefix' and length(btrim(p_prefix)) not between 1 and 10 then
    raise exception 'give a prefix of up to 10 characters' using errcode = '22023';
  end if;
  if p_start < 0 or p_start > 9999 then
    raise exception 'start between 0 and 9999' using errcode = '22023';
  end if;

  for v_sub in
    select s.id, s.table_label
    from public.submissions s
    join public.teams t on t.id = s.team_id
    left join public.divisions d on d.id = t.division_id
    where s.form_id = p_form and s.status = 'submitted'
    order by
      case p_group
        when 'division' then coalesce(lpad(d.sort::text, 5, '0') || d.name, '~')
        when 'track' then coalesce((
          select lpad(k.sort::text, 5, '0') || k.name from public.submission_tracks l
          join public.tracks k on k.id = l.track_id
          where l.submission_id = s.id order by k.sort, k.name limit 1), '~')
        else ''
      end,
      t.name, s.id
  loop
    if v_sub.table_label is null or p_replace then
      update public.submissions
      set table_label = case p_scheme when 'prefix' then btrim(p_prefix) || v_n else v_n::text end
      where id = v_sub.id;
      v_count := v_count + 1;
    end if;
    v_n := v_n + 1;
  end loop;
  perform private.audit(v_event, 'judging.tables_assigned', 'submission_form', p_form,
    jsonb_build_object('count', v_count, 'scheme', p_scheme, 'group', p_group));
  return v_count;
end;
$$;

create function public.skip_submission(p_submission uuid, p_skipped boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.submissions;
  v_round uuid;
begin
  select * into v_sub from public.submissions where id = p_submission;
  if v_sub.id is null or not private.has_permission(v_sub.event_id, 'judging.score') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_round := private.active_round(p_submission);
  if v_round is null or not private.round_window_open(v_round) then
    raise exception 'judging is not open' using errcode = '42501';
  end if;
  insert into public.judge_assignments (event_id, judge_id, submission_id, status)
  values (v_sub.event_id, (select auth.uid()), p_submission,
    (case when p_skipped then 'skipped' else 'assigned' end)::public.assignment_status)
  on conflict (judge_id, submission_id, round_id) do update
    set status = case
      when p_skipped then 'skipped'::public.assignment_status
      when public.judge_assignments.status = 'skipped' then 'assigned'::public.assignment_status
      else public.judge_assignments.status
    end;
  perform private.audit(v_sub.event_id, 'judging.skipped', 'submission', p_submission,
    jsonb_build_object('skipped', p_skipped));
end;
$$;

create function public.advance_submissions(
  p_round uuid, p_submissions uuid[] default null, p_top integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.judging_rounds;
  v_next public.judging_rounds;
  v_ids uuid[];
  v_slug text;
  v_user uuid;
begin
  select * into v_round from public.judging_rounds where id = p_round;
  if v_round.id is null or not private.can_manage(v_round.event_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if (p_submissions is null) = (p_top is null) then
    raise exception 'give either the entries or how many to advance' using errcode = '22023';
  end if;

  if p_submissions is not null then
    v_ids := p_submissions;
    if exists (
      select 1 from unnest(v_ids) i
      where private.active_round(i) is distinct from p_round
        and not exists (select 1 from public.round_entries e where e.round_id = p_round and e.submission_id = i)
        and not (v_round.ordinal = 1 and exists (
          select 1 from public.submissions s where s.id = i and s.form_id = v_round.form_id and s.status = 'submitted'))
    ) then
      raise exception 'those entries are not in this round' using errcode = '22023';
    end if;
  else
    if p_top < 1 or p_top > 500 then
      raise exception 'advance between 1 and 500 entries' using errcode = '22023';
    end if;
    select array_agg((r ->> 'submission_id')::uuid) into v_ids
    from (
      select r from jsonb_array_elements(private.rank_submissions(v_round.event_id)) r
      where (r ->> 'round_id')::uuid = p_round and (r ->> 'score') is not null
      order by (r ->> 'rank')::integer
      limit p_top
    ) top;
  end if;
  if coalesce(cardinality(v_ids), 0) = 0 then
    raise exception 'nothing to advance' using errcode = '22023';
  end if;

  select * into v_next from public.judging_rounds
  where form_id = v_round.form_id and ordinal = v_round.ordinal + 1;
  if v_next.id is null then
    if v_round.ordinal >= 20 then
      raise exception 'a form has at most 20 rounds' using errcode = '22023';
    end if;
    insert into public.judging_rounds (event_id, form_id, ordinal, name)
    values (v_round.event_id, v_round.form_id, v_round.ordinal + 1, 'Round ' || (v_round.ordinal + 1))
    returning * into v_next;
  end if;

  insert into public.round_entries (event_id, round_id, submission_id)
  select v_round.event_id, v_next.id, i from unnest(v_ids) i
  on conflict do nothing;

  perform private.audit(v_round.event_id, 'judging.advanced', 'judging_round', v_next.id,
    jsonb_build_object('from', v_round.name, 'to', v_next.name, 'count', cardinality(v_ids)));

  select slug into v_slug from public.events where id = v_round.event_id;
  for v_user in
    select distinct tm.user_id from public.submissions s
    join public.team_members tm on tm.team_id = s.team_id
    where s.id = any (v_ids)
  loop
    perform private.notify(array[v_user], v_round.event_id, 'judging.advanced',
      'You''re a finalist', 'Your project moves on to ' || v_next.name || '.',
      '/events/' || v_slug || '/submission');
  end loop;
  return v_next.id;
end;
$$;

create function public.set_submission_rubric(p_submission uuid, p_rubric uuid default null)
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
    insert into public.submission_rubrics (event_id, submission_id, rubric_id, set_by)
    values (v_sub.event_id, p_submission, p_rubric, (select auth.uid()))
    on conflict (submission_id) do update
      set rubric_id = excluded.rubric_id, set_by = excluded.set_by, updated_at = now();
  end if;
  perform private.audit(v_sub.event_id, 'judging.rubric_set', 'submission', p_submission,
    jsonb_build_object('rubric', p_rubric));
end;
$$;

-- a judge who may discuss a project's flags: organizers, or judges as judging.deliberation says
create function private.may_deliberate(p_event uuid, p_submission uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_manage(p_event)
    or (
      private.has_permission(p_event, 'judging.score')
      and not private.has_conflict((select auth.uid()), p_submission)
      and case coalesce(private.event_setting(p_event, 'judging') ->> 'deliberation', 'assigned')
        when 'all' then true
        when 'assigned' then exists (
            select 1 from public.judge_assignments a
            where a.submission_id = p_submission and a.judge_id = (select auth.uid()))
          or exists (
            select 1 from public.scores sc
            where sc.submission_id = p_submission and sc.judge_id = (select auth.uid()))
        else false
      end
    );
$$;

grant execute on function private.may_deliberate(uuid, uuid) to authenticated;

create table public.judging_flags (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  submission_id uuid not null,
  round_id uuid not null,
  raised_by uuid references public.profiles on delete set null,
  reason text not null default '' check (length(reason) <= 500),
  gap numeric(5, 2),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles on delete set null,
  resolution text not null default '' check (length(resolution) <= 2000),
  created_at timestamptz not null default now(),
  unique (event_id, id),
  check (gap is not null or length(reason) > 0),
  foreign key (event_id, submission_id) references public.submissions (event_id, id) on delete cascade,
  foreign key (event_id, round_id) references public.judging_rounds (event_id, id) on delete cascade
);
create unique index judging_flags_open_idx on public.judging_flags (submission_id) where resolved_at is null;
create index judging_flags_event_id_submission_id_fk_idx on public.judging_flags (event_id, submission_id);
create index judging_flags_event_id_round_id_fk_idx on public.judging_flags (event_id, round_id);
create index judging_flags_raised_by_fk_idx on public.judging_flags (raised_by);
create index judging_flags_resolved_by_fk_idx on public.judging_flags (resolved_by);

create table public.deliberation_notes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  flag_id uuid not null,
  author_id uuid references public.profiles on delete set null,
  body_md text not null check (length(body_md) between 1 and 5000),
  created_at timestamptz not null default now(),
  foreign key (event_id, flag_id) references public.judging_flags (event_id, id) on delete cascade
);
create index deliberation_notes_event_id_flag_id_fk_idx on public.deliberation_notes (event_id, flag_id);
create index deliberation_notes_author_id_fk_idx on public.deliberation_notes (author_id);

-- while a project has an open flag, the judges deliberating see each other's scores and notes on it
create function private.in_deliberation(p_event uuid, p_submission uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.judging_flags f where f.submission_id = p_submission and f.resolved_at is null)
    and private.may_deliberate(p_event, p_submission);
$$;
grant execute on function private.in_deliberation(uuid, uuid) to authenticated;

create function public.flag_submission(p_submission uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.submissions;
  v_round uuid;
  v_id uuid;
begin
  select * into v_sub from public.submissions where id = p_submission and status = 'submitted';
  if v_sub.id is null
    or coalesce(private.event_setting(v_sub.event_id, 'judging') ->> 'deliberation', 'assigned') = 'off'
    or not private.may_deliberate(v_sub.event_id, p_submission) then
    raise exception 'you can''t flag this project' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) not between 1 and 500 then
    raise exception 'say why in up to 500 characters' using errcode = '22023';
  end if;
  v_round := private.active_round(p_submission);
  insert into public.judging_flags (event_id, submission_id, round_id, raised_by, reason)
  values (v_sub.event_id, p_submission, v_round, (select auth.uid()), trim(p_reason))
  on conflict (submission_id) where resolved_at is null do nothing
  returning id into v_id;
  if v_id is null then
    raise exception 'this project is already flagged' using errcode = '23505';
  end if;
  perform private.audit(v_sub.event_id, 'judging.flagged', 'submission', p_submission,
    jsonb_build_object('reason', left(trim(p_reason), 200)));
  return v_id;
end;
$$;

create function public.resolve_flag(p_flag uuid, p_resolution text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_flag public.judging_flags;
begin
  select * into v_flag from public.judging_flags where id = p_flag;
  if v_flag.id is null or not private.may_deliberate(v_flag.event_id, v_flag.submission_id) then
    raise exception 'you can''t resolve this flag' using errcode = '42501';
  end if;
  if v_flag.resolved_at is not null then
    return;
  end if;
  update public.judging_flags
  set resolved_at = now(), resolved_by = (select auth.uid()), resolution = left(trim(coalesce(p_resolution, '')), 2000)
  where id = p_flag;
  perform private.audit(v_flag.event_id, 'judging.flag_resolved', 'submission', v_flag.submission_id,
    jsonb_build_object('flag', p_flag));
end;
$$;

create function public.add_deliberation_note(p_flag uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_flag public.judging_flags;
  v_id uuid;
begin
  select * into v_flag from public.judging_flags where id = p_flag;
  if v_flag.id is null or v_flag.resolved_at is not null
    or not private.may_deliberate(v_flag.event_id, v_flag.submission_id) then
    raise exception 'this deliberation is closed to you' using errcode = '42501';
  end if;
  insert into public.deliberation_notes (event_id, flag_id, author_id, body_md)
  values (v_flag.event_id, p_flag, (select auth.uid()), trim(p_body))
  returning id into v_id;
  return v_id;
end;
$$;

-- flags a project once when its judges' totals are further apart than judging.flagGap points of 100
create function private.check_score_gap()
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
      and (c.rubric_id is null or c.rubric_id = (
        select r.rubric_id from public.submission_rubrics r where r.submission_id = new.submission_id))
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

create trigger scores_gap after insert or update on public.scores
  for each row execute function private.check_score_gap();

create function public.save_criteria(p_event uuid, p_items jsonb, p_rubrics jsonb default null)
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
  end if;

  delete from public.criteria
  where event_id = p_event
    and id not in (
      select (item ->> 'id')::uuid from jsonb_array_elements(p_items) item where item ->> 'id' is not null
    );
  get diagnostics v_removed = row_count;

  update public.criteria set label = id::text where event_id = p_event;
  insert into public.criteria (id, event_id, label, description_md, min_score, max_score, weight, sort, round_id, rubric_id)
  select coalesce((item ->> 'id')::uuid, gen_random_uuid()), p_event, item ->> 'label',
    coalesce(item ->> 'description_md', ''), coalesce((item ->> 'min_score')::smallint, 0),
    (item ->> 'max_score')::smallint,
    (item ->> 'weight')::numeric, (ordinality - 1)::smallint, nullif(item ->> 'round_id', '')::uuid,
    nullif(item ->> 'rubric_id', '')::uuid
  from jsonb_array_elements(p_items) with ordinality as t(item, ordinality)
  on conflict (id) do update set
    label = excluded.label, description_md = excluded.description_md,
    min_score = excluded.min_score, max_score = excluded.max_score, weight = excluded.weight, sort = excluded.sort,
    round_id = excluded.round_id, rubric_id = excluded.rubric_id;

  perform private.audit(p_event, 'judging.criteria_saved', 'event', p_event,
    jsonb_build_object('count', jsonb_array_length(p_items), 'removed', v_removed,
      'rubrics', case when p_rubrics is null then null else jsonb_array_length(p_rubrics) end));
  return v_removed;
end;
$$;

grant execute on function
  public.preview_results(uuid),
  public.project_export_access(uuid),
  public.project_export_results(uuid),
  public.publish_results(uuid),
  public.assign_round_robin(uuid, integer, uuid),
  public.advance_submissions(uuid, uuid[], integer),
  public.assign_tables(uuid, text, integer, text, text, boolean),
  public.team_scores(uuid),
  public.declare_conflict(uuid, text),
  public.set_conflicts(uuid, jsonb),
  public.remove_conflict(uuid, uuid, uuid),
  public.pin_judge(uuid, uuid, uuid),
  public.unpin_judge(uuid, uuid, uuid),
  public.save_panels(uuid, jsonb),
  public.schedule_demos(uuid, boolean),
  public.move_demo(uuid, uuid, uuid, integer),
  public.set_panel_now(uuid, integer),
  public.my_demo_slots(uuid),
  public.save_offline_scores(uuid, jsonb),
  public.judge_calibration(uuid, uuid),
  public.skip_submission(uuid, boolean),
  public.save_criteria(uuid, jsonb, jsonb),
  public.set_submission_rubric(uuid, uuid),
  public.flag_submission(uuid, text),
  public.resolve_flag(uuid, text),
  public.add_deliberation_note(uuid, text),
  public.save_awards(uuid, jsonb)
to authenticated;

create index feedback_event_id_judge_id_fk_idx on public.feedback (event_id, judge_id);
create index feedback_event_id_submission_id_fk_idx on public.feedback (event_id, submission_id);
create index judge_assignments_event_id_judge_id_fk_idx on public.judge_assignments (event_id, judge_id);
create index judge_assignments_event_id_submission_id_fk_idx on public.judge_assignments (event_id, submission_id);
create index scores_event_id_criterion_id_fk_idx on public.scores (event_id, criterion_id);
create index scores_event_id_judge_id_fk_idx on public.scores (event_id, judge_id);
create index scores_event_id_submission_id_fk_idx on public.scores (event_id, submission_id);
create index feedback_event_id_round_id_fk_idx on public.feedback (event_id, round_id);
create index judge_assignments_event_id_round_id_fk_idx on public.judge_assignments (event_id, round_id);
create index scores_event_id_round_id_fk_idx on public.scores (event_id, round_id);
create index result_publications_published_by_fk_idx on public.result_publications (published_by);

alter table public.judge_conflicts enable row level security;
alter table public.judge_pins enable row level security;
alter table public.judging_panels enable row level security;
alter table public.panel_judges enable row level security;
alter table public.panel_slots enable row level security;
alter table public.judging_rounds enable row level security;
alter table public.round_entries enable row level security;
alter table public.criteria enable row level security;
alter table public.rubrics enable row level security;
alter table public.submission_rubrics enable row level security;
alter table public.judging_flags enable row level security;
alter table public.deliberation_notes enable row level security;
alter table public.judge_assignments enable row level security;
alter table public.scores enable row level security;
alter table public.feedback enable row level security;
alter table public.awards enable row level security;
alter table public.result_publications enable row level security;

create policy judge_conflicts_select on public.judge_conflicts for select to authenticated
  using (judge_id = (select auth.uid()) or (select private.can_manage(event_id)));
create policy judge_pins_select on public.judge_pins for select to authenticated
  using ((select private.can_manage(event_id)));
-- the run of show is for organizers and judges; teams read their own slot through my_demo_slots
create policy judging_panels_select on public.judging_panels for select to authenticated
  using ((select private.can_manage(event_id)) or (select private.has_permission(event_id, 'judging.score')));
create policy panel_judges_select on public.panel_judges for select to authenticated
  using ((select private.can_manage(event_id)) or (select private.has_permission(event_id, 'judging.score')));
create policy panel_slots_select on public.panel_slots for select to authenticated
  using ((select private.can_manage(event_id)) or (select private.has_permission(event_id, 'judging.score')));

create policy judging_rounds_select on public.judging_rounds for select to anon, authenticated
  using ((select private.can_view_event(event_id)));
create policy judging_rounds_update on public.judging_rounds for update to authenticated
  using ((select private.can_manage(event_id)))
  with check ((select private.can_manage(event_id)));
create policy round_entries_select on public.round_entries for select to authenticated
  using (
    (select private.can_manage(event_id))
    or (select private.has_permission(event_id, 'judging.score'))
    or exists (
      select 1 from public.submissions s where s.id = submission_id and private.is_team_member(s.team_id))
  );

create policy criteria_select on public.criteria for select to anon, authenticated
  using ((select private.can_view_event(event_id)));
create policy criteria_write_insert on public.criteria for insert to authenticated
  with check ((select private.can_manage(event_id)));
create policy criteria_write_update on public.criteria for update to authenticated
  using ((select private.can_manage(event_id)))
  with check ((select private.can_manage(event_id)));
create policy criteria_write_delete on public.criteria for delete to authenticated
  using ((select private.can_manage(event_id)));

create policy rubrics_select on public.rubrics for select to anon, authenticated
  using ((select private.can_view_event(event_id)));
create policy submission_rubrics_select on public.submission_rubrics for select to authenticated
  using (
    (select private.can_manage(event_id))
    or (select private.has_permission(event_id, 'judging.score'))
    or exists (
      select 1 from public.submissions s where s.id = submission_id and private.is_team_member(s.team_id))
  );
create policy judging_flags_select on public.judging_flags for select to authenticated
  using (private.may_deliberate(event_id, submission_id));
create policy deliberation_notes_select on public.deliberation_notes for select to authenticated
  using (exists (
    select 1 from public.judging_flags f
    where f.id = flag_id and private.may_deliberate(f.event_id, f.submission_id)));

create policy judge_assignments_select on public.judge_assignments for select to authenticated
  using (judge_id = (select auth.uid()) or (select private.can_manage(event_id)));
create policy judge_assignments_update on public.judge_assignments for update to authenticated
  using (
    (judge_id = (select auth.uid()))
    or
    ((select private.can_manage(event_id)))
  )
  with check (
    (judge_id = (select auth.uid()))
    or
    ((select private.can_manage(event_id)))
  );
create policy judge_assignments_manage_insert on public.judge_assignments for insert to authenticated
  with check ((select private.can_manage(event_id)));
create policy judge_assignments_manage_delete on public.judge_assignments for delete to authenticated
  using ((select private.can_manage(event_id)));

create policy scores_select on public.scores for select to authenticated
  using (
    judge_id = (select auth.uid())
    or (select private.can_manage(event_id))
    or private.in_deliberation(event_id, submission_id)
  );
create policy scores_insert on public.scores for insert to authenticated
  with check (
    (
      judge_id = (select auth.uid())
      and (select private.has_permission(event_id, 'judging.score'))
      and (select private.round_window_open(round_id))
      and not (select private.has_conflict(judge_id, submission_id))
      and exists (select 1 from public.submissions s where s.id = submission_id and s.status = 'submitted')
    )
    or
    ((select private.can_manage(event_id)))
  );
create policy scores_update on public.scores for update to authenticated
  using (
    (
      judge_id = (select auth.uid())
      and (select private.round_window_open(round_id))
    )
    or
    ((select private.can_manage(event_id)))
  )
  with check (
    (
      judge_id = (select auth.uid())
      and (select private.has_permission(event_id, 'judging.score'))
      and (select private.round_window_open(round_id))
      and not (select private.has_conflict(judge_id, submission_id))
      and exists (select 1 from public.submissions s where s.id = submission_id and s.status = 'submitted')
    )
    or
    ((select private.can_manage(event_id)))
  );
create policy scores_delete on public.scores for delete to authenticated
  using (
    (
      judge_id = (select auth.uid())
      and (select private.round_window_open(round_id))
    )
    or
    ((select private.can_manage(event_id)))
  );

create policy feedback_select on public.feedback for select to authenticated
  using (
    judge_id = (select auth.uid())
    or (select private.can_manage(event_id))
    or private.in_deliberation(event_id, submission_id)
    or (
      visibility = 'team'
      and ((select private.event_setting(event_id, 'judging')) ->> 'shareWithTeams') in ('feedback', 'scores')
      and (select private.window_open(event_id, 'results'))
      and (select private.latest_publication(event_id)) is not null
      and exists (select 1 from public.submissions s where s.id = submission_id and private.is_team_member(s.team_id))
    )
  );
create policy feedback_insert on public.feedback for insert to authenticated
  with check (
    (
      judge_id = (select auth.uid())
      and (select private.has_permission(event_id, 'judging.score'))
      and (select private.round_window_open(round_id))
    )
    or
    ((select private.can_manage(event_id)))
  );
create policy feedback_update on public.feedback for update to authenticated
  using (
    (judge_id = (select auth.uid()) and (select private.round_window_open(round_id)))
    or
    ((select private.can_manage(event_id)))
  )
  with check (
    (
      judge_id = (select auth.uid())
      and (select private.has_permission(event_id, 'judging.score'))
      and (select private.round_window_open(round_id))
    )
    or
    ((select private.can_manage(event_id)))
  );
create policy feedback_delete on public.feedback for delete to authenticated
  using (
    (judge_id = (select auth.uid()) and (select private.round_window_open(round_id)))
    or
    ((select private.can_manage(event_id)))
  );

create policy awards_select on public.awards for select to authenticated
  using ((select private.can_manage(event_id)));

create policy result_publications_select on public.result_publications for select to anon, authenticated
  using (
    (select private.can_manage(event_id))
    or (
      (select private.window_open(event_id, 'results'))
      and ((select private.is_public_event(event_id)) or (select private.has_permission(event_id, 'event.view')))
      and id = (select private.latest_publication(event_id))
    )
  );

-- judges see the presenter move along as the panel's judges or organizers advance it
alter publication supabase_realtime add table public.judging_panels;
