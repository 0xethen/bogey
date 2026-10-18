create table public.audit_log (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs on delete cascade,
  event_id uuid references public.events on delete cascade,
  actor_id uuid references public.profiles on delete set null,
  action text not null check (action ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9_-]*)+$'),
  target_type text,
  target_id uuid,
  meta jsonb not null default '{}' check (octet_length(meta::text) <= 4096),
  created_at timestamptz not null default now()
);
create index audit_log_org_idx on public.audit_log (org_id, created_at desc);
create index audit_log_event_idx on public.audit_log (event_id, created_at desc) where event_id is not null;
create index audit_log_actor_idx on public.audit_log (actor_id) where actor_id is not null;

create function private.audit(p_event uuid, p_action text, p_target_type text, p_target_id uuid, p_meta jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (org_id, event_id, actor_id, action, target_type, target_id, meta)
  select e.org_id, e.id, (select auth.uid()), p_action, p_target_type, p_target_id, coalesce(p_meta, '{}')
  from public.events e where e.id = p_event;
$$;

create function private.audit_org(p_org uuid, p_action text, p_target_type text, p_target_id uuid, p_meta jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (org_id, actor_id, action, target_type, target_id, meta)
  select o.id, (select auth.uid()), p_action, p_target_type, p_target_id, coalesce(p_meta, '{}')
  from public.orgs o where o.id = p_org;
$$;

create function public.log_event(p_event uuid, p_action text, p_meta jsonb default '{}')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text := split_part(p_action, '.', 1);
begin
  if not private.has_permission(p_event, 'event.view') then
    raise exception 'not a member of this event' using errcode = '42501';
  end if;
  if v_prefix <> 'ac' and not private.plugin_enabled(p_event, v_prefix) then
    raise exception 'unknown action "%"', p_action using errcode = '22023';
  end if;
  perform private.audit(p_event, p_action, null, null, p_meta);
end;
$$;
grant execute on function public.log_event(uuid, text, jsonb) to authenticated;

create function public.log_export(p_event uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (private.can_manage(p_event)
    or (p_kind = 'submissions' and private.project_export_access(p_event) <> 'off')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_kind !~ '^[a-z][a-z-]{0,39}$' then
    raise exception 'unknown export "%"', p_kind using errcode = '22023';
  end if;
  perform private.audit(p_event, 'export.downloaded', null, null, jsonb_build_object('kind', p_kind));
end;
$$;
grant execute on function public.log_export(uuid, text) to authenticated;

create function public.record_blocked_access(p_event uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_event, 'event.view') or private.network_allowed(p_event) then
    return false;
  end if;
  if not exists (
    select 1 from public.audit_log
    where event_id = p_event and actor_id = (select auth.uid()) and action = 'access.denied'
      and created_at > now() - interval '10 minutes'
  ) then
    perform private.audit(p_event, 'access.denied', null, null,
      jsonb_build_object('ip', host(private.request_ip())));
  end if;
  return true;
end;
$$;
grant execute on function public.record_blocked_access(uuid) to authenticated;

create function public.event_blocked_access(p_event uuid)
returns table (at timestamptz, name text, ip text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_manage(p_event) then
    raise exception 'only organizers can see blocked attempts' using errcode = '42501';
  end if;
  return query
    select a.created_at, p.display_name, a.meta ->> 'ip'
    from public.audit_log a
    left join public.profiles p on p.id = a.actor_id
    where a.event_id = p_event and a.action = 'access.denied'
    order by a.created_at desc
    limit 20;
end;
$$;
grant execute on function public.event_blocked_access(uuid) to authenticated;

create function private.prune_audit_log()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.audit_log a
  using public.orgs o
  where o.id = a.org_id
    and a.created_at < now() - make_interval(
      days => (private.org_setting(o.id, 'audit') ->> 'retentionDays')::integer
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create function private.audit_event_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fields jsonb;
  v_changes jsonb;
begin
  if (select auth.uid()) is null then
    return null;
  end if;
  select jsonb_agg(n.key order by n.key),
    coalesce(jsonb_object_agg(n.key, jsonb_build_object('from', o.value, 'to', n.value)) filter (
      where n.key in ('name', 'short_name', 'slug', 'kind', 'timezone', 'starts_at', 'ends_at',
        'visibility', 'team_size_min', 'team_size_max')
    ), '{}')
  into v_fields, v_changes
  from jsonb_each(to_jsonb(new)) n
  join jsonb_each(to_jsonb(old)) o on o.key = n.key
  where n.value is distinct from o.value and n.key <> 'updated_at';
  if v_fields is not null then
    perform private.audit(new.id, 'event.updated', 'event', new.id,
      jsonb_build_object('fields', v_fields, 'changes', v_changes));
  end if;
  return null;
end;
$$;

create trigger events_audit after update on public.events
  for each row execute function private.audit_event_update();

create function private.audit_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op = 'INSERT' then '{}' else old.value end;
  v_new jsonb := case when tg_op = 'DELETE' then '{}' else new.value end;
  v_scope public.setting_scope := case when tg_op = 'DELETE' then old.scope else new.scope end;
  v_meta jsonb;
begin
  if (select auth.uid()) is null or v_scope = 'instance' then
    return null;
  end if;
  select jsonb_build_object(
    'namespace', case when tg_op = 'DELETE' then old.namespace else new.namespace end,
    'keys', coalesce(jsonb_agg(k order by k), '[]'),
    'locks', case when tg_op = 'UPDATE' and old.locked_keys is distinct from new.locked_keys
      then to_jsonb(new.locked_keys) end
  )
  into v_meta
  from (select jsonb_object_keys(v_old) union select jsonb_object_keys(v_new)) keys(k)
  where v_old -> k is distinct from v_new -> k;
  v_meta := jsonb_strip_nulls(v_meta);
  if v_meta -> 'keys' = '[]' and not v_meta ? 'locks' then
    return null;
  end if;
  if v_scope = 'event' then
    perform private.audit(coalesce(new.event_id, old.event_id), 'settings.changed', 'settings', null, v_meta);
  else
    perform private.audit_org(coalesce(new.org_id, old.org_id), 'settings.changed', 'settings', null, v_meta);
  end if;
  return null;
end;
$$;

create trigger settings_audit after insert or update or delete on public.settings
  for each row execute function private.audit_settings();

create function private.audit_event_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return null;
  end if;
  if tg_op = 'DELETE' or (old.status = 'active' and new.status = 'removed') then
    perform private.audit(old.event_id, 'member.removed', 'user', old.user_id,
      jsonb_build_object('role', old.role));
  elsif old.status = 'removed' and new.status = 'active' then
    perform private.audit(new.event_id, 'member.restored', 'user', new.user_id,
      jsonb_build_object('role', new.role));
  elsif old.role is distinct from new.role then
    perform private.audit(new.event_id, 'member.role_changed', 'user', new.user_id,
      jsonb_build_object('from', old.role, 'to', new.role));
  end if;
  return null;
end;
$$;

create trigger event_members_audit after update of role, status or delete on public.event_members
  for each row execute function private.audit_event_member();

create function private.audit_role_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return null;
  end if;
  if tg_op = 'INSERT' then
    perform private.audit(new.event_id, 'member.role_granted', 'user', new.user_id,
      jsonb_build_object('role', new.role_key));
  else
    perform private.audit(old.event_id, 'member.role_revoked', 'user', old.user_id,
      jsonb_build_object('role', old.role_key));
  end if;
  return null;
end;
$$;

create trigger event_role_grants_audit after insert or delete on public.event_role_grants
  for each row execute function private.audit_role_grant();

create function private.audit_team()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return null;
  end if;
  if tg_op = 'DELETE' then
    perform private.audit(old.event_id, 'team.deleted', 'team', old.id,
      jsonb_build_object('name', old.name));
    return null;
  end if;
  if old.name is distinct from new.name then
    perform private.audit(new.event_id, 'team.renamed', 'team', new.id,
      jsonb_build_object('from', old.name, 'to', new.name));
  end if;
  if old.locked_at is null and new.locked_at is not null then
    perform private.audit(new.event_id, 'team.locked', 'team', new.id,
      jsonb_build_object('name', new.name));
  elsif old.locked_at is not null and new.locked_at is null then
    perform private.audit(new.event_id, 'team.unlocked', 'team', new.id,
      jsonb_build_object('name', new.name));
  end if;
  return null;
end;
$$;

create trigger teams_audit after update of name, locked_at or delete on public.teams
  for each row execute function private.audit_team();

create function private.audit_submission_form_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    perform private.audit(old.event_id, 'form.deleted', 'submission_form', old.id,
      jsonb_build_object('title', old.title));
  end if;
  return null;
end;
$$;

create trigger submission_forms_audit after delete on public.submission_forms
  for each row execute function private.audit_submission_form_delete();

create function private.audit_org_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return null;
  end if;
  if tg_op = 'INSERT' then
    perform private.audit_org(new.org_id, 'org.member_added', 'user', new.user_id,
      jsonb_build_object('role', new.role));
  elsif tg_op = 'DELETE' then
    perform private.audit_org(old.org_id, 'org.member_removed', 'user', old.user_id,
      jsonb_build_object('role', old.role));
  elsif old.role is distinct from new.role then
    perform private.audit_org(new.org_id, 'org.role_changed', 'user', new.user_id,
      jsonb_build_object('from', old.role, 'to', new.role));
  end if;
  return null;
end;
$$;

create trigger org_members_audit after insert or update of role or delete on public.org_members
  for each row execute function private.audit_org_member();

alter table public.audit_log enable row level security;

create policy audit_log_select on public.audit_log for select to authenticated
  using ((select private.is_org_admin(org_id)));
