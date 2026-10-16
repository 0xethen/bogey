-- platform admins can let someone sign in with a password

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

-- turning it off also clears the password, so it can't be used again later
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
  if p_enabled then
    insert into public.password_logins (user_id, granted_by) values (p_user, (select auth.uid()))
    on conflict do nothing;
  else
    delete from public.password_logins where user_id = p_user;
    update auth.users set encrypted_password = null where id = p_user;
  end if;
end;
$$;
grant execute on function public.set_password_login(uuid, boolean) to authenticated;
