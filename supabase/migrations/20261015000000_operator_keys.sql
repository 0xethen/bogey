-- operator keys: settings only bogey.config.ts or the CLI change (ADR 0029)

-- the bottom of every setting's chain: defaults → instance → org → event
create or replace function private.setting_defaults(p_namespace text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce($json${"branding":{},"registration":{"signup":"invite","mode":"review","capacity":0,"autoPromote":true},"email":{},"tenancy":{},"accounts":{"deletionRequests":true,"requireAdminMfa":true,"portfolios":false},"signin":{"providers":[]},"audit":{"retentionDays":60},"access":{"allowedNetworks":[],"onlyUsers":[],"onlyTeams":[],"onlyDivisions":[]},"network":{"clientIpHeader":"x-forwarded-for","trustedHops":1,"trustedProxies":[]},"seo":{"indexing":true},"limits":{},"submissions":{"autoSubmit":false,"deletion":"allow","reminderHours":24,"publicToggle":false},"schedule":{"display":"list","hiddenWindows":[],"showEventTimezone":false},"agenda":{"kinds":[],"reminderMinutes":30},"home":{"layout":{"main":[{"id":"next-steps","type":"next-steps"},{"id":"agenda","type":"agenda"}],"aside":[{"id":"announcements","type":"announcements"},{"id":"facts","type":"facts"},{"id":"prizes","type":"prizes"},{"id":"about","type":"about"},{"id":"briefing","type":"briefing"}]}},"identity":{"enabled":false},"chat":{"enabled":true,"staff":true,"participants":true,"judges":false,"copyTeam":true},"certificates":{"enabled":false},"announcements":{"toasts":true,"urgentStays":true,"postAs":"author","judges":false},"teams":{"disband":"captain","board":true,"switching":true,"askOrganizer":true,"creation":"participants","leaveLimit":2},"divisions":{"askOnJoin":true},"venue":{},"privacy":{"agenda":"members","tracks":"public"},"briefing":{},"checkin":{"confirmName":true,"allowWalkIns":false,"badgeEmailHours":24,"requiredToCompete":false},"voting":{"enabled":false,"who":"participants","votesPerPerson":1,"ownTeam":false,"showCounts":false},"judging":{"blind":false,"showRankings":"organizers","normalize":"none","minJudges":2,"shareWithTeams":"feedback"},"plugins":{"enabled":[]}}$json$::jsonb -> p_namespace, '{}');
$$;
grant execute on function private.setting_defaults(text)
to anon, authenticated, service_role, supabase_auth_admin;

-- instance-level keys only the operator sets, from bogey.config.ts or the CLI
create function private.operator_keys(p_namespace text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array(select jsonb_array_elements_text($json${"tenancy":["appUrl"],"accounts":["requireAdminMfa"],"network":["clientIpHeader","trustedHops","trustedProxies"]}$json$::jsonb -> p_namespace)), '{}');
$$;
grant execute on function private.operator_keys(text) to anon, authenticated, service_role;

create function private.guard_operator_keys()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_row public.settings := case when tg_op = 'DELETE' then old else new end;
  v_old jsonb := case when tg_op = 'INSERT' then '{}' else old.value end;
  v_new jsonb := case when tg_op = 'DELETE' then '{}' else new.value end;
  v_key text;
begin
  if v_row.scope = 'instance' and current_user in ('anon', 'authenticated') then
    foreach v_key in array private.operator_keys(v_row.namespace) loop
      if (v_old -> v_key) is distinct from (v_new -> v_key) then
        raise exception '%.% can no longer be changed in the app. Set it in bogey.config.ts or with the CLI',
          v_row.namespace, v_key using errcode = '42501';
      end if;
    end loop;
  end if;
  return v_row;
end;
$$;

create trigger settings_operator_keys before insert or update or delete on public.settings
  for each row execute function private.guard_operator_keys();

create function private.is_admin_only_namespace(p_namespace text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_namespace in ('network', 'tenancy', 'limits') or p_namespace like 'plugin.%.limits';
$$;

grant execute on function private.is_admin_only_namespace(text)
to anon, authenticated, service_role, supabase_auth_admin;

drop policy settings_select on public.settings;
create policy settings_select on public.settings for select to anon, authenticated
  using (
    case scope
      when 'instance' then not private.is_admin_only_namespace(namespace)
        or (select private.is_platform_admin())
      when 'org' then private.is_public_namespace(namespace) or (select private.is_org_member(org_id))
      when 'event' then (select private.can_view_event(event_id))
        and (private.is_public_namespace(namespace)
          or (select private.has_permission(event_id, 'event.view')))
    end
  );
