-- event tabs (tabs.items); the team board and participants' conversations with organizers start off;
-- walk-ins carry registration answers, for the check-in kiosk

-- the bottom of every setting's chain: defaults → instance → org → event
create or replace function private.setting_defaults(p_namespace text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce($json${"branding":{},"registration":{"signup":"invite","mode":"review","capacity":0,"autoPromote":true},"email":{},"tenancy":{},"accounts":{"deletionRequests":true,"requireAdminMfa":true,"portfolios":false,"deviceSignOut":false},"signin":{"providers":[]},"audit":{"retentionDays":60},"access":{"allowedNetworks":[],"onlyUsers":[],"onlyTeams":[],"onlyDivisions":[]},"network":{"clientIpHeader":"x-forwarded-for","trustedHops":1,"trustedProxies":[]},"seo":{"indexing":true},"limits":{},"submissions":{"autoSubmit":false,"deletion":"allow","reminderHours":24,"publicToggle":false},"schedule":{"display":"list","hiddenWindows":[],"showEventTimezone":false},"agenda":{"kinds":[],"reminderMinutes":30},"home":{"layout":{"main":[{"id":"next-steps","type":"next-steps"},{"id":"agenda","type":"agenda"}],"aside":[{"id":"announcements","type":"announcements"},{"id":"facts","type":"facts"},{"id":"prizes","type":"prizes"},{"id":"about","type":"about"}]}},"tabs":{"items":[]},"identity":{"enabled":false},"chat":{"enabled":true,"staff":true,"participants":false,"judges":false,"copyTeam":true},"certificates":{"enabled":false},"announcements":{"toasts":true,"urgentStays":true,"postAs":"author","judges":false},"teams":{"disband":"captain","board":false,"switching":true,"askOrganizer":true,"creation":"participants","leaveLimit":0},"divisions":{"askOnJoin":true},"venue":{},"privacy":{"about":"members","agenda":"members","tracks":"public"},"about":{},"checkin":{"confirmName":true,"allowWalkIns":false,"badgeEmailHours":24,"requiredToCompete":false},"voting":{"enabled":false,"who":"participants","votesPerPerson":1,"ownTeam":false,"showCounts":false},"judging":{"blind":false,"showRankings":"organizers","normalize":"none","minJudges":2,"shareWithTeams":"feedback","judgeRubric":true,"teamRubric":false,"teamRubricShows":"name","deliberation":"assigned","flagGap":0,"holdFlagged":true},"plugins":{"enabled":[]}}$json$::jsonb -> p_namespace, '{}');
$$;
grant execute on function private.setting_defaults(text)
to anon, authenticated, service_role, supabase_auth_admin;

drop function if exists public.check_in_walk_in(uuid, text, text);
create or replace function public.check_in_walk_in(
  p_event uuid, p_email text, p_name text default '', p_answers jsonb default '{}'
)
returns table (registered boolean, checked_in boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_user uuid;
  v_fields jsonb;
begin
  if not private.has_permission(p_event, 'people.checkin') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not coalesce((private.event_setting(p_event, 'checkin') ->> 'allowWalkIns')::boolean, false) then
    raise exception 'this event doesn''t take walk-ins' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'that isn''t an email address' using errcode = '22023';
  end if;

  select fields into v_fields from public.onboarding_forms where event_id = p_event;
  insert into public.registrations (event_id, email, full_name, source, role, status, reviewed_by, reviewed_at, answers)
  values (p_event, v_email, nullif(btrim(p_name), ''), 'import', 'participant', 'approved', (select auth.uid()), now(),
    case when p_answers = '{}'::jsonb then '{}'::jsonb
      else private.clean_registration_answers(p_event, coalesce(v_fields, '[]'), p_answers, (select auth.uid())) end)
  on conflict (event_id, email) do update set status = 'approved',
    answers = case when p_answers = '{}'::jsonb then public.registrations.answers else excluded.answers end
    where public.registrations.status in ('pending', 'rejected', 'withdrawn', 'waitlisted')
      or p_answers <> '{}'::jsonb;
  perform private.audit(p_event, 'checkin.walk_in', 'registration', null, '{}');

  select u.id into v_user from auth.users u where lower(u.email) = v_email;
  if v_user is not null and exists (
    select 1 from public.event_members m where m.event_id = p_event and m.user_id = v_user and m.status = 'active'
  ) then
    perform public.check_in(p_event, v_user, null, 'desk');
    return query select true, true;
    return;
  end if;
  return query select true, false;
end;
$$;
grant execute on function public.check_in_walk_in(uuid, text, text, jsonb) to authenticated;
