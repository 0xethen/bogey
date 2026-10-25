-- judging_tiebreakers: rank on the full score, break ties per judging.tiebreakers, and let
-- advancing the top N take everyone tied for the last spot (judging.advanceTies)
create or replace function private.setting_defaults(p_namespace text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce($json${"branding":{},"registration":{"signup":"invite","mode":"invite","capacity":0,"autoPromote":true},"email":{},"tenancy":{},"accounts":{"deletionRequests":true,"requireAdminMfa":true,"portfolios":false,"deviceSignOut":false,"maxPasskeys":5},"signin":{"providers":[]},"audit":{"retentionDays":60},"access":{"allowedNetworks":[],"onlyUsers":[],"onlyTeams":[],"onlyDivisions":[]},"network":{"clientIpHeader":"x-forwarded-for","trustedHops":1,"trustedProxies":[]},"seo":{"indexing":true},"limits":{},"submissions":{"autoSubmit":false,"deletion":"allow","reminderHours":24,"publicToggle":false},"schedule":{"display":"list","hiddenWindows":[],"showEventTimezone":false},"agenda":{"kinds":[],"reminderMinutes":5,"tabMenu":true},"home":{"layout":{"main":[{"id":"next-steps","type":"next-steps"},{"id":"agenda","type":"agenda"}],"aside":[{"id":"announcements","type":"announcements"},{"id":"facts","type":"facts"},{"id":"prizes","type":"prizes"},{"id":"about","type":"about"}]}},"tabs":{"items":[]},"identity":{"enabled":false},"chat":{"enabled":true,"staff":true,"participants":false,"judges":false,"copyTeam":true},"certificates":{"enabled":false},"announcements":{"toasts":true,"urgentStays":true,"postAs":"author","judges":false},"teams":{"disband":"captain","board":false,"switching":true,"askOrganizer":true,"creation":"participants","leaveLimit":0},"divisions":{"askOnJoin":true},"venue":{},"privacy":{"about":"members","agenda":"members","tracks":"public"},"about":{},"checkin":{"confirmName":true,"allowWalkIns":false,"badgeEmailHours":24,"requiredToCompete":false,"takers":["organizer","staff"]},"gallery":{"banners":true,"teamBanners":true,"teamSizes":false,"winners":true,"likes":false,"comments":false,"sort":"newest","slideshow":true},"voting":{"enabled":false,"who":"participants","votesPerPerson":1,"ownTeam":false,"showCounts":false},"judging":{"blind":false,"showRankings":"organizers","normalize":"none","minJudges":2,"shareWithTeams":"feedback","judgeRubric":true,"teamRubric":false,"teamRubricShows":"name","deliberation":"assigned","flagGap":0,"holdFlagged":true,"judgeExport":"off","assignment":{"perProject":1,"rules":[],"exclude":[]},"tiebreakers":[],"advanceTies":true},"tags":{"eventTags":true},"plugins":{"enabled":[]}}$json$::jsonb -> p_namespace, '{}');
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
      100 * sum(coalesce(pc.normalised, 0) * pc.weight) / nullif(sum(pc.weight), 0) as exact,
      100 * sum(coalesce(pc.raw_normalised, 0) * pc.weight) / nullif(sum(pc.weight), 0) as raw_exact,
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
    select ri.submission_id, ri.round_id, ri.score, ri.score, ri.score, ri.score, 0::bigint, 0::bigint, 0::bigint,
      ri.detail
    from public.ranking_inputs ri
    join entries en on en.submission_id = ri.submission_id and en.round_id = ri.round_id
    where en.method <> 'rubric' and en.method = ri.provider
  ),
  -- judging.tiebreakers, in order; a missing value loses the tiebreak
  breakers as (
    select b.ord, b.value ->> 'by' as by, nullif(b.value ->> 'criterion', '')::uuid as criterion
    from jsonb_array_elements(case when jsonb_typeof(private.event_setting(p_event, 'judging') -> 'tiebreakers') = 'array'
      then private.event_setting(p_event, 'judging') -> 'tiebreakers' else '[]' end) with ordinality b(value, ord)
  ),
  keyed as (
    select t.*,
      array(
        select coalesce(case b.by
          when 'criterion' then (
            select pc.normalised from per_criterion pc
            where pc.submission_id = t.submission_id and pc.round_id = t.round_id and pc.criterion_id = b.criterion)
          when 'raw' then t.raw_exact
          when 'judges' then t.judges::numeric
          when 'submitted' then -extract(epoch from s.submitted_at)
        end, '-Infinity'::numeric)
        from breakers b order by b.ord
      ) as tiebreak
    from totals t
    join public.submissions s on s.id = t.submission_id
  ),
  ranked as (
    select t.*, en.ordinal as round_ordinal, en.round_name, en.method, rb.name as rubric,
      s.team_id, s.title, s.form_id, f.title as form_title, tm.name as team_name, tm.division_id,
      rank() over (partition by t.round_id order by t.exact desc nulls last, t.tiebreak desc) as rank,
      rank() over (partition by t.round_id, tm.division_id order by t.exact desc nulls last, t.tiebreak desc)
        as division_rank,
      case
        when t.exact is null or count(*) over (partition by t.round_id, t.exact) = 1 then null
        when count(*) over (partition by t.round_id, t.exact, t.tiebreak) > 1 then 'tied'
        else 'broken'
      end as tie
    from keyed t
    join entries en on en.submission_id = t.submission_id and en.round_id = t.round_id
    join public.submissions s on s.id = t.submission_id
    join public.submission_forms f on f.id = s.form_id
    join public.teams tm on tm.id = s.team_id
    left join public.rubrics rb on rb.id = en.rubric_id
  )
  select coalesce(jsonb_agg(to_jsonb(ranked) - 'exact' - 'raw_exact' - 'tiebreak'
    order by form_title, round_ordinal, rank, title, submission_id), '[]')
  from ranked;
$$;

create or replace function public.advance_submissions(
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
  v_ties boolean;
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
    v_ties := coalesce((private.event_setting(v_round.event_id, 'judging') ->> 'advanceTies')::boolean, true);
    -- rank_submissions already lists each round in rank order
    with entries as (
      select (r ->> 'submission_id')::uuid as id, (r ->> 'rank')::integer as place,
        row_number() over (order by n) as pos
      from jsonb_array_elements(private.rank_submissions(v_round.event_id)) with ordinality e(r, n)
      where (r ->> 'round_id')::uuid = p_round and (r ->> 'score') is not null
    )
    select array_agg(id order by pos) into v_ids
    from entries
    where case when v_ties
      then place <= coalesce((select place from entries where pos = p_top), 2147483647)
      else pos <= p_top end;
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
