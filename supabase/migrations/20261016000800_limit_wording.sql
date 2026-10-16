-- limit errors say event(s), owner(s) and admin(s) and so on

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
        raise exception 'this organization can have at most % event(s)', v_limit using errcode = '23514';
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
        raise exception 'this organization can have at most % owner(s) and admin(s)', v_limit using errcode = '23514';
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
        raise exception 'this organization can have at most % hostname(s)', v_limit using errcode = '23514';
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
        raise exception 'this organization can have at most % open invite link(s)', v_limit using errcode = '23514';
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
        raise exception 'this event can have at most % participant(s)', v_limit using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;
