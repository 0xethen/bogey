-- project_export: the configurable projects spreadsheet; judging.judgeExport decides what judges can download

create or replace function private.setting_defaults(p_namespace text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce($json${"branding":{},"registration":{"signup":"invite","mode":"review","capacity":0,"autoPromote":true},"email":{},"tenancy":{},"accounts":{"deletionRequests":true,"requireAdminMfa":true,"portfolios":false,"deviceSignOut":false,"maxPasskeys":5},"signin":{"providers":[]},"audit":{"retentionDays":60},"access":{"allowedNetworks":[],"onlyUsers":[],"onlyTeams":[],"onlyDivisions":[]},"network":{"clientIpHeader":"x-forwarded-for","trustedHops":1,"trustedProxies":[]},"seo":{"indexing":true},"limits":{},"submissions":{"autoSubmit":false,"deletion":"allow","reminderHours":24,"publicToggle":false},"schedule":{"display":"list","hiddenWindows":[],"showEventTimezone":false},"agenda":{"kinds":[],"reminderMinutes":5,"tabMenu":true},"home":{"layout":{"main":[{"id":"next-steps","type":"next-steps"},{"id":"agenda","type":"agenda"}],"aside":[{"id":"announcements","type":"announcements"},{"id":"facts","type":"facts"},{"id":"prizes","type":"prizes"},{"id":"about","type":"about"}]}},"tabs":{"items":[]},"identity":{"enabled":false},"chat":{"enabled":true,"staff":true,"participants":false,"judges":false,"copyTeam":true},"certificates":{"enabled":false},"announcements":{"toasts":true,"urgentStays":true,"postAs":"author","judges":false},"teams":{"disband":"captain","board":false,"switching":true,"askOrganizer":true,"creation":"participants","leaveLimit":0},"divisions":{"askOnJoin":true},"venue":{},"privacy":{"about":"members","agenda":"members","tracks":"public"},"about":{},"checkin":{"confirmName":true,"allowWalkIns":false,"badgeEmailHours":24,"requiredToCompete":false,"takers":["organizer","staff"]},"voting":{"enabled":false,"who":"participants","votesPerPerson":1,"ownTeam":false,"showCounts":false},"judging":{"blind":false,"showRankings":"organizers","normalize":"none","minJudges":2,"shareWithTeams":"feedback","judgeRubric":true,"teamRubric":false,"teamRubricShows":"name","deliberation":"assigned","flagGap":0,"holdFlagged":true,"judgeExport":"off","assignment":{"perProject":1,"rules":[],"exclude":[]}},"tags":{"eventTags":true},"plugins":{"enabled":[]}}$json$::jsonb -> p_namespace, '{}');
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

grant execute on function public.project_export_access(uuid), public.project_export_results(uuid) to authenticated;

create or replace function public.log_export(p_event uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (private.can_manage(p_event)
    or (p_kind = 'submissions' and private.project_export_access(p_event) <> 'off')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_kind !~ '^[a-z][a-z-]{0,39}$' then
    raise exception 'unknown export "%"', p_kind using errcode = '22023';
  end if;
  perform private.audit(p_event, 'export.downloaded', null, null, jsonb_build_object('kind', p_kind));
end;
$$;
