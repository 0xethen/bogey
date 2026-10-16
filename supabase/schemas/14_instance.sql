create function public.admin_mfa_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'admin', exists (select 1 from public.platform_admins where user_id = (select auth.uid())),
    'required', private.admin_mfa_required(),
    'aal', coalesce((select auth.jwt() ->> 'aal'), 'aal1'));
$$;

create function public.instance_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_migrations jsonb;
begin
  if not private.is_platform_admin() then
    raise exception 'only platform admins can see the instance' using errcode = '42501';
  end if;
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'select coalesce(jsonb_agg(version order by version), ''[]'') from supabase_migrations.schema_migrations'
      into v_migrations;
  end if;
  return jsonb_build_object(
    'orgs', (select count(*) from public.orgs),
    'events', (select count(*) from public.events),
    'people', (select count(*) from public.profiles),
    'admins', (select count(*) from public.platform_admins),
    'migrations', v_migrations,
    'set_up_at', (select min(created_at) from public.orgs),
    'settings_changed_at', (select max(updated_at) from public.settings),
    'outbox', private.email_outbox_stats()
  );
end;
$$;

create function public.instance_orgs()
returns table (
  id uuid, slug extensions.citext, name text, status public.org_status, status_reason text, created_at timestamptz,
  members integer, events integer, hostnames text[], owners text[], admins integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'only platform admins can list organizations' using errcode = '42501';
  end if;
  return query
    select o.id, o.slug, o.name, o.status, o.status_reason, o.created_at,
      (select count(*)::integer from public.org_members m where m.org_id = o.id),
      (select count(*)::integer from public.events e where e.org_id = o.id),
      coalesce((select array_agg(d.hostname::text order by d.is_primary desc, d.hostname)
        from public.org_domains d where d.org_id = o.id), '{}'),
      coalesce((select array_agg(p.display_name order by m.created_at)
        from public.org_members m join public.profiles p on p.id = m.user_id
        where m.org_id = o.id and m.role = 'owner'), '{}'),
      (select count(*)::integer from public.org_members m
        where m.org_id = o.id and m.role in ('owner', 'admin'))
    from public.orgs o
    order by o.created_at;
end;
$$;

create function public.instance_people(p_search text default null, p_limit integer default 100)
returns table (
  id uuid, name text, email text, joined_at timestamptz, orgs text[], admin boolean
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
      exists (select 1 from public.platform_admins a where a.user_id = p.id)
    from public.profiles p
    join auth.users u on u.id = p.id
    where p_search is null or trim(p_search) = ''
      or p.display_name ilike v_pattern or u.email ilike v_pattern
    order by exists (select 1 from public.platform_admins a where a.user_id = p.id) desc, p.display_name
    limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

create function public.create_org(p_slug text, p_name text, p_hostname text default null, p_owner_email text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_owner uuid;
begin
  if not private.is_platform_admin() then
    raise exception 'only platform admins can create organizations' using errcode = '42501';
  end if;
  if p_owner_email is not null then
    select id into v_owner from auth.users where lower(email) = lower(trim(p_owner_email));
    if v_owner is null then
      raise exception 'no account uses %; they need to sign in once first', p_owner_email using errcode = 'P0002';
    end if;
  end if;

  insert into public.orgs (slug, name) values (lower(trim(p_slug)), trim(p_name)) returning id into v_org;
  if nullif(trim(p_hostname), '') is not null then
    insert into public.org_domains (hostname, org_id, is_primary, verified_at)
    values (lower(trim(p_hostname)), v_org, true, now());
  end if;
  insert into public.org_members (org_id, user_id, role)
  values (v_org, coalesce(v_owner, (select auth.uid())), 'owner');

  perform private.audit_org(v_org, 'org.created', 'org', v_org,
    jsonb_build_object('slug', lower(trim(p_slug)), 'hostname', p_hostname));
  return v_org;
end;
$$;

create function public.set_org_status(p_org uuid, p_status public.org_status, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(trim(p_reason), '');
begin
  if not private.is_platform_admin() then
    raise exception 'only platform admins can change an organization''s status' using errcode = '42501';
  end if;
  update public.orgs
  set status = p_status,
    status_reason = case when p_status = 'active' then null else v_reason end,
    status_changed_at = now()
  where id = p_org and (status <> p_status or status_reason is distinct from v_reason);
  if found then
    perform private.audit_org(p_org,
      case p_status when 'suspended' then 'org.suspended' when 'restricted' then 'org.restricted'
        else 'org.reactivated' end,
      'org', p_org, jsonb_build_object('reason', v_reason));
  end if;
end;
$$;

create function public.instance_admins()
returns table (user_id uuid, name text, email text, granted_by_name text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'only platform admins can list admins' using errcode = '42501';
  end if;
  return query
    select a.user_id, p.display_name, u.email::text, g.display_name, a.created_at
    from public.platform_admins a
    join public.profiles p on p.id = a.user_id
    join auth.users u on u.id = a.user_id
    left join public.profiles g on g.id = a.granted_by
    order by a.created_at;
end;
$$;

create function public.set_platform_admin(p_email text, p_admin boolean)
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
  else
    if (select count(*) from public.platform_admins) <= 1 then
      raise exception 'an instance needs at least one admin' using errcode = '23514';
    end if;
    delete from public.platform_admins where user_id = v_user;
  end if;
end;
$$;

create table public.org_limit_overrides (
  org_id uuid primary key references public.orgs on delete cascade,
  limits jsonb not null default '{}' check (jsonb_typeof(limits) = 'object'),
  updated_by uuid references public.profiles on delete set null,
  updated_at timestamptz not null default now()
);
create index org_limit_overrides_updated_by_fk_idx on public.org_limit_overrides (updated_by);
alter table public.org_limit_overrides enable row level security;
create policy org_limit_overrides_admin on public.org_limit_overrides for all to authenticated
  using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()));

create function private.org_limit(p_org uuid, p_key text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when o.limits ? p_key then (o.limits ->> p_key)::bigint
    when p_key like '%.%' then
      (private.instance_setting('plugin.' || split_part(p_key, '.', 1) || '.limits')
        ->> split_part(p_key, '.', 2))::bigint
    else (private.instance_setting('limits') ->> p_key)::bigint
  end
  from (select 1) base
  left join public.org_limit_overrides o on o.org_id = p_org;
$$;

create function private.enforce_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_limit bigint;
  v_count bigint;
begin
  -- limits apply to everyone, platform admins and the service role included
  if tg_table_name = 'events' then
    if tg_op = 'UPDATE' and new.org_id = old.org_id then
      return new;
    end if;
    v_limit := private.org_limit(new.org_id, 'eventsPerOrg');
    if v_limit is not null then
      perform pg_advisory_xact_lock(hashtextextended('limit:events:' || new.org_id::text, 0));
      select count(*) into v_count from public.events where org_id = new.org_id;
      if v_count >= v_limit then
        raise exception 'this organization can have at most % events', v_limit using errcode = '23514';
      end if;
    end if;
  elsif tg_table_name = 'org_members' then
    if new.role = 'member' or (tg_op = 'UPDATE' and old.role <> 'member' and new.org_id = old.org_id) then
      return new;
    end if;
    v_limit := private.org_limit(new.org_id, 'adminsPerOrg');
    if v_limit is not null then
      perform pg_advisory_xact_lock(hashtextextended('limit:admins:' || new.org_id::text, 0));
      select count(*) into v_count from public.org_members
      where org_id = new.org_id and role <> 'member';
      if v_count >= v_limit then
        raise exception 'this organization can have at most % owners and admins', v_limit using errcode = '23514';
      end if;
    end if;
  elsif tg_table_name = 'org_domains' then
    if tg_op = 'UPDATE' and new.org_id = old.org_id then
      return new;
    end if;
    v_limit := private.org_limit(new.org_id, 'customDomainsPerOrg');
    if v_limit is not null then
      perform pg_advisory_xact_lock(hashtextextended('limit:domains:' || new.org_id::text, 0));
      select count(*) into v_count from public.org_domains where org_id = new.org_id;
      if v_count >= v_limit then
        raise exception 'this organization can have at most % hostnames', v_limit using errcode = '23514';
      end if;
    end if;
  elsif tg_table_name = 'invite_links' then
    if new.disabled_at is not null or new.closes_at <= now()
      or (tg_op = 'UPDATE' and old.disabled_at is null and (old.closes_at is null or old.closes_at > now())) then
      return new;
    end if;
    v_org := private.event_org(new.event_id);
    v_limit := private.org_limit(v_org, 'pendingInvitesPerOrg');
    if v_limit is not null then
      perform pg_advisory_xact_lock(hashtextextended('limit:invites:' || v_org::text, 0));
      select count(*) into v_count
      from public.invite_links l join public.events e on e.id = l.event_id
      where e.org_id = v_org and l.id <> new.id
        and l.disabled_at is null and (l.closes_at is null or l.closes_at > now());
      if v_count >= v_limit then
        raise exception 'this organization can have at most % open invite links', v_limit using errcode = '23514';
      end if;
    end if;
  elsif new.role = 'participant' then
    if tg_op = 'UPDATE' and old.role = 'participant' and new.event_id = old.event_id then
      return new;
    end if;
    v_limit := private.org_limit(private.event_org(new.event_id), 'participantsPerEvent');
    if v_limit is not null then
      perform pg_advisory_xact_lock(hashtextextended('limit:participants:' || new.event_id::text, 0));
      select count(*) into v_count from public.event_members
      where event_id = new.event_id and role = 'participant';
      if v_count >= v_limit then
        raise exception 'this event can have at most % participants', v_limit using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger events_enforce_limits before insert or update of org_id on public.events
  for each row execute function private.enforce_limits();
create trigger org_members_enforce_limits before insert or update of role, org_id on public.org_members
  for each row execute function private.enforce_limits();
create trigger event_members_enforce_limits before insert or update of role, event_id on public.event_members
  for each row execute function private.enforce_limits();
create trigger org_domains_enforce_limits before insert or update of org_id on public.org_domains
  for each row execute function private.enforce_limits();
create trigger invite_links_enforce_limits before insert or update of disabled_at, closes_at on public.invite_links
  for each row execute function private.enforce_limits();

create function public.org_limits(p_org uuid, p_plugin_limits text[] default '{}')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_keys text[] := array['eventsPerOrg', 'adminsPerOrg', 'participantsPerEvent', 'emailsPerDay',
    'storageMbPerOrg', 'maxUploadMb', 'customDomainsPerOrg', 'pendingInvitesPerOrg'];
  v_key text;
  v_used bigint;
  v_out jsonb := '{}';
  v_overrides jsonb;
begin
  if not (private.is_platform_admin() or private.is_org_admin(p_org)) then
    raise exception 'only an org admin can see its limits' using errcode = '42501';
  end if;
  select coalesce(limits, '{}') into v_overrides from public.org_limit_overrides where org_id = p_org;
  v_overrides := coalesce(v_overrides, '{}');
  if exists (select 1 from unnest(p_plugin_limits) k where k !~ '^[a-z][a-z0-9-]*\.[A-Za-z][A-Za-z0-9]*$') then
    raise exception 'not a plugin limit' using errcode = '22023';
  end if;
  foreach v_key in array v_keys || p_plugin_limits loop
    v_used := case v_key
      when 'eventsPerOrg' then (select count(*) from public.events where org_id = p_org)
      when 'adminsPerOrg' then (select count(*) from public.org_members where org_id = p_org and role <> 'member')
      when 'participantsPerEvent' then coalesce((select max(n) from (
        select count(*) as n from public.event_members m join public.events e on e.id = m.event_id
        where e.org_id = p_org and m.role = 'participant' group by m.event_id) c), 0)
      when 'emailsPerDay' then (select count(*) from public.email_sends where org_id = p_org and sent_at > now() - interval '1 day')
      when 'storageMbPerOrg' then (select coalesce(sum((o.metadata ->> 'size')::bigint), 0) / 1048576
        from storage.objects o
        where (o.bucket_id = 'branding' and (storage.foldername(o.name))[1] = p_org::text)
          or (o.bucket_id in ('submissions', 'registrations') and (storage.foldername(o.name))[1] in (
            select e.id::text from public.events e where e.org_id = p_org)))
      when 'maxUploadMb' then (select coalesce(max((o.metadata ->> 'size')::bigint), 0) / 1048576
        from storage.objects o
        where (o.bucket_id in ('branding') and (storage.foldername(o.name))[1] = p_org::text)
          or (o.bucket_id in ('event-assets', 'submissions', 'registrations', 'message-attachments')
            and (storage.foldername(o.name))[1] in (select e.id::text from public.events e where e.org_id = p_org)))
      when 'customDomainsPerOrg' then (select count(*) from public.org_domains where org_id = p_org)
      when 'pendingInvitesPerOrg' then (select count(*) from public.invite_links l join public.events e on e.id = l.event_id
        where e.org_id = p_org and l.disabled_at is null and (l.closes_at is null or l.closes_at > now()))
      else 0
    end;
    v_out := v_out || jsonb_build_object(v_key, jsonb_build_object(
      'limit', private.org_limit(p_org, v_key),
      'override', v_overrides ? v_key,
      'used', v_used));
  end loop;
  return v_out;
end;
$$;

create function public.set_org_limits(p_org uuid, p_limits jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed text[] := array['eventsPerOrg', 'adminsPerOrg', 'participantsPerEvent', 'emailsPerDay',
    'storageMbPerOrg', 'maxUploadMb', 'customDomainsPerOrg', 'pendingInvitesPerOrg'];
  v_key text;
  v_value jsonb;
begin
  if not private.is_platform_admin() then
    raise exception 'only platform admins can change an organization''s limits' using errcode = '42501';
  end if;
  if jsonb_typeof(p_limits) is distinct from 'object' then
    raise exception 'limits must be an object' using errcode = '22023';
  end if;
  for v_key, v_value in select * from jsonb_each(p_limits) loop
    if v_key <> all (v_allowed) and v_key !~ '^[a-z][a-z0-9-]*\.[A-Za-z][A-Za-z0-9]*$' then
      raise exception '% isn''t a limit', v_key using errcode = '22023';
    end if;
    if jsonb_typeof(v_value) not in ('number', 'null') or (jsonb_typeof(v_value) = 'number' and (v_value::text !~ '^[0-9]{1,12}$')) then
      raise exception '% needs a whole number, or null for no limit', v_key using errcode = '22023';
    end if;
  end loop;
  if p_limits = '{}' then
    delete from public.org_limit_overrides where org_id = p_org;
  else
    insert into public.org_limit_overrides (org_id, limits, updated_by)
    values (p_org, p_limits, (select auth.uid()))
    on conflict (org_id) do update set limits = excluded.limits, updated_by = excluded.updated_by, updated_at = now();
  end if;
  perform private.audit_org(p_org, 'org.limits_changed', 'org', p_org, jsonb_build_object('limits', p_limits));
end;
$$;

create function private.enforce_storage_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_limit bigint;
  v_cap bigint;
  v_used bigint;
  v_size bigint := coalesce((new.metadata ->> 'size')::bigint, 0);
begin
  v_org := case new.bucket_id
    when 'branding' then private.path_uuid(new.name, 1)
    else private.event_org(private.path_uuid(new.name, 1))
  end;
  if v_org is null then
    return new;
  end if;
  v_cap := private.org_limit(v_org, 'maxUploadMb');
  if v_cap is not null and v_size > v_cap * 1048576 then
    raise exception 'files can be at most % MB here', v_cap using errcode = '23514';
  end if;
  v_limit := private.org_limit(v_org, 'storageMbPerOrg');
  if v_limit is null or new.bucket_id not in ('branding', 'submissions', 'registrations') then
    return new;
  end if;
  select coalesce(sum((o.metadata ->> 'size')::bigint), 0) into v_used
  from storage.objects o
  where (o.bucket_id = 'branding' and (storage.foldername(o.name))[1] = v_org::text)
    or (o.bucket_id in ('submissions', 'registrations') and (storage.foldername(o.name))[1] in (
      select e.id::text from public.events e where e.org_id = v_org));
  if v_used + v_size > v_limit * 1048576 then
    raise exception 'this organization is out of storage (% MB)', v_limit using errcode = '23514';
  end if;
  return new;
end;
$$;

create function public.upload_limit_mb(p_event uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select private.org_limit(private.event_org(p_event), 'maxUploadMb')
  where private.can_view_event(p_event);
$$;
grant execute on function public.upload_limit_mb(uuid) to authenticated;

create table public.account_deletion_requests (
  user_id uuid primary key references public.profiles on delete cascade,
  reason text not null default '' check (length(reason) <= 1000),
  requested_at timestamptz not null default now()
);

create function private.account_deletion_requests_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (private.instance_setting('accounts') ->> 'deletionRequests')::boolean;
$$;
grant execute on function private.account_deletion_requests_enabled() to authenticated;

create function public.account_deletion_status()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'enabled', private.account_deletion_requests_enabled(),
    'requestedAt', (select requested_at from public.account_deletion_requests where user_id = (select auth.uid()))
  );
$$;

create function public.instance_deletion_requests()
returns table (user_id uuid, name text, email text, reason text, requested_at timestamptz, orgs text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'only platform admins can see deletion requests' using errcode = '42501';
  end if;
  return query
    select r.user_id, p.display_name, u.email::text, r.reason, r.requested_at,
      coalesce((select array_agg(o.name order by o.name) from public.org_members m
        join public.orgs o on o.id = m.org_id where m.user_id = r.user_id), '{}')
    from public.account_deletion_requests r
    join public.profiles p on p.id = r.user_id
    join auth.users u on u.id = r.user_id
    order by r.requested_at;
end;
$$;

create function public.delete_account(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org text;
begin
  if not private.is_platform_admin() then
    raise exception 'only platform admins can delete accounts' using errcode = '42501';
  end if;
  if p_user = (select auth.uid()) then
    raise exception 'you can''t delete your own account here' using errcode = 'P0001';
  end if;
  select o.name into v_org from public.org_members m join public.orgs o on o.id = m.org_id
  where m.user_id = p_user and m.role = 'owner'
    and not exists (
      select 1 from public.org_members other
      where other.org_id = m.org_id and other.role = 'owner' and other.user_id <> p_user
    )
  limit 1;
  if v_org is not null then
    raise exception 'they''re the only owner of %; make someone else an owner first', v_org
      using errcode = '23514';
  end if;
  delete from auth.users where id = p_user;
end;
$$;

alter table public.account_deletion_requests enable row level security;

create policy account_deletion_requests_select on public.account_deletion_requests for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_platform_admin()));
create policy account_deletion_requests_insert on public.account_deletion_requests for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.account_deletion_requests_enabled()));
create policy account_deletion_requests_delete on public.account_deletion_requests for delete to authenticated
  using (user_id = (select auth.uid()) or (select private.is_platform_admin()));

grant execute on function
  public.account_deletion_status(),
  public.admin_mfa_status(),
  public.instance_deletion_requests(),
  public.delete_account(uuid),
  public.instance_overview(),
  public.instance_orgs(),
  public.instance_people(text, integer),
  public.create_org(text, text, text, text),
  public.set_org_status(uuid, public.org_status, text),
  public.org_limits(uuid, text[]),
  public.set_org_limits(uuid, jsonb),
  public.instance_admins(),
  public.set_platform_admin(text, boolean)
to authenticated;
