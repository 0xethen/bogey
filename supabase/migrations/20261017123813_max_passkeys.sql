-- passkeys per person is an operator key (security.maxPasskeys, default 5)

-- the bottom of every setting's chain: defaults → instance → org → event
create or replace function private.setting_defaults(p_namespace text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce($json${"branding":{},"registration":{"signup":"invite","mode":"review","capacity":0,"autoPromote":true},"email":{},"tenancy":{},"accounts":{"deletionRequests":true,"requireAdminMfa":true,"portfolios":false,"deviceSignOut":false,"maxPasskeys":5},"signin":{"providers":[]},"audit":{"retentionDays":60},"access":{"allowedNetworks":[],"onlyUsers":[],"onlyTeams":[],"onlyDivisions":[]},"network":{"clientIpHeader":"x-forwarded-for","trustedHops":1,"trustedProxies":[]},"seo":{"indexing":true},"limits":{},"submissions":{"autoSubmit":false,"deletion":"allow","reminderHours":24,"publicToggle":false},"schedule":{"display":"list","hiddenWindows":[],"showEventTimezone":false},"agenda":{"kinds":[],"reminderMinutes":30},"home":{"layout":{"main":[{"id":"next-steps","type":"next-steps"},{"id":"agenda","type":"agenda"}],"aside":[{"id":"announcements","type":"announcements"},{"id":"facts","type":"facts"},{"id":"prizes","type":"prizes"},{"id":"about","type":"about"}]}},"tabs":{"items":[]},"identity":{"enabled":false},"chat":{"enabled":true,"staff":true,"participants":false,"judges":false,"copyTeam":true},"certificates":{"enabled":false},"announcements":{"toasts":true,"urgentStays":true,"postAs":"author","judges":false},"teams":{"disband":"captain","board":false,"switching":true,"askOrganizer":true,"creation":"participants","leaveLimit":0},"divisions":{"askOnJoin":true},"venue":{},"privacy":{"about":"members","agenda":"members","tracks":"public"},"about":{},"checkin":{"confirmName":true,"allowWalkIns":false,"badgeEmailHours":24,"requiredToCompete":false},"voting":{"enabled":false,"who":"participants","votesPerPerson":1,"ownTeam":false,"showCounts":false},"judging":{"blind":false,"showRankings":"organizers","normalize":"none","minJudges":2,"shareWithTeams":"feedback","judgeRubric":true,"teamRubric":false,"teamRubricShows":"name","deliberation":"assigned","flagGap":0,"holdFlagged":true},"plugins":{"enabled":[]}}$json$::jsonb -> p_namespace, '{}');
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
  select coalesce(array(select jsonb_array_elements_text($json${"tenancy":["appUrl"],"accounts":["requireAdminMfa","deviceSignOut","maxPasskeys"],"network":["clientIpHeader","trustedHops","trustedProxies"]}$json$::jsonb -> p_namespace)), '{}');
$$;
grant execute on function private.operator_keys(text) to anon, authenticated, service_role;

-- security.maxPasskeys caps the passkeys one person can add; 0 turns adding them off
create function private.limit_passkeys()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max int := coalesce((private.instance_setting('accounts') ->> 'maxPasskeys')::int, 5);
begin
  if (select count(*) from auth.mfa_factors
      where user_id = new.user_id and factor_type = 'webauthn') >= v_max then
    raise exception 'You can add at most % passkey(s)', v_max using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger auth_mfa_factors_limit_passkeys
  before insert on auth.mfa_factors
  for each row
  when (new.factor_type = 'webauthn')
  execute function private.limit_passkeys();
