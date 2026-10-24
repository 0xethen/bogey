-- blocked_access_area: the blocked-access log says which area was refused
drop function public.record_blocked_access(uuid);
drop function public.event_blocked_access(uuid);

create function public.record_blocked_access(p_event uuid, p_area text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_event, 'event.view') or private.network_allowed(p_event, p_area) then
    return false;
  end if;
  if not exists (
    select 1 from public.audit_log
    where event_id = p_event and actor_id = (select auth.uid()) and action = 'access.denied'
      and meta ->> 'area' is not distinct from p_area
      and created_at > now() - interval '10 minutes'
  ) then
    perform private.audit(p_event, 'access.denied', null, null,
      jsonb_strip_nulls(jsonb_build_object('ip', host(private.request_ip()), 'area', p_area)));
  end if;
  return true;
end;
$$;
grant execute on function public.record_blocked_access(uuid, text) to authenticated;

create function public.event_blocked_access(p_event uuid)
returns table (at timestamptz, name text, ip text, area text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_manage(p_event) then
    raise exception 'only organizers can see blocked attempts' using errcode = '42501';
  end if;
  return query
    select a.created_at, p.display_name, a.meta ->> 'ip', a.meta ->> 'area'
    from public.audit_log a
    left join public.profiles p on p.id = a.actor_id
    where a.event_id = p_event and a.action = 'access.denied'
    order by a.created_at desc
    limit 20;
end;
$$;
grant execute on function public.event_blocked_access(uuid) to authenticated;
