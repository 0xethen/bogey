-- Certificates are turned on per event and no longer inherited from the organization, and an
-- event can give only some kinds (certificates.kinds; every kind when unset). Events that were on
-- keep certificates on where they already issued some; events on only through their organization
-- that issued none start off.

insert into public.settings (scope, event_id, namespace, value)
select 'event', e.id, 'certificates', '{"enabled": true}'::jsonb
from public.events e
where exists (select 1 from public.certificates c where c.event_id = e.id)
  and coalesce((private.event_setting(e.id, 'certificates') ->> 'enabled')::boolean, false)
on conflict (scope, org_id, event_id, namespace) do update
  set value = public.settings.value || '{"enabled": true}'::jsonb;

update public.settings
set value = value - 'enabled', locked_keys = array_remove(locked_keys, 'enabled')
where scope <> 'event' and namespace = 'certificates';

delete from public.settings
where scope <> 'event' and namespace = 'certificates' and value = '{}'::jsonb and locked_keys = '{}';

create or replace function private.certificate_options(p_event uuid, p_user uuid)
returns table (kind text, award_id uuid, label text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings jsonb := private.event_setting(p_event, 'certificates');
  v_kinds jsonb := case when jsonb_typeof(v_settings -> 'kinds') = 'array' then v_settings -> 'kinds' end;
  v_role public.event_role;
begin
  if not coalesce((v_settings ->> 'enabled')::boolean, false) then
    return;
  end if;
  select m.role into v_role from public.event_members m
  where m.event_id = p_event and m.user_id = p_user and m.status = 'active';
  if v_role is null then
    return;
  end if;
  if v_role = 'participant' then
    if (v_kinds is null or v_kinds ? 'participation') and (
      exists (select 1 from public.checkins c where c.event_id = p_event and c.user_id = p_user)
      or exists (
        select 1 from public.submissions s
        join public.team_members tm on tm.team_id = s.team_id and tm.user_id = p_user
        where s.event_id = p_event and s.status = 'submitted')) then
      return query select 'participation'::text, null::uuid, ''::text;
    end if;
    if (v_kinds is null or v_kinds ? 'award') and private.latest_publication(p_event) is not null then
      return query
      select 'award'::text, a.id, a.label
      from public.awards a
      join public.submissions s on s.id = a.submission_id
      join public.team_members tm on tm.team_id = s.team_id and tm.user_id = p_user
      where a.event_id = p_event;
    end if;
  elsif v_role = 'judge' and (v_kinds is null or v_kinds ? 'judge') then
    return query select 'judge'::text, null::uuid, ''::text;
  elsif v_role = 'staff' and (v_kinds is null or v_kinds ? 'volunteer') then
    return query select 'volunteer'::text, null::uuid, ''::text;
  end if;
end;
$$;
