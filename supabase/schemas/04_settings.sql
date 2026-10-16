create table public.settings (
  id uuid primary key default gen_random_uuid(),
  scope public.setting_scope not null,
  org_id uuid references public.orgs on delete cascade,
  event_id uuid references public.events on delete cascade,
  namespace text not null check (namespace ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$'),
  value jsonb not null default '{}' check (jsonb_typeof(value) = 'object'),
  locked_keys text[] not null default '{}',
  updated_by uuid references public.profiles on delete set null,
  updated_at timestamptz not null default now(),
  check (
    (scope = 'instance' and org_id is null and event_id is null)
    or (scope = 'org' and org_id is not null and event_id is null)
    or (scope = 'event' and org_id is null and event_id is not null)
  ),
  unique nulls not distinct (scope, org_id, event_id, namespace)
);
create index settings_org_id_idx on public.settings (org_id) where org_id is not null;
create index settings_event_id_idx on public.settings (event_id) where event_id is not null;

create trigger settings_touch before update on public.settings
  for each row execute function private.touch_updated_at();

create function private.guard_operator_keys()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_row public.settings := case when tg_op = 'DELETE' then old else new end;
  v_old jsonb := case when tg_op = 'INSERT' then '{}' else old.value end;
  v_new jsonb := case when tg_op = 'DELETE' then '{}' else new.value end;
  v_key text;
begin
  if v_row.scope = 'instance' and current_user in ('anon', 'authenticated') then
    foreach v_key in array private.operator_keys(v_row.namespace) loop
      if (v_old -> v_key) is distinct from (v_new -> v_key) then
        raise exception '%.% can no longer be changed in the app. Set it in bogey.config.ts or with the CLI',
          v_row.namespace, v_key using errcode = '42501';
      end if;
    end loop;
  end if;
  return v_row;
end;
$$;

create trigger settings_operator_keys before insert or update or delete on public.settings
  for each row execute function private.guard_operator_keys();

create function private.is_public_namespace(p_namespace text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_namespace in ('branding', 'registration', 'seo', 'privacy', 'plugin.i18n');
$$;

create function private.is_admin_only_namespace(p_namespace text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_namespace in ('network', 'tenancy', 'limits') or p_namespace like 'plugin.%.limits';
$$;

create function private.merge_setting(p_lower jsonb, p_lower_locked text[], p_upper jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_lower, '{}') || coalesce((
    select jsonb_object_agg(k, v)
    from jsonb_each(coalesce(p_upper, '{}')) as e(k, v)
    where not (k = any (coalesce(p_lower_locked, '{}')))
  ), '{}');
$$;

create function private.instance_setting(p_namespace text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.merge_setting(private.setting_defaults(p_namespace), '{}', (
    select value from public.settings where scope = 'instance' and namespace = p_namespace
  ));
$$;

create function private.admin_mfa_required()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((private.instance_setting('accounts') ->> 'requireAdminMfa')::boolean, true);
$$;

create function private.org_setting(p_org uuid, p_namespace text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.merge_setting(private.instance_setting(p_namespace), i.locked_keys, o.value)
  from (select 1) as one
  left join public.settings i on i.scope = 'instance' and i.namespace = p_namespace
  left join public.settings o on o.scope = 'org' and o.org_id = p_org and o.namespace = p_namespace;
$$;

create function private.event_setting(p_event uuid, p_namespace text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.merge_setting(
    private.org_setting(e.org_id, p_namespace),
    coalesce(i.locked_keys, '{}') || coalesce(o.locked_keys, '{}'),
    ev.value
  )
  from public.events e
  left join public.settings i on i.scope = 'instance' and i.namespace = p_namespace
  left join public.settings o on o.scope = 'org' and o.org_id = e.org_id and o.namespace = p_namespace
  left join public.settings ev on ev.scope = 'event' and ev.event_id = e.id and ev.namespace = p_namespace
  where e.id = p_event;
$$;

create function private.plugin_enabled(p_event uuid, p_plugin text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select ev.value -> 'enabled' ? p_plugin
     from public.settings ev
     where ev.scope = 'event' and ev.event_id = p_event and ev.namespace = 'plugins'),
    false
  ) and coalesce(
    (select not (o.value ? 'available') or o.value -> 'available' ? p_plugin
     from public.events e
     join public.settings o on o.scope = 'org' and o.org_id = e.org_id and o.namespace = 'plugins'
     where e.id = p_event),
    true
  );
$$;

grant execute on function
  private.is_public_namespace(text),
  private.is_admin_only_namespace(text),
  private.merge_setting(jsonb, text[], jsonb),
  private.instance_setting(text),
  private.org_setting(uuid, text),
  private.event_setting(uuid, text),
  private.plugin_enabled(uuid, text)
to anon, authenticated, service_role, supabase_auth_admin;

create function public.settings_for(p_namespaces text[], p_org uuid default null, p_event uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := coalesce(p_org, private.event_org(p_event));
  v_member boolean;
  v_out jsonb := '{}';
  v_ns text;
begin
  if p_event is not null and not private.can_view_event(p_event) then
    return v_out;
  end if;
  v_member := case
    when p_event is not null then private.has_permission(p_event, 'event.view')
    else private.is_org_member(v_org)
  end;

  foreach v_ns in array p_namespaces loop
    if private.is_public_namespace(v_ns) or v_member then
      v_out := v_out || jsonb_build_object(v_ns, case
        when p_event is not null then private.event_setting(p_event, v_ns)
        when v_org is not null then private.org_setting(v_org, v_ns)
        else private.instance_setting(v_ns)
      end);
    end if;
  end loop;
  return v_out;
end;
$$;
grant execute on function public.settings_for(text[], uuid, uuid) to anon, authenticated;

create table public.secrets (
  id uuid primary key default gen_random_uuid(),
  scope public.setting_scope not null,
  org_id uuid references public.orgs on delete cascade,
  event_id uuid references public.events on delete cascade,
  name text not null check (name ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$'),
  vault_secret_id uuid not null,
  updated_by uuid references public.profiles on delete set null,
  updated_at timestamptz not null default now(),
  check (
    (scope = 'instance' and org_id is null and event_id is null)
    or (scope = 'org' and org_id is not null and event_id is null)
    or (scope = 'event' and org_id is null and event_id is not null)
  ),
  unique nulls not distinct (scope, org_id, event_id, name)
);

create function private.can_write_scope(p_scope public.setting_scope, p_org uuid, p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_scope
    when 'instance' then private.is_platform_admin()
    when 'org' then private.is_org_admin(p_org)
    when 'event' then private.can_manage(p_event)
  end;
$$;

create function public.set_secret(
  p_scope public.setting_scope, p_org uuid, p_event uuid, p_name text, p_value text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing uuid;
  v_vault_name text := concat_ws(':', 'bogey', p_scope, p_org, p_event, p_name);
begin
  if not coalesce(private.can_write_scope(p_scope, p_org, p_event), false) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select vault_secret_id into v_existing from public.secrets
  where scope = p_scope and org_id is not distinct from p_org
    and event_id is not distinct from p_event and name = p_name;

  if p_value is null or p_value = '' then
    delete from public.secrets where vault_secret_id = v_existing;
    delete from vault.secrets where id = v_existing;
    return;
  end if;

  if v_existing is null then
    insert into public.secrets (scope, org_id, event_id, name, vault_secret_id, updated_by)
    values (p_scope, p_org, p_event, p_name, vault.create_secret(p_value, v_vault_name), (select auth.uid()));
  else
    perform vault.update_secret(v_existing, p_value);
    update public.secrets set updated_by = (select auth.uid()), updated_at = now()
    where vault_secret_id = v_existing;
  end if;
end;
$$;
grant execute on function public.set_secret(public.setting_scope, uuid, uuid, text, text) to authenticated;

create function private.secret(p_event uuid, p_name text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select ds.decrypted_secret
  from public.secrets s
  join vault.decrypted_secrets ds on ds.id = s.vault_secret_id
  left join public.events e on e.id = p_event
  where s.name = p_name
    and (
      (s.scope = 'event' and s.event_id = p_event)
      or (s.scope = 'org' and s.org_id = e.org_id)
      or s.scope = 'instance'
    )
  order by case s.scope when 'event' then 0 when 'org' then 1 else 2 end
  limit 1;
$$;
revoke execute on function private.secret(uuid, text) from anon, authenticated;

create function public.inherited_settings(
  p_scope public.setting_scope, p_namespace text, p_org uuid default null, p_event uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := case when p_scope = 'event' then private.event_org(p_event) else p_org end;
  v_instance public.settings;
  v_org_row public.settings;
begin
  if not coalesce(private.can_write_scope(p_scope, p_org, p_event), false) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_instance from public.settings where scope = 'instance' and namespace = p_namespace;
  if p_scope = 'event' then
    select * into v_org_row from public.settings
    where scope = 'org' and org_id = v_org and namespace = p_namespace;
  end if;
  return jsonb_build_object(
    'defaults', private.setting_defaults(p_namespace),
    'instance', case when p_scope <> 'instance' then coalesce(v_instance.value, '{}') else '{}' end,
    'org', coalesce(v_org_row.value, '{}'),
    'instanceLocked', to_jsonb(case when p_scope <> 'instance' then coalesce(v_instance.locked_keys, '{}') else '{}' end),
    'orgLocked', to_jsonb(coalesce(v_org_row.locked_keys, '{}'))
  );
end;
$$;
grant execute on function public.inherited_settings(public.setting_scope, text, uuid, uuid) to authenticated;

create function private.request_ip()
returns inet
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_headers jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
  v_network jsonb := private.instance_setting('network');
  v_hops integer := greatest(coalesce((v_network ->> 'trustedHops')::integer, 1), 1);
  v_parts text[];
  v_ip inet;
begin
  if v_headers is null then
    return null;
  end if;
  if v_network ->> 'clientIpHeader' = 'x-forwarded-for' then
    v_parts := string_to_array(replace(v_headers ->> 'x-forwarded-for', ' ', ''), ',');
    v_ip := v_parts[cardinality(v_parts) - v_hops + 1]::inet;
  else
    v_ip := (v_headers ->> (v_network ->> 'clientIpHeader'))::inet;
  end if;
  if v_headers ? 'x-bogey-client-ip' and exists (
    select 1 from jsonb_array_elements_text(coalesce(v_network -> 'trustedProxies', '[]')) as p(cidr)
    where v_ip <<= p.cidr::cidr
  ) then
    v_ip := (v_headers ->> 'x-bogey-client-ip')::inet;
  end if;
  return v_ip;
exception
  when others then
    return null;
end;
$$;

create function private.network_limit_covers(p_event uuid, p_access jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_users jsonb := coalesce(p_access -> 'onlyUsers', '[]');
  v_teams jsonb := coalesce(p_access -> 'onlyTeams', '[]');
  v_divisions jsonb := coalesce(p_access -> 'onlyDivisions', '[]');
begin
  if jsonb_array_length(v_users) + jsonb_array_length(v_teams) + jsonb_array_length(v_divisions) = 0 then
    return true;
  end if;
  return v_users ? v_uid::text
    or exists (
      select 1 from public.team_members t
      where t.event_id = p_event and t.user_id = v_uid and v_teams ? t.team_id::text
    )
    or exists (
      select 1 from public.event_members m
      where m.event_id = p_event and m.user_id = v_uid and v_divisions ? m.division_id::text
    );
end;
$$;

create function private.network_allowed(p_event uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_access jsonb := private.event_setting(p_event, 'access');
  v_networks jsonb := v_access -> 'allowedNetworks';
  v_role public.event_role;
  v_ip inet;
begin
  if v_networks is null or jsonb_array_length(v_networks) = 0
     or (select auth.role()) = 'service_role'
     or private.can_manage(p_event) then
    return true;
  end if;
  v_role := private.event_role(p_event);
  if v_role is not null and v_role <> 'participant' then
    return true;
  end if;
  if v_role is not null and not private.network_limit_covers(p_event, v_access) then
    return true;
  end if;
  v_ip := private.request_ip();
  return v_ip is not null and exists (
    select 1 from jsonb_array_elements_text(v_networks) as n(cidr) where v_ip <<= n.cidr::cidr
  );
end;
$$;

create function private.require_network(p_event uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.network_allowed(p_event) then
    raise exception 'connect to the event''s network to take part' using errcode = 'P0001';
  end if;
end;
$$;

create function public.event_network_status(p_event uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_access jsonb := private.event_setting(p_event, 'access');
  v_networks jsonb := v_access -> 'allowedNetworks';
begin
  if not private.can_view_event(p_event) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'restricted', coalesce(jsonb_array_length(v_networks), 0) > 0
      and (private.event_role(p_event) is null or private.network_limit_covers(p_event, v_access)),
    'allowed', private.network_allowed(p_event),
    'ip', host(private.request_ip())
  );
end;
$$;

grant execute on function private.request_ip(), private.network_limit_covers(uuid, jsonb),
  private.network_allowed(uuid), private.require_network(uuid)
to anon, authenticated, service_role;
grant execute on function public.event_network_status(uuid) to authenticated;

create index secrets_event_id_fk_idx on public.secrets (event_id);
create index secrets_org_id_fk_idx on public.secrets (org_id);
create index secrets_updated_by_fk_idx on public.secrets (updated_by);
create index settings_updated_by_fk_idx on public.settings (updated_by);

alter table public.settings enable row level security;
alter table public.secrets enable row level security;

create policy settings_select on public.settings for select to anon, authenticated
  using (
    case scope
      when 'instance' then not private.is_admin_only_namespace(namespace)
        or (select private.is_platform_admin())
      when 'org' then private.is_public_namespace(namespace) or (select private.is_org_member(org_id))
      when 'event' then (select private.can_view_event(event_id))
        and (private.is_public_namespace(namespace)
          or (select private.has_permission(event_id, 'event.view')))
    end
  );
create policy settings_insert on public.settings for insert to authenticated
  with check ((select private.can_write_scope(scope, org_id, event_id)));
create policy settings_update on public.settings for update to authenticated
  using ((select private.can_write_scope(scope, org_id, event_id)))
  with check ((select private.can_write_scope(scope, org_id, event_id)));
create policy settings_delete on public.settings for delete to authenticated
  using ((select private.can_write_scope(scope, org_id, event_id)));

create policy secrets_select on public.secrets for select to authenticated
  using ((select private.can_write_scope(scope, org_id, event_id)));

grant execute on function private.can_write_scope(public.setting_scope, uuid, uuid) to authenticated;
