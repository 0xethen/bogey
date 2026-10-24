-- view_as: "view as" narrows access in the database too, so every query answers as the previewed role
-- "View as": a manager previewing a role sends x-bogey-view-as, and the helpers below answer as that
-- role. It only ever narrows: no platform admin, an org role of member, and in an event the role's
-- own grants within the caller's real ones (as previewAccess does in the app).
create or replace function private.view_as()
returns public.event_role
language sql
stable
security definer
set search_path = ''
as $$
  select case nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-bogey-view-as'
    when 'participant' then 'participant'::public.event_role
    when 'staff' then 'staff'::public.event_role
    when 'judge' then 'judge'::public.event_role
  end;
$$;

create or replace function private.is_platform_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.view_as() is not null
     or not exists (select 1 from public.platform_admins where user_id = (select auth.uid())) then
    return false;
  end if;
  return not private.admin_mfa_required()
    or coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2';
end;
$$;

create or replace function private.real_org_role(p_org uuid)
returns public.org_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.org_members where org_id = p_org and user_id = (select auth.uid());
$$;

create or replace function private.org_role(p_org uuid)
returns public.org_role
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.view_as() is null then private.real_org_role(p_org)
    when private.real_org_role(p_org) is not null then 'member'::public.org_role
  end;
$$;

create or replace function private.is_org_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.org_role(p_org) is not null;
$$;

create or replace function private.is_org_admin(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.org_role(p_org) >= 'admin', false);
$$;

create or replace function private.event_org(p_event uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select org_id from public.events where id = p_event;
$$;

create or replace function private.real_event_role(p_event uuid)
returns public.event_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.event_members
  where event_id = p_event and user_id = (select auth.uid()) and status = 'active';
$$;

-- What the caller's own roles grant, ignoring "view as".
create or replace function private.real_holds_permission(p_event uuid, p_permission text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role public.event_role;
  v_takers jsonb;
begin
  if v_uid is null then
    return false;
  end if;

  if coalesce(private.real_org_role(private.event_org(p_event)) >= 'admin', false) then
    return true;
  end if;

  v_role := private.real_event_role(p_event);
  if v_role is null then
    return false;
  end if;
  if v_role = 'organizer' then
    return true;
  end if;

  -- who takes attendance is the event's checkin.takers, not the role matrix: roles, and tags as
  -- "tag:<id>"; a plugin role can still grant it below
  if p_permission in ('people.checkin', 'sessions.attendance') then
    v_takers := coalesce(private.event_setting(p_event, 'checkin') -> 'takers', '["organizer","staff"]');
    if v_takers ? v_role::text or exists (
      select 1 from unnest(private.held_tags(p_event, v_uid)) held(id)
      where v_takers ? ('tag:' || held.id::text)
    ) then
      return true;
    end if;
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
  ) or private.tags_grant(p_event, v_uid, p_permission);
end;
$$;

-- the role the caller is previewing in this event; only someone who manages it can
create or replace function private.previewed_role(p_event uuid)
returns public.event_role
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.view_as() is null then null
    when private.real_holds_permission(p_event, 'event.manage') then private.view_as()
  end;
$$;

create or replace function private.event_role(p_event uuid)
returns public.event_role
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.previewed_role(p_event), private.real_event_role(p_event));
$$;

-- What the caller's roles grant, whatever plugins say. Only a plugin's own gate-time RPCs (reporting
-- that the page is back in full screen, say) use this; everything else asks has_permission. While
-- previewing, it's the role's own grants (no plugin roles or tags) within the real ones.
create or replace function private.holds_permission(p_event uuid, p_permission text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_preview public.event_role := private.previewed_role(p_event);
begin
  if not private.real_holds_permission(p_event, p_permission) then
    return false;
  end if;
  if v_preview is null then
    return true;
  end if;
  if p_permission in ('people.checkin', 'sessions.attendance')
     and coalesce(private.event_setting(p_event, 'checkin') -> 'takers', '["organizer","staff"]') ? v_preview::text then
    return true;
  end if;
  return exists (
    select 1 from public.role_permissions
    where role_key = v_preview::text and permission = p_permission
  );
end;
$$;

-- Why a plugin has closed the event to this participant ('<plugin>.<reason>'), or null. A plugin
-- closes it by defining private.<key>_gate(uuid) returning a reason or null; only participants are
-- ever gated, so organizers, staff, judges and org admins always get through, previewing or not.
create or replace function private.event_gate(p_event uuid)
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
  if private.real_event_role(p_event) is distinct from 'participant'
     or coalesce(private.real_org_role(private.event_org(p_event)) >= 'admin', false) then
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

grant execute on function
  private.view_as(),
  private.real_org_role(uuid),
  private.real_event_role(uuid),
  private.real_holds_permission(uuid, text),
  private.previewed_role(uuid)
to anon, authenticated, service_role;
