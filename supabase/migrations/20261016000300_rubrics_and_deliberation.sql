-- rubrics per theme, and flagging projects for judges to deliberate on

create or replace function private.setting_defaults(p_namespace text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce($json${"branding":{},"registration":{"signup":"invite","mode":"review","capacity":0,"autoPromote":true},"email":{},"tenancy":{},"accounts":{"deletionRequests":true,"requireAdminMfa":true,"portfolios":false},"signin":{"providers":[]},"audit":{"retentionDays":60},"access":{"allowedNetworks":[],"onlyUsers":[],"onlyTeams":[],"onlyDivisions":[]},"network":{"clientIpHeader":"x-forwarded-for","trustedHops":1,"trustedProxies":[]},"seo":{"indexing":true},"limits":{},"submissions":{"autoSubmit":false,"deletion":"allow","reminderHours":24,"publicToggle":false},"schedule":{"display":"list","hiddenWindows":[],"showEventTimezone":false},"agenda":{"kinds":[],"reminderMinutes":30},"home":{"layout":{"main":[{"id":"next-steps","type":"next-steps"},{"id":"agenda","type":"agenda"}],"aside":[{"id":"announcements","type":"announcements"},{"id":"facts","type":"facts"},{"id":"prizes","type":"prizes"},{"id":"about","type":"about"},{"id":"briefing","type":"briefing"}]}},"identity":{"enabled":false},"chat":{"enabled":true,"staff":true,"participants":true,"judges":false,"copyTeam":true},"certificates":{"enabled":false},"announcements":{"toasts":true,"urgentStays":true,"postAs":"author","judges":false},"teams":{"disband":"captain","board":true,"switching":true,"askOrganizer":true,"creation":"participants","leaveLimit":2},"divisions":{"askOnJoin":true},"venue":{},"privacy":{"agenda":"members","tracks":"public"},"briefing":{},"checkin":{"confirmName":true,"allowWalkIns":false,"badgeEmailHours":24,"requiredToCompete":false},"voting":{"enabled":false,"who":"participants","votesPerPerson":1,"ownTeam":false,"showCounts":false},"judging":{"blind":false,"showRankings":"organizers","normalize":"none","minJudges":2,"shareWithTeams":"feedback","judgeRubric":true,"teamRubric":false,"teamRubricShows":"name","deliberation":"assigned","flagGap":0,"holdFlagged":true},"plugins":{"enabled":[]}}$json$::jsonb -> p_namespace, '{}');
$$;


create table public.rubrics (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  name text not null check (length(name) between 1 and 60),
  description_md text not null default '' check (length(description_md) <= 2000),
  sort smallint not null default 0,
  unique (event_id, name),
  unique (event_id, id)
);

alter table public.criteria add column if not exists rubric_id uuid;
alter table public.criteria add foreign key (event_id, rubric_id)
  references public.rubrics (event_id, id) on delete cascade;
create index if not exists criteria_event_id_rubric_id_fk_idx on public.criteria (event_id, rubric_id);

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

drop function if exists public.save_criteria(uuid, jsonb);
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
    select s.id as submission_id, s.team_id, r.id as round_id, r.ordinal, r.name as round_name, r.method,
      sr.rubric_id
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
    and (c.rubric_id is null
      or c.rubric_id = (select x.rubric_id from public.submission_rubrics x where x.submission_id = p_submission))
    and not exists (select 1 from public.judge_conflicts jc where jc.judge_id = sc.judge_id and jc.team_id = v_sub.team_id)
  group by r.name, r.ordinal, c.label, c.min_score, c.max_score, c.sort
  order by r.ordinal, c.sort;
end;
$$;

create or replace function public.publish_results(p_event uuid)
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
    description_md, location, website_url, team_size_min, team_size_max, is_template, created_by)
  select v_src.org_id, lower(p_slug), trim(p_name), v_src.kind, v_src.timezone,
    v_src.starts_at + v_shift,
    case when p_ends_at is not null and not p_template then p_ends_at else v_src.ends_at + v_shift end,
    case when 'details' = any (p_include) then v_src.short_name end,
    case when 'details' = any (p_include) then v_src.description_md else '' end,
    case when 'details' = any (p_include) then v_src.location end,
    case when 'details' = any (p_include) then v_src.website_url end,
    case when 'details' = any (p_include) then v_src.team_size_min else 1 end,
    case when 'details' = any (p_include) then v_src.team_size_max else 4 end,
    p_template, (select auth.uid())
  returning * into v_new;

  if 'windows' = any (p_include) then
    insert into public.event_windows (event_id, key, opens_at, closes_at, updated_by)
    select v_new.id, key, opens_at + v_shift, closes_at + v_shift, (select auth.uid())
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
    insert into public.criteria (event_id, label, description_md, min_score, max_score, weight, sort, round_id, rubric_id)
    select v_new.id, label, description_md, min_score, max_score, weight, sort,
      (v_rounds ->> round_id::text)::uuid, (v_rubrics ->> rubric_id::text)::uuid
    from public.criteria where event_id = p_source;
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
        location, starts_at, ends_at, host_note, capacity, required, takes_attendance, visibility, sort)
      values (v_new.id, (v_slots ->> r.slot_id::text)::uuid, (v_categories ->> r.category_id::text)::uuid,
        r.kind, r.name, r.description_md, r.location, r.starts_at + v_shift, r.ends_at + v_shift,
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
      when 'briefing' then 'details' = any (p_include)
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

grant execute on function
  public.save_criteria(uuid, jsonb, jsonb),
  public.set_submission_rubric(uuid, uuid),
  public.flag_submission(uuid, text),
  public.resolve_flag(uuid, text),
  public.add_deliberation_note(uuid, text)
to authenticated;

alter table public.rubrics enable row level security;
alter table public.submission_rubrics enable row level security;
alter table public.judging_flags enable row level security;
alter table public.deliberation_notes enable row level security;

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

drop policy scores_select on public.scores;
create policy scores_select on public.scores for select to authenticated
  using (
    judge_id = (select auth.uid())
    or (select private.can_manage(event_id))
    or private.in_deliberation(event_id, submission_id)
  );

drop policy feedback_select on public.feedback;
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
