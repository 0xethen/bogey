-- password sign-in that people set themselves once an instance admin allows it, an instance audit log,
-- and the caller's own sessions

-- people a platform admin let sign in with a password; everyone else signs in by email
create table public.password_logins (
  user_id uuid primary key references public.profiles on delete cascade,
  granted_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now()
);
create index password_logins_granted_by_fk_idx on public.password_logins (granted_by);
alter table public.password_logins enable row level security;
create policy password_logins_select on public.password_logins for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_platform_admin()));

-- the caller's own signed-in sessions, newest activity first; `current` is the one asking

create function public.my_sessions()
returns table (
  id uuid, created_at timestamptz, last_active timestamptz, user_agent text, ip text, aal text,
  current boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.created_at,
    coalesce(s.refreshed_at at time zone 'utc', s.updated_at, s.created_at),
    s.user_agent, host(s.ip), s.aal::text,
    s.id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid
  from auth.sessions s
  where s.user_id = (select auth.uid()) and (s.not_after is null or s.not_after > now())
  order by 3 desc
  limit 50;
$$;
grant execute on function public.my_sessions() to authenticated;

-- signs one of the caller's own sessions out; its refresh token goes with it
create function public.end_my_session(p_session uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from auth.sessions where id = p_session and user_id = (select auth.uid()) returning 1
  )
  select exists (select 1 from gone);
$$;
grant execute on function public.end_my_session(uuid) to authenticated;

create or replace function private.strip_password()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.password_logins where user_id = new.id)
    or exists (select 1 from public.platform_admins where user_id = new.id) then
    return new;
  end if;
  new.encrypted_password := null;
  return new;
end;
$$;

-- who changed what across the instance (admins, password sign-in); only platform admins read it
create table public.instance_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles on delete set null,
  action text not null check (action ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9_-]*)+$'),
  target_id uuid,
  meta jsonb not null default '{}' check (octet_length(meta::text) <= 4096),
  created_at timestamptz not null default now()
);
create index instance_audit_created_idx on public.instance_audit (created_at desc);
create index instance_audit_actor_id_fk_idx on public.instance_audit (actor_id);
alter table public.instance_audit enable row level security;
create policy instance_audit_select on public.instance_audit for select to authenticated
  using ((select private.is_platform_admin()));

create function private.audit_instance(p_action text, p_target uuid, p_meta jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.instance_audit (actor_id, action, target_id, meta)
  values ((select auth.uid()), p_action, p_target, coalesce(p_meta, '{}'));
$$;
revoke execute on function private.audit_instance(text, uuid, jsonb) from anon, authenticated;

drop function public.instance_people(text, integer);
create function public.instance_people(p_search text default null, p_limit integer default 100)
returns table (
  id uuid, name text, email text, joined_at timestamptz, orgs text[], admin boolean, password_login boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pattern text := '%' || replace(replace(replace(coalesce(trim(p_search), ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
begin
  if not private.is_platform_admin() then
    raise exception 'only platform admins can list people' using errcode = '42501';
  end if;
  return query
    select p.id, p.display_name, u.email::text, u.created_at,
      coalesce((select array_agg(o.name order by o.name)
        from public.org_members m join public.orgs o on o.id = m.org_id where m.user_id = p.id), '{}'),
      exists (select 1 from public.platform_admins a where a.user_id = p.id),
      exists (select 1 from public.password_logins l where l.user_id = p.id)
    from public.profiles p
    join auth.users u on u.id = p.id
    where p_search is null or trim(p_search) = ''
      or p.display_name ilike v_pattern or u.email ilike v_pattern
    order by exists (select 1 from public.platform_admins a where a.user_id = p.id) desc, p.display_name
    limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;
grant execute on function public.instance_people(text, integer) to authenticated;

create or replace function public.set_platform_admin(p_email text, p_admin boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if not private.is_platform_admin() then
    raise exception 'only platform admins can change admins' using errcode = '42501';
  end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'no account uses %; they need to sign in once first', p_email using errcode = 'P0002';
  end if;
  if p_admin then
    insert into public.platform_admins (user_id, granted_by) values (v_user, (select auth.uid()))
    on conflict do nothing;
    if found then
      perform private.audit_instance('platform.admin_added', v_user, '{}');
    end if;
  else
    if (select count(*) from public.platform_admins) <= 1 then
      raise exception 'an instance needs at least one admin' using errcode = '23514';
    end if;
    delete from public.platform_admins where user_id = v_user;
    if found then
      perform private.audit_instance('platform.admin_removed', v_user, '{}');
    end if;
  end if;
end;
$$;

-- lets someone set their own password; admins never pick it. Turning it off clears the password
-- and ends their sessions. Instance admins manage their own, behind their authenticator app.
create function public.set_password_login(p_user uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'only platform admins can change password logins' using errcode = '42501';
  end if;
  if exists (select 1 from public.platform_admins where user_id = p_user) then
    raise exception 'instance admins manage their own password' using errcode = '22023';
  end if;
  if p_enabled then
    insert into public.password_logins (user_id, granted_by) values (p_user, (select auth.uid()))
    on conflict do nothing;
    if found then
      perform private.audit_instance('platform.password_on', p_user, '{}');
    end if;
  else
    delete from public.password_logins where user_id = p_user;
    if found then
      update auth.users set encrypted_password = null where id = p_user;
      delete from auth.sessions where user_id = p_user;
      perform private.audit_instance('platform.password_off', p_user, '{}');
    end if;
  end if;
end;
$$;
grant execute on function public.set_password_login(uuid, boolean) to authenticated;
