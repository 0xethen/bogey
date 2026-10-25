-- "View as": a manager previewing a role sends x-bogey-view-as, and the helpers below answer as that
-- role. It only ever narrows: no platform admin, an org role of member, and in an event the role's
-- own grants within the caller's real ones (as previewAccess does in the app).
create function private.view_as()
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

create function private.is_platform_admin()
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

create function private.real_org_role(p_org uuid)
returns public.org_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.org_members where org_id = p_org and user_id = (select auth.uid());
$$;

create function private.org_role(p_org uuid)
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

create function private.real_event_role(p_event uuid)
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
create function private.real_holds_permission(p_event uuid, p_permission text)
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
create function private.previewed_role(p_event uuid)
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

create function private.event_role(p_event uuid)
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
create function private.holds_permission(p_event uuid, p_permission text)
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

-- The events where the caller holds a permission. Policies test `event_id = any ((select
-- private.events_where(...))::uuid[])`, which runs once per statement; `(select private.has_permission(event_id,
-- ...))` names a column, so it runs once per row. Only events where the caller could hold anything are
-- asked: those in orgs they administer and those they're an active member of.
create function private.events_where(p_permission text)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(c.id), '{}')
  from (
    select e.id from public.events e
    join public.org_members m on m.org_id = e.org_id
    where m.user_id = (select auth.uid()) and m.role >= 'admin'
    union
    select em.event_id from public.event_members em
    where em.user_id = (select auth.uid()) and em.status = 'active'
  ) c
  where private.has_permission(c.id, p_permission);
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

-- p_people_view is private.events_where('people.view'), passed in so a policy works it out once
create function private.can_see_profile(p_user uuid, p_people_view uuid[])
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
      where theirs.user_id = p_user and theirs.event_id = any (p_people_view)
    )
    or exists (
      select 1 from public.registrations r
      where r.user_id = p_user and r.event_id = any (p_people_view)
    );
$$;

grant execute on function
  private.view_as(),
  private.is_platform_admin(),
  private.real_org_role(uuid),
  private.org_role(uuid),
  private.is_org_member(uuid),
  private.is_org_admin(uuid),
  private.event_org(uuid),
  private.real_event_role(uuid),
  private.real_holds_permission(uuid, text),
  private.previewed_role(uuid),
  private.event_role(uuid),
  private.holds_permission(uuid, text),
  private.event_gate(uuid),
  private.has_permission(uuid, text),
  private.can_manage(uuid),
  private.events_where(text),
  private.window_open(uuid, text),
  private.can_view_event(uuid),
  private.section_open(uuid, text),
  private.is_public_event(uuid),
  private.my_team(uuid),
  private.is_team_member(uuid),
  private.shares_org(uuid),
  private.can_see_profile(uuid, uuid[])
to anon, authenticated, service_role;
grant execute on function public.event_gate(uuid) to authenticated;
