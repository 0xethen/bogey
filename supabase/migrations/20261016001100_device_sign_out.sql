-- signing out one device at a time is an operator opt-in (security.deviceSignOut)

-- the bottom of every setting's chain: defaults → instance → org → event
create or replace function private.setting_defaults(p_namespace text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce($json${"branding":{},"registration":{"signup":"invite","mode":"review","capacity":0,"autoPromote":true},"email":{},"tenancy":{},"accounts":{"deletionRequests":true,"requireAdminMfa":true,"portfolios":false,"deviceSignOut":false},"signin":{"providers":[]},"audit":{"retentionDays":60},"access":{"allowedNetworks":[],"onlyUsers":[],"onlyTeams":[],"onlyDivisions":[]},"network":{"clientIpHeader":"x-forwarded-for","trustedHops":1,"trustedProxies":[]},"seo":{"indexing":true},"limits":{},"submissions":{"autoSubmit":false,"deletion":"allow","reminderHours":24,"publicToggle":false},"schedule":{"display":"list","hiddenWindows":[],"showEventTimezone":false},"agenda":{"kinds":[],"reminderMinutes":30},"home":{"layout":{"main":[{"id":"next-steps","type":"next-steps"},{"id":"agenda","type":"agenda"}],"aside":[{"id":"announcements","type":"announcements"},{"id":"facts","type":"facts"},{"id":"prizes","type":"prizes"},{"id":"about","type":"about"}]}},"identity":{"enabled":false},"chat":{"enabled":true,"staff":true,"participants":true,"judges":false,"copyTeam":true},"certificates":{"enabled":false},"announcements":{"toasts":true,"urgentStays":true,"postAs":"author","judges":false},"teams":{"disband":"captain","board":true,"switching":true,"askOrganizer":true,"creation":"participants","leaveLimit":0},"divisions":{"askOnJoin":true},"venue":{},"privacy":{"about":"members","agenda":"members","tracks":"public"},"about":{},"checkin":{"confirmName":true,"allowWalkIns":false,"badgeEmailHours":24,"requiredToCompete":false},"voting":{"enabled":false,"who":"participants","votesPerPerson":1,"ownTeam":false,"showCounts":false},"judging":{"blind":false,"showRankings":"organizers","normalize":"none","minJudges":2,"shareWithTeams":"feedback","judgeRubric":true,"teamRubric":false,"teamRubricShows":"name","deliberation":"assigned","flagGap":0,"holdFlagged":true},"plugins":{"enabled":[]}}$json$::jsonb -> p_namespace, '{}');
$$;
grant execute on function private.setting_defaults(text)
to anon, authenticated, service_role, supabase_auth_admin;

-- instance-level keys only the operator sets, from bogey.config.ts or the CLI
create or replace function private.operator_keys(p_namespace text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array(select jsonb_array_elements_text($json${"tenancy":["appUrl"],"accounts":["requireAdminMfa","deviceSignOut"],"network":["clientIpHeader","trustedHops","trustedProxies"]}$json$::jsonb -> p_namespace)), '{}');
$$;
grant execute on function private.operator_keys(text) to anon, authenticated, service_role;

-- signs one of the caller's own sessions out; its refresh token goes with it.
-- off unless the operator sets security.deviceSignOut: a stolen session could end the real one
create or replace function public.end_my_session(p_session uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce((private.instance_setting('accounts') ->> 'deviceSignOut')::boolean, false) then
    raise exception 'Signing out other devices is turned off on this instance'
      using errcode = '42501';
  end if;
  delete from auth.sessions where id = p_session and user_id = (select auth.uid());
  return found;
end;
$$;
