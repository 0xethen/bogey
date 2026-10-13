create function private.enforce_org_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := case tg_op when 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_org uuid;
  v_status public.org_status;
  v_reason text;
begin
  if (select auth.role()) = 'service_role' or private.is_platform_admin() then
    return case tg_op when 'DELETE' then old else new end;
  end if;
  v_org := coalesce((v_row ->> 'org_id')::uuid, private.event_org((v_row ->> 'event_id')::uuid));
  select status, status_reason into v_status, v_reason from public.orgs where id = v_org;
  if v_status is not null and v_status <> 'active' then
    raise exception 'this organization is % and can''t be changed%', v_status,
      coalesce(': ' || v_reason, '') using errcode = '42501';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end;
$$;

create function private.suspended_orgs()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(id), '{}') from public.orgs where status = 'suspended';
$$;
create function private.suspended_events()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(e.id), '{}')
  from public.events e join public.orgs o on o.id = e.org_id
  where o.status = 'suspended';
$$;
grant execute on function private.suspended_orgs(), private.suspended_events() to anon, authenticated;

create function private.hide_suspended_org(p_table regclass)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_org boolean := exists (
    select 1 from pg_attribute where attrelid = p_table and attname = 'org_id' and not attisdropped);
  v_event boolean := exists (
    select 1 from pg_attribute where attrelid = p_table and attname = 'event_id' and not attisdropped);
  v_using text;
begin
  if not v_org and not v_event then
    return;
  end if;
  v_using := concat_ws(' and ',
    case when v_org then 'not coalesce(org_id = any ((select private.suspended_orgs())::uuid[]), false)' end,
    case when v_event then 'not coalesce(event_id = any ((select private.suspended_events())::uuid[]), false)' end);
  execute format('drop policy if exists suspended_org_hidden on %s', p_table);
  execute format(
    'create policy suspended_org_hidden on %s as restrictive for select to anon, authenticated '
    'using ((select private.is_platform_admin()) or (%s))', p_table, v_using);
end;
$$;

create function private.guard_org_status(p_table regclass)
returns void
language plpgsql
set search_path = ''
as $$
begin
  execute format('drop trigger if exists org_status_guard on %s', p_table);
  execute format(
    'create trigger org_status_guard before insert or update or delete on %s '
    'for each row execute function private.enforce_org_status()', p_table);
  perform private.hide_suspended_org(p_table);
end;
$$;

do $$
declare
  v_table text;
begin
  for v_table in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name in ('org_id', 'event_id')
    group by c.table_name
  loop
    if v_table in ('audit_log', 'org_limit_overrides', 'email_sends', 'page_reports') then
      perform private.hide_suspended_org(format('public.%I', v_table)::regclass);
    else
      perform private.guard_org_status(format('public.%I', v_table)::regclass);
    end if;
  end loop;
end;
$$;

create trigger storage_objects_enforce_limits before insert on storage.objects
  for each row execute function private.enforce_storage_limit();

create table public.email_sends (
  id bigint generated always as identity primary key,
  org_id uuid references public.orgs on delete cascade,
  kind text not null check (length(kind) <= 40),
  sent_at timestamptz not null default now()
);
create index email_sends_org_sent_idx on public.email_sends (org_id, sent_at desc);
create index email_sends_sent_idx on public.email_sends (sent_at desc);
alter table public.email_sends enable row level security;

create function public.record_email_send(p_kind text, p_org uuid default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.org_status;
  v_limit bigint;
  v_used bigint;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'only the send-email hook records sends' using errcode = '42501';
  end if;
  if p_org is not null then
    select status into v_status from public.orgs where id = p_org;
    if v_status = 'suspended' then
      return 'suspended';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('email:' || p_org::text, 0));
    v_limit := private.org_limit(p_org, 'emailsPerDay');
    if v_limit is not null then
      select count(*) into v_used from public.email_sends
      where org_id = p_org and sent_at > now() - interval '1 day';
      if v_used >= v_limit then
        return 'limit';
      end if;
    end if;
  end if;
  insert into public.email_sends (org_id, kind) values (p_org, p_kind);
  return 'ok';
end;
$$;
grant execute on function public.record_email_send(text, uuid) to service_role;

create function public.email_hook_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'only platform admins can see the email hook' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'lastAt', (select max(sent_at) from public.email_sends),
    'last24h', (select count(*) from public.email_sends where sent_at > now() - interval '1 day'));
end;
$$;

select cron.schedule('bogey-prune-email-sends', '23 4 * * *',
  $job$delete from public.email_sends where sent_at < now() - interval '30 days'$job$);

create table public.page_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  path text not null check (length(path) between 1 and 300),
  reason text not null check (length(reason) between 1 and 1000),
  reporter uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid references public.profiles on delete set null
);
create index page_reports_org_id_idx on public.page_reports (org_id);
create index page_reports_open_idx on public.page_reports (created_at desc) where handled_at is null;
create index page_reports_reporter_fk_idx on public.page_reports (reporter);
create index page_reports_handled_by_fk_idx on public.page_reports (handled_by);
alter table public.page_reports enable row level security;

create function public.report_page(p_org uuid, p_path text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.orgs where id = p_org) then
    raise exception 'no such organization' using errcode = 'P0002';
  end if;
  if (select count(*) from public.page_reports where created_at > now() - interval '1 hour') >= 100 then
    raise exception 'too many reports right now; try again later' using errcode = '53400';
  end if;
  insert into public.page_reports (org_id, path, reason, reporter)
  values (p_org, left(trim(p_path), 300), left(trim(p_reason), 1000), (select auth.uid()));
end;
$$;

create function public.instance_reports(p_open_only boolean default true)
returns table (
  id uuid, org_id uuid, org_name text, path text, reason text, reporter_name text,
  created_at timestamptz, handled_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'only platform admins can read reports' using errcode = '42501';
  end if;
  return query
    select r.id, r.org_id, o.name, r.path, r.reason, p.display_name, r.created_at, r.handled_at
    from public.page_reports r
    join public.orgs o on o.id = r.org_id
    left join public.profiles p on p.id = r.reporter
    where not p_open_only or r.handled_at is null
    order by r.created_at desc
    limit 200;
end;
$$;

create function public.set_report_handled(p_id uuid, p_handled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'only platform admins can close reports' using errcode = '42501';
  end if;
  update public.page_reports
  set handled_at = case when p_handled then now() end,
    handled_by = case when p_handled then (select auth.uid()) end
  where id = p_id;
end;
$$;

grant execute on function public.report_page(uuid, text, text) to anon, authenticated;
grant execute on function
  public.email_hook_status(),
  public.instance_reports(boolean),
  public.set_report_handled(uuid, boolean)
to authenticated;
