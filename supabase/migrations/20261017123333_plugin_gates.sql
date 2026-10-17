-- plugin_gates: a plugin can close an event to a participant (private.<key>_gate). A gated
-- participant holds no permission there; has_permission's old body is now holds_permission.

-- What the caller's roles grant, whatever plugins say. Only a plugin's own gate-time RPCs (reporting
-- that the page is back in full screen, say) use this; everything else asks has_permission.
create or replace function private.holds_permission(p_event uuid, p_permission text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role public.event_role;
begin
  if v_uid is null then
    return false;
  end if;

  if private.is_org_admin(private.event_org(p_event)) then
    return true;
  end if;

  v_role := private.event_role(p_event);
  if v_role is null then
    return false;
  end if;
  if v_role = 'organizer' then
    return true;
  end if;

  return exists (
    select 1 from public.role_permissions rp
    where rp.permission = p_permission
      and (
        rp.role_key = v_role::text
        or rp.role_key in (
          select g.role_key from public.event_role_grants g
          where g.event_id = p_event and g.user_id = v_uid
        )
      )
  );
end;
$$;

-- Why a plugin has closed the event to this participant ('<plugin>.<reason>'), or null. A plugin
-- closes it by defining private.<key>_gate(uuid) returning a reason or null; only participants are
-- ever gated, so organizers, staff, judges and org admins always get through.
create function private.event_gate(p_event uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_reason text;
begin
  if private.event_role(p_event) is distinct from 'participant'
     or private.is_org_admin(private.event_org(p_event)) then
    return null;
  end if;
  for v_key in
    select jsonb_array_elements_text(s.value -> 'enabled')
    from public.settings s
    where s.scope = 'event' and s.event_id = p_event and s.namespace = 'plugins'
      and jsonb_typeof(s.value -> 'enabled') = 'array'
  loop
    if to_regprocedure(format('private.%I(uuid)', v_key || '_gate')) is not null
       and private.plugin_enabled(p_event, v_key) then
      execute format('select private.%I($1)', v_key || '_gate') into v_reason using p_event;
      if v_reason is not null then
        return v_key || '.' || v_reason;
      end if;
    end if;
  end loop;
  return null;
end;
$$;

-- a gated participant holds no permission in the event, so its pages and data stay shut on the
-- server too, not only behind the plugin's cover
create or replace function private.has_permission(p_event uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.holds_permission(p_event, p_permission) and private.event_gate(p_event) is null;
$$;

-- for the event route: where a gated participant is sent, and why
create function public.event_gate(p_event uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select private.event_gate(p_event);
$$;

grant execute on function private.holds_permission(uuid, text), private.event_gate(uuid)
to anon, authenticated, service_role;
grant execute on function public.event_gate(uuid) to authenticated;

-- which plugins are on and their settings: a participant a plugin has gated still reads these, so
-- the plugin can show why and let them back in
create function private.is_gate_namespace(p_namespace text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_namespace = 'plugins' or p_namespace like 'plugin.%';
$$;

grant execute on function private.is_gate_namespace(text) to anon, authenticated, service_role;

create or replace function public.settings_for(p_namespaces text[], p_org uuid default null, p_event uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := coalesce(p_org, private.event_org(p_event));
  v_member boolean;
  v_out jsonb := '{}';
  v_ns text;
begin
  if p_event is not null and not private.can_view_event(p_event) then
    return v_out;
  end if;
  v_member := case
    when p_event is not null then private.has_permission(p_event, 'event.view')
    else private.is_org_member(v_org)
  end;

  foreach v_ns in array p_namespaces loop
    if private.is_public_namespace(v_ns) or v_member
      or (v_ns = 'about' and p_event is not null and private.section_open(p_event, 'about'))
      or (p_event is not null and private.is_gate_namespace(v_ns)
        and private.holds_permission(p_event, 'event.view')) then
      v_out := v_out || jsonb_build_object(v_ns, case
        when p_event is not null then private.event_setting(p_event, v_ns)
        when v_org is not null then private.org_setting(v_org, v_ns)
        else private.instance_setting(v_ns)
      end);
    end if;
  end loop;
  return v_out;
end;
$$;

drop policy settings_select on public.settings;
create policy settings_select on public.settings for select to anon, authenticated
  using (
    case scope
      when 'instance' then not private.is_admin_only_namespace(namespace)
        or (select private.is_platform_admin())
      when 'org' then private.is_public_namespace(namespace) or (select private.is_org_member(org_id))
      when 'event' then (select private.can_view_event(event_id))
        and (private.is_public_namespace(namespace)
          or (select private.has_permission(event_id, 'event.view'))
          or (namespace = 'about' and (select private.section_open(event_id, 'about')))
          or (private.is_gate_namespace(namespace)
            and (select private.holds_permission(event_id, 'event.view'))))
    end
  );
