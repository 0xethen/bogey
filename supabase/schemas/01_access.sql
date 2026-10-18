create function private.is_platform_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.platform_admins where user_id = (select auth.uid())) then
    return false;
  end if;
  return not private.admin_mfa_required()
    or coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2';
end;
$$;

create function private.org_role(p_org uuid)
returns public.org_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.org_members where org_id = p_org and user_id = (select auth.uid());
$$;

create function private.is_org_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.org_role(p_org) is not null;
$$;

create function private.is_org_admin(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.org_role(p_org) >= 'admin', false);
$$;

create function private.event_org(p_event uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select org_id from public.events where id = p_event;
$$;

create function private.event_role(p_event uuid)
returns public.event_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.event_members
  where event_id = p_event and user_id = (select auth.uid()) and status = 'active';
$$;

-- What the caller's roles grant, whatever plugins say. Only a plugin's own gate-time RPCs (reporting
-- that the page is back in full screen, say) use this; everything else asks has_permission.
create function private.holds_permission(p_event uuid, p_permission text)
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

  -- who takes attendance is the event's checkin.takers, not the role matrix; a plugin role can
  -- still grant it below
  if p_permission in ('people.checkin', 'sessions.attendance')
     and coalesce(private.event_setting(p_event, 'checkin') -> 'takers', '["organizer","staff"]')
       ? v_role::text then
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
  ) or private.tags_grant(p_event, v_uid, p_permission);
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
create function private.has_permission(p_event uuid, p_permission text)
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

create function private.can_manage(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_permission(p_event, 'event.manage');
$$;

create function private.window_open(p_event uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when w.override is not null then w.override = 'open'
      else (w.opens_at is null or w.opens_at <= now())
        and (w.closes_at is null or now() < w.closes_at)
        and (w.opens_at is not null or w.closes_at is not null)
    end
    from public.event_windows w
    where w.event_id = p_event and w.key = p_key
  ), false);
$$;

create function private.can_view_event(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event
      and (
        e.visibility = 'public'
        or (e.visibility = 'unlisted' and (
          private.is_org_member(e.org_id)
          or exists (
            select 1 from public.event_visitors v where v.event_id = e.id and v.user_id = (select auth.uid()))
          or exists (
            select 1 from public.registrations r where r.event_id = e.id and r.user_id = (select auth.uid()))
        ))
        or private.event_role(e.id) is not null
        or private.is_org_admin(e.org_id)
      )
  );
$$;

create function private.section_open(p_event uuid, p_section text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_permission(p_event, 'event.view')
    or (private.can_view_event(p_event)
      and coalesce(private.event_setting(p_event, 'privacy') ->> p_section, 'members') = 'public');
$$;

create function private.is_public_event(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.events where id = p_event and visibility = 'public');
$$;

create function private.my_team(p_event uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select team_id from public.team_members
  where event_id = p_event and user_id = (select auth.uid());
$$;

create function private.is_team_member(p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members where team_id = p_team and user_id = (select auth.uid())
  );
$$;

create function private.shares_org(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.org_members mine
    join public.org_members theirs on theirs.org_id = mine.org_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = p_user
  );
$$;

create function private.can_see_profile(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user = (select auth.uid())
    or private.shares_org(p_user)
    or exists (
      select 1
      from public.event_members mine
      join public.event_members theirs on theirs.event_id = mine.event_id
      where mine.user_id = (select auth.uid()) and mine.status = 'active'
        and theirs.user_id = p_user and theirs.status = 'active'
    )
    or exists (
      select 1
      from public.event_members mine
      join public.events e on e.id = mine.event_id
      join public.org_members admin on admin.org_id = e.org_id and admin.user_id = p_user
      where mine.user_id = (select auth.uid()) and mine.status = 'active' and admin.role >= 'admin'
    )
    or exists (
      select 1 from public.event_members theirs
      where theirs.user_id = p_user and private.has_permission(theirs.event_id, 'people.view')
    )
    or exists (
      select 1 from public.registrations r
      where r.user_id = p_user and private.has_permission(r.event_id, 'people.view')
    );
$$;

grant execute on function
  private.is_platform_admin(),
  private.org_role(uuid),
  private.is_org_member(uuid),
  private.is_org_admin(uuid),
  private.event_org(uuid),
  private.event_role(uuid),
  private.holds_permission(uuid, text),
  private.event_gate(uuid),
  private.has_permission(uuid, text),
  private.can_manage(uuid),
  private.window_open(uuid, text),
  private.can_view_event(uuid),
  private.section_open(uuid, text),
  private.is_public_event(uuid),
  private.my_team(uuid),
  private.is_team_member(uuid),
  private.shares_org(uuid),
  private.can_see_profile(uuid)
to anon, authenticated, service_role;
grant execute on function public.event_gate(uuid) to authenticated;
