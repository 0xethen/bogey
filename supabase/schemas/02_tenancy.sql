create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  slug extensions.citext not null unique
    check (slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
  name text not null check (length(name) between 1 and 120),
  status public.org_status not null default 'active',
  status_reason text check (length(status_reason) <= 500),
  status_changed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.org_domains (
  hostname extensions.citext primary key check (hostname ~ '^[a-z0-9.-]+(:[0-9]+)?$'),
  org_id uuid not null references public.orgs on delete cascade,
  is_primary boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index org_domains_org_id_idx on public.org_domains (org_id);
create unique index org_domains_one_primary on public.org_domains (org_id) where is_primary;

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null check (length(display_name) between 1 and 80),
  handle extensions.citext unique check (handle ~ '^[a-z0-9_]{2,32}$'),
  avatar_path text,
  timezone text,
  locale text,
  theme public.theme_pref not null default 'system',
  bio_md text not null default '' check (length(bio_md) <= 1000),
  pronouns text check (length(pronouns) <= 30),
  links jsonb not null default '[]' check (
    jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 8 and pg_column_size(links) <= 2000
  ),
  visibility text not null default 'org' check (visibility in ('org', 'public')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.org_members (
  org_id uuid not null references public.orgs on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  role public.org_role not null default 'member',
  invited_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index org_members_user_id_idx on public.org_members (user_id);
create index org_members_invited_by_fk_idx on public.org_members (invited_by);

create table public.platform_admins (
  user_id uuid primary key references public.profiles on delete cascade,
  granted_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now()
);
create index platform_admins_granted_by_fk_idx on public.platform_admins (granted_by);

create table public.user_preferences (
  user_id uuid not null references public.profiles on delete cascade,
  namespace text not null check (namespace ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
  key text not null check (key ~ '^[a-z][a-z0-9_]*(-[a-z0-9_]+)*$'),
  value jsonb not null check (octet_length(value::text) <= 4096),
  updated_at timestamptz not null default now(),
  primary key (user_id, namespace, key)
);

create trigger orgs_touch before update on public.orgs
  for each row execute function private.touch_updated_at();
create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();
create trigger org_members_touch before update on public.org_members
  for each row execute function private.touch_updated_at();
create trigger user_preferences_touch before update on public.user_preferences
  for each row execute function private.touch_updated_at();

create function private.guard_org_owners()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := coalesce(new.org_id, old.org_id);
begin
  if (select auth.uid()) is null then
    return coalesce(new, old);
  end if;

  if (tg_op <> 'INSERT' and old.role = 'owner') or (tg_op <> 'DELETE' and new.role = 'owner') then
    if private.org_role(v_org) is distinct from 'owner' and not private.is_platform_admin() then
      raise exception 'only an owner can change who owns this org' using errcode = '42501';
    end if;
  end if;

  if tg_op <> 'INSERT' and old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner')
     and not exists (
       select 1 from public.org_members
       where org_id = v_org and role = 'owner' and user_id <> old.user_id
     ) then
    raise exception 'an organization needs at least one owner' using errcode = '23514';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger org_members_guard_owners
  before insert or update or delete on public.org_members
  for each row execute function private.guard_org_owners();

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

-- signs one of the caller's own sessions out; its refresh token goes with it.
-- off unless the operator sets security.deviceSignOut: a stolen session could end the real one
create function public.end_my_session(p_session uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce((private.instance_setting('accounts') ->> 'deviceSignOut')::boolean, false) then
    raise exception 'Signing out other devices is turned off on this instance'
      using errcode = '42501';
  end if;
  delete from auth.sessions where id = p_session and user_id = (select auth.uid());
  return found;
end;
$$;
grant execute on function public.end_my_session(uuid) to authenticated;

create function private.strip_password()
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

create trigger auth_users_strip_password
  before insert or update of encrypted_password on auth.users
  for each row
  when (new.encrypted_password is not null and new.encrypted_password <> '')
  execute function private.strip_password();

-- security.maxPasskeys caps the passkeys one person can add; 0 turns adding them off
create function private.limit_passkeys()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max int := coalesce((private.instance_setting('accounts') ->> 'maxPasskeys')::int, 5);
begin
  if (select count(*) from auth.mfa_factors
      where user_id = new.user_id and factor_type = 'webauthn') >= v_max then
    raise exception 'You can add at most % passkey(s)', v_max using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger auth_mfa_factors_limit_passkeys
  before insert on auth.mfa_factors
  for each row
  when (new.factor_type = 'webauthn')
  execute function private.limit_passkeys();

-- renames one of the caller's own passkeys; GoTrue has no endpoint for it
create function public.rename_passkey(p_factor uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  if v_name = '' or char_length(v_name) > 64 then
    raise exception 'A passkey''s name is 1 to 64 characters' using errcode = '22023';
  end if;
  update auth.mfa_factors set friendly_name = v_name, updated_at = now()
  where id = p_factor and user_id = (select auth.uid()) and factor_type = 'webauthn';
  if not found then
    raise exception 'That passkey isn''t yours' using errcode = '42501';
  end if;
exception when unique_violation then
  raise exception 'You already have a passkey with that name' using errcode = '23505';
end;
$$;
grant execute on function public.rename_passkey(uuid, text) to authenticated;

create function private.signup_org(p_user_metadata jsonb)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select id from public.orgs where slug = (p_user_metadata ->> 'org')::extensions.citext),
    (select nullif(value ->> 'defaultOrg', '')::uuid from public.settings
      where scope = 'instance' and namespace = 'tenancy')
  );
$$;

create function private.before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.signup_org(event -> 'user' -> 'user_metadata');
  v_email extensions.citext := (event -> 'user' ->> 'email')::extensions.citext;
  v_mode text;
begin
  if coalesce((event -> 'user' -> 'app_metadata' ->> 'bogey_provisioned')::boolean, false) then
    return '{}'::jsonb;
  end if;

  if v_org is null then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'No organization matches this address.'));
  end if;

  if exists (select 1 from public.orgs where id = v_org and status <> 'active') then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'This organization is not accepting sign-ins.'));
  end if;

  v_mode := private.org_setting(v_org, 'registration') ->> 'signup';

  if v_mode = 'open' then
    return '{}'::jsonb;
  end if;

  if v_mode = 'invite' and exists (
    select 1 from public.invite_links l
    join public.events e on e.id = l.event_id
    join public.invite_link_view(l.token) v on v.is_open
    where l.token = event -> 'user' -> 'user_metadata' ->> 'invite' and e.org_id = v_org
  ) then
    return '{}'::jsonb;
  end if;

  if v_mode = 'invite' and exists (
    select 1 from public.registrations r
    join public.events e on e.id = r.event_id
    where e.org_id = v_org and r.email = v_email and r.status in ('pending', 'approved')
  ) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', case v_mode
      when 'closed' then 'Sign-ups are closed.'
      else 'You haven''t been invited to an event yet. Ask an organizer for an invite.'
    end));
end;
$$;

grant execute on function private.before_user_created(jsonb) to supabase_auth_admin;
grant execute on function private.signup_org(jsonb) to supabase_auth_admin;

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.signup_org(new.raw_user_meta_data);
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(new.email, '@', 1), ''),
      'New user'
    ), 80)
  );

  if v_org is not null
     and private.org_setting(v_org, 'registration') ->> 'signup' = 'open' then
    insert into public.org_members (org_id, user_id) values (v_org, new.id)
    on conflict do nothing;
  end if;

  update public.registrations set user_id = new.id
  where email = new.email::extensions.citext and user_id is null;

  return new;
end;
$$;

create trigger auth_users_handle_new_user
  after insert on auth.users
  for each row execute function private.handle_new_user();

insert into public.profiles (id, display_name)
select u.id, left(coalesce(nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''), split_part(u.email, '@', 1), 'User'), 80)
from auth.users u
on conflict (id) do nothing;

alter table public.orgs enable row level security;
alter table public.org_domains enable row level security;
alter table public.profiles enable row level security;
alter table public.org_members enable row level security;
alter table public.platform_admins enable row level security;
alter table public.user_preferences enable row level security;

create policy orgs_select on public.orgs for select to anon, authenticated
  using (status = 'active' or (select private.is_org_member(id)) or (select private.is_platform_admin()));
create policy orgs_insert on public.orgs for insert to authenticated
  with check ((select private.is_platform_admin()));
create policy orgs_update on public.orgs for update to authenticated
  using ((select private.is_org_admin(id)) or (select private.is_platform_admin()));
create policy orgs_delete on public.orgs for delete to authenticated
  using ((select private.is_platform_admin()));

create policy org_domains_select on public.org_domains for select to anon, authenticated
  using (true);
create policy org_domains_write_insert on public.org_domains for insert to authenticated
  with check ((select private.is_platform_admin()));
create policy org_domains_write_update on public.org_domains for update to authenticated
  using ((select private.is_platform_admin()))
  with check ((select private.is_platform_admin()));
create policy org_domains_write_delete on public.org_domains for delete to authenticated
  using ((select private.is_platform_admin()));

create policy profiles_select on public.profiles for select to authenticated
  using ((select private.can_see_profile(id)));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy org_members_select on public.org_members for select to authenticated
  using ((select private.is_org_member(org_id)) or (select private.is_platform_admin()));
create policy org_members_insert on public.org_members for insert to authenticated
  with check ((select private.is_org_admin(org_id)) or (select private.is_platform_admin()));
create policy org_members_update on public.org_members for update to authenticated
  using ((select private.is_org_admin(org_id)) or (select private.is_platform_admin()));
create policy org_members_delete on public.org_members for delete to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.is_org_admin(org_id))
    or (select private.is_platform_admin())
  );

create policy platform_admins_select on public.platform_admins for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_platform_admin()));

create policy user_preferences_own on public.user_preferences for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create function private.org_id_for_host(p_host text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select d.org_id from public.org_domains d
      where d.hostname in (lower(p_host)::extensions.citext, split_part(lower(p_host), ':', 1)::extensions.citext)
      order by d.hostname = lower(p_host)::extensions.citext desc
      limit 1),
    (select nullif(value ->> 'defaultOrg', '')::uuid from public.settings
      where scope = 'instance' and namespace = 'tenancy')
  );
$$;

create function public.org_for_host(p_host text)
returns table (id uuid, slug extensions.citext, name text, status public.org_status, status_reason text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.slug, o.name, o.status, o.status_reason
  from public.orgs o
  where o.status <> 'suspended' and o.id = private.org_id_for_host(p_host);
$$;

create function public.suspended_org_for_host(p_host text)
returns table (name text, reason text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name, o.status_reason
  from public.orgs o
  where o.status = 'suspended' and o.id = private.org_id_for_host(p_host);
$$;
grant execute on function public.org_for_host(text), public.suspended_org_for_host(text) to anon, authenticated;
