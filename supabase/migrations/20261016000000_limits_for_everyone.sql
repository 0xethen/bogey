-- limits hold for everyone, platform admins and the service role included, and count role changes

create or replace function private.enforce_limits()
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

drop trigger if exists events_enforce_limits on public.events;
drop trigger if exists org_members_enforce_limits on public.org_members;
drop trigger if exists event_members_enforce_limits on public.event_members;
drop trigger if exists org_domains_enforce_limits on public.org_domains;
drop trigger if exists invite_links_enforce_limits on public.invite_links;
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

create or replace function private.enforce_storage_limit()
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
