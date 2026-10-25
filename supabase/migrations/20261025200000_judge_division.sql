-- judge_division: judges move a project's team to another division from its score sheet (judging.judgeDivision)

create or replace function private.setting_defaults(p_namespace text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce($json${"branding":{},"registration":{"signup":"invite","mode":"invite","capacity":0,"autoPromote":true},"email":{},"tenancy":{},"accounts":{"deletionRequests":true,"requireAdminMfa":true,"portfolios":false,"deviceSignOut":false,"maxPasskeys":5},"signin":{"providers":[]},"audit":{"retentionDays":60},"access":{"allowedNetworks":[],"onlyUsers":[],"onlyTeams":[],"onlyDivisions":[]},"network":{"clientIpHeader":"x-forwarded-for","trustedHops":1,"trustedProxies":[]},"seo":{"indexing":true},"limits":{},"submissions":{"autoSubmit":false,"deletion":"allow","reminderHours":24,"publicToggle":false},"schedule":{"display":"list","hiddenWindows":[],"showEventTimezone":false},"agenda":{"kinds":[],"reminderMinutes":5,"tabMenu":true},"home":{"layout":{"main":[{"id":"next-steps","type":"next-steps"},{"id":"agenda","type":"agenda"}],"aside":[{"id":"announcements","type":"announcements"},{"id":"facts","type":"facts"},{"id":"prizes","type":"prizes"},{"id":"about","type":"about"}]}},"tabs":{"items":[]},"identity":{"enabled":false},"chat":{"enabled":true,"staff":true,"participants":false,"judges":false,"copyTeam":true},"certificates":{"enabled":false},"announcements":{"toasts":true,"urgentStays":true,"postAs":"author","judges":false},"teams":{"disband":"captain","board":false,"switching":true,"askOrganizer":true,"creation":"participants","leaveLimit":0},"divisions":{"askOnJoin":true},"venue":{},"privacy":{"about":"members","agenda":"members","tracks":"public"},"about":{},"checkin":{"confirmName":true,"allowWalkIns":false,"badgeEmailHours":24,"requiredToCompete":false,"takers":["organizer","staff"]},"gallery":{"banners":true,"teamBanners":true,"teamSizes":false,"winners":true,"likes":false,"comments":false,"sort":"newest","slideshow":true},"voting":{"enabled":false,"who":"participants","votesPerPerson":1,"ownTeam":false,"showCounts":false},"judging":{"blind":false,"showRankings":"organizers","normalize":"none","minJudges":2,"shareWithTeams":"feedback","judgeRubric":true,"judgeDivision":true,"teamRubric":false,"teamRubricShows":"name","deliberation":"assigned","flagGap":0,"holdFlagged":true,"judgeExport":"off","assignment":{"perProject":1,"rules":[],"exclude":[]},"tiebreakers":[],"advanceTies":true},"tags":{"eventTags":true},"plugins":{"enabled":[]}}$json$::jsonb -> p_namespace, '{}');
$$;

create or replace function private.notification_kind(p_kind text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select $json${"registration.received":{"inApp":true,"email":true,"transactional":true,"emailKind":"registration.received"},"registration.approved":{"inApp":true,"email":true,"transactional":true,"emailKind":"registration.approved"},"registration.rejected":{"inApp":true,"email":true,"transactional":true,"emailKind":"registration.rejected"},"registration.waitlisted":{"inApp":true,"email":true,"transactional":true,"emailKind":"registration.waitlisted"},"team.joined":{"inApp":true,"email":false,"transactional":false,"emailKind":"team.joined"},"team.left":{"inApp":true,"email":false,"transactional":false,"emailKind":"notification"},"team.request":{"inApp":true,"email":true,"transactional":false,"emailKind":"notification"},"team.invited":{"inApp":true,"email":true,"transactional":false,"emailKind":"notification"},"team.answered":{"inApp":true,"email":false,"transactional":false,"emailKind":"notification"},"judging.assigned":{"inApp":true,"email":true,"transactional":false,"emailKind":"judging.assigned"},"judging.advanced":{"inApp":true,"email":true,"transactional":false,"emailKind":"judging.advanced"},"judging.division_set":{"inApp":true,"email":false,"transactional":false,"emailKind":"notification"},"submission.received":{"inApp":true,"email":true,"transactional":false,"emailKind":"submission.received"},"submission.deadline":{"inApp":true,"email":true,"transactional":false,"emailKind":"submission.deadline"},"results.published":{"inApp":true,"email":true,"transactional":false,"emailKind":"results.published"},"announcement":{"inApp":true,"email":false,"transactional":false,"emailKind":"announcement"},"checkin.badge":{"inApp":true,"email":true,"transactional":false,"emailKind":"checkin.badge"},"certificate.issued":{"inApp":true,"email":true,"transactional":false,"emailKind":"notification"},"session.reminder":{"inApp":true,"email":false,"transactional":false,"emailKind":"session.reminder"},"window.reminder":{"inApp":true,"email":false,"transactional":false,"emailKind":"notification"}}$json$::jsonb -> p_kind;
$$;

-- Moves a project's team, and so all its entries and members, to another division (judging.judgeDivision).
create function public.set_submission_division(p_submission uuid, p_division uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.submissions;
  v_from uuid;
  v_name text;
  v_slug text;
begin
  select * into v_sub from public.submissions where id = p_submission;
  if v_sub.id is null then
    raise exception 'that project isn''t available' using errcode = '42501';
  end if;
  if not (
    private.can_manage(v_sub.event_id)
    or (
      coalesce((private.event_setting(v_sub.event_id, 'judging') ->> 'judgeDivision')::boolean, true)
      and private.has_permission(v_sub.event_id, 'judging.score')
      and not private.has_conflict((select auth.uid()), p_submission)
      and private.round_window_open(private.active_round(p_submission))
    )
  ) then
    raise exception 'you can''t move this project to another division' using errcode = '42501';
  end if;
  select name into v_name from public.divisions where id = p_division and event_id = v_sub.event_id;
  if v_name is null then
    raise exception 'no such division' using errcode = 'P0002';
  end if;
  select division_id into v_from from public.teams where id = v_sub.team_id for update;
  if v_from is not distinct from p_division then
    return;
  end if;
  -- every form the team has entered must still be open to it
  if exists (
    select 1 from public.submissions s
    join public.submission_form_divisions fd on fd.form_id = s.form_id
    where s.team_id = v_sub.team_id
    group by s.form_id
    having not bool_or(fd.division_id = p_division)
  ) then
    raise exception 'this team has an entry on a form that isn''t open to %', v_name using errcode = '22023';
  end if;
  update public.teams set division_id = p_division where id = v_sub.team_id;
  perform private.audit(v_sub.event_id, 'judging.division_set', 'submission', p_submission,
    jsonb_build_object('division', p_division, 'from', v_from, 'team', v_sub.team_id));
  select slug into v_slug from public.events where id = v_sub.event_id;
  perform private.notify(
    array(select user_id from public.team_members where team_id = v_sub.team_id),
    v_sub.event_id, 'judging.division_set',
    'Your project moved to ' || v_name, 'It now competes in ' || v_name || '.',
    '/events/' || v_slug || '/submission');
end;
$$;
grant execute on function public.set_submission_division(uuid, uuid) to authenticated;
