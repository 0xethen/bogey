-- access_default: new events are invite-only unless an organizer chose otherwise

-- Events that never chose how people join keep the old default (organizers approve).
insert into public.settings (scope, event_id, namespace, value)
select 'event', e.id, 'registration', '{"mode":"review"}'::jsonb
from public.events e
where not exists (
  select 1 from public.settings s
  where s.namespace = 'registration' and s.value ? 'mode'
    and ((s.scope = 'event' and s.event_id = e.id)
      or (s.scope = 'org' and s.org_id = e.org_id)
      or s.scope = 'instance')
)
on conflict (scope, org_id, event_id, namespace)
do update set value = public.settings.value || '{"mode":"review"}'::jsonb;

create or replace function private.setting_defaults(p_namespace text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce($json${"branding":{},"registration":{"signup":"invite","mode":"invite","capacity":0,"autoPromote":true},"email":{},"tenancy":{},"accounts":{"deletionRequests":true,"requireAdminMfa":true,"portfolios":false,"deviceSignOut":false,"maxPasskeys":5},"signin":{"providers":[]},"audit":{"retentionDays":60},"access":{"allowedNetworks":[],"onlyUsers":[],"onlyTeams":[],"onlyDivisions":[]},"network":{"clientIpHeader":"x-forwarded-for","trustedHops":1,"trustedProxies":[]},"seo":{"indexing":true},"limits":{},"submissions":{"autoSubmit":false,"deletion":"allow","reminderHours":24,"publicToggle":false},"schedule":{"display":"list","hiddenWindows":[],"showEventTimezone":false},"agenda":{"kinds":[],"reminderMinutes":5,"tabMenu":true},"home":{"layout":{"main":[{"id":"next-steps","type":"next-steps"},{"id":"agenda","type":"agenda"}],"aside":[{"id":"announcements","type":"announcements"},{"id":"facts","type":"facts"},{"id":"prizes","type":"prizes"},{"id":"about","type":"about"}]}},"tabs":{"items":[]},"identity":{"enabled":false},"chat":{"enabled":true,"staff":true,"participants":false,"judges":false,"copyTeam":true},"certificates":{"enabled":false},"announcements":{"toasts":true,"urgentStays":true,"postAs":"author","judges":false},"teams":{"disband":"captain","board":false,"switching":true,"askOrganizer":true,"creation":"participants","leaveLimit":0},"divisions":{"askOnJoin":true},"venue":{},"privacy":{"about":"members","agenda":"members","tracks":"public"},"about":{},"checkin":{"confirmName":true,"allowWalkIns":false,"badgeEmailHours":24,"requiredToCompete":false,"takers":["organizer","staff"]},"gallery":{"layout":"grid","switchLayout":true,"banners":true,"teamBanners":true,"teamSizes":false,"winners":true,"likes":false,"comments":false,"sort":"newest","slideshow":true},"voting":{"enabled":false,"who":"participants","votesPerPerson":1,"ownTeam":false,"showCounts":false},"judging":{"blind":false,"showRankings":"organizers","normalize":"none","minJudges":2,"shareWithTeams":"feedback","judgeRubric":true,"teamRubric":false,"teamRubricShows":"name","deliberation":"assigned","flagGap":0,"holdFlagged":true,"judgeExport":"off","assignment":{"perProject":1,"rules":[],"exclude":[]}},"tags":{"eventTags":true},"plugins":{"enabled":[]}}$json$::jsonb -> p_namespace, '{}');
$$;
