create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  org_id uuid not null references public.orgs on delete cascade,
  event_id uuid references public.events on delete cascade,
  kind text not null check (kind ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9_-]*)*$' and length(kind) <= 80),
  title text not null check (length(title) between 1 and 200),
  body_md text not null default '' check (length(body_md) <= 2000),
  link text check (link ~ '^/([^/\\].*)?$' and length(link) <= 300),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;
create index notifications_org_id_fk_idx on public.notifications (org_id);
create index notifications_event_id_fk_idx on public.notifications (event_id);

alter table public.notifications enable row level security;
create policy notifications_select_own on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy notifications_delete_own on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));

create function private.guard_notification_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.id, new.user_id, new.org_id, new.event_id, new.kind, new.title, new.body_md, new.link, new.created_at)
    is distinct from
    (old.id, old.user_id, old.org_id, old.event_id, old.kind, old.title, old.body_md, old.link, old.created_at)
  then
    raise exception 'only read_at can change' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger notifications_guard_update before update on public.notifications
  for each row execute function private.guard_notification_update();

alter publication supabase_realtime add table public.notifications;

create table public.email_outbox (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs on delete cascade,
  event_id uuid references public.events on delete cascade,
  user_id uuid references public.profiles on delete set null,
  to_email text not null check (length(to_email) between 3 and 320),
  kind text not null check (length(kind) between 1 and 80),
  locale text check (locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]+)*$'),
  vars jsonb not null default '{}' check (jsonb_typeof(vars) = 'object' and octet_length(vars::text) <= 16384),
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  attempts smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text check (length(last_error) <= 500),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index email_outbox_due_idx on public.email_outbox (next_attempt_at) where status in ('queued', 'sending');
create index email_outbox_org_created_idx on public.email_outbox (org_id, created_at desc);
create index email_outbox_event_id_fk_idx on public.email_outbox (event_id);
create index email_outbox_user_id_fk_idx on public.email_outbox (user_id);
alter table public.email_outbox enable row level security;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'bogey:email-drain') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'bogey:email-drain');
  end if;
end;
$$;

create function private.email_drain_secret()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'bogey:email-drain';
$$;
revoke execute on function private.email_drain_secret() from anon, authenticated;

create function public.email_drain_secret()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'only the app reads the drain secret' using errcode = '42501';
  end if;
  return private.email_drain_secret();
end;
$$;
revoke execute on function public.email_drain_secret() from authenticated;
grant execute on function public.email_drain_secret() to service_role;

create function private.enqueue_email(
  p_org uuid, p_event uuid, p_user uuid, p_to text, p_kind text, p_vars jsonb default '{}'
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_to text := p_to;
  v_id bigint;
begin
  if v_to is null and p_user is not null then
    select email into v_to from auth.users where id = p_user;
  end if;
  if v_to is null then
    return null;
  end if;
  insert into public.email_outbox (org_id, event_id, user_id, to_email, kind, locale, vars)
  values (p_org, p_event, p_user, v_to, p_kind,
    (select p.locale from public.profiles p where p.id = p_user
       and p.locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]+)*$'),
    coalesce(p_vars, '{}'))
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function private.enqueue_email(uuid, uuid, uuid, text, text, jsonb) from anon, authenticated;

create function private.notification_pref(p_user uuid, p_kind text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select up.value -> p_kind from public.user_preferences up
    where up.user_id = p_user and up.namespace = 'notifications' and up.key = 'channels'
  ), '{}');
$$;
revoke execute on function private.notification_pref(uuid, text) from anon, authenticated;

create function private.notify(
  p_users uuid[], p_event uuid, p_kind text, p_title text, p_body text, p_link text,
  p_meta jsonb default '{}', p_email boolean default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_event_name text;
  v_def jsonb := private.notification_kind(p_kind);
  v_user uuid;
  v_pref jsonb;
  v_in_app boolean;
  v_email boolean;
  v_count integer := 0;
begin
  select org_id, name into v_org, v_event_name from public.events where id = p_event;
  if v_org is null then
    raise exception 'unknown event' using errcode = '22023';
  end if;
  for v_user in select distinct u from unnest(p_users) as u where u is not null loop
    v_pref := private.notification_pref(v_user, p_kind);
    v_in_app := coalesce((v_pref ->> 'inApp')::boolean, (v_def ->> 'inApp')::boolean, true);
    v_email := case
      when p_email is false then false
      when coalesce((v_def ->> 'transactional')::boolean, false) then true
      when v_pref ? 'email' then (v_pref ->> 'email')::boolean
      else coalesce(p_email, (v_def ->> 'email')::boolean, false)
    end;
    if v_in_app then
      insert into public.notifications (user_id, org_id, event_id, kind, title, body_md, link)
      values (v_user, v_org, p_event, p_kind, p_title, coalesce(p_body, ''), p_link);
      v_count := v_count + 1;
    end if;
    if v_email then
      perform private.enqueue_email(v_org, p_event, v_user, null,
        coalesce(v_def ->> 'emailKind', 'notification'),
        coalesce(p_meta, '{}') || jsonb_strip_nulls(jsonb_build_object(
          'kind', p_kind, 'title', p_title, 'body', p_body, 'path', p_link, 'event', v_event_name)));
    end if;
  end loop;
  return v_count;
end;
$$;
revoke execute on function private.notify(uuid[], uuid, text, text, text, text, jsonb, boolean)
from anon, authenticated;

create function public.notify_event(
  p_event uuid, p_key text, p_kind text, p_users uuid[], p_title text, p_body text,
  p_link text, p_permission text, p_email boolean default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text := p_key || '.' || p_kind;
  v_recipients uuid[];
  v_count integer;
begin
  if p_key !~ '^[a-z][a-z0-9-]{1,30}[a-z0-9]$' or p_kind !~ '^[a-z][a-z0-9_-]{0,40}$' then
    raise exception 'bad notification kind' using errcode = '22023';
  end if;
  if not private.plugin_enabled(p_event, p_key) then
    raise exception 'that plugin is not on for this event' using errcode = '42501';
  end if;
  if p_permission is distinct from 'event.manage' and p_permission not like p_key || '.%' then
    raise exception 'name one of the plugin''s own permissions' using errcode = '22023';
  end if;
  if not private.has_permission(p_event, p_permission) then
    raise exception 'not allowed to notify' using errcode = '42501';
  end if;
  if cardinality(p_users) > 200 then
    raise exception 'too many recipients' using errcode = '22023';
  end if;
  if (select count(*) from public.notifications
      where event_id = p_event and kind like p_key || '.%' and created_at > now() - interval '1 hour') > 2000 then
    raise exception 'too many notifications from this plugin; try again later' using errcode = '54000';
  end if;
  select array_agg(m.user_id) into v_recipients
  from public.event_members m
  where m.event_id = p_event and m.status = 'active' and m.user_id = any (p_users);

  v_count := private.notify(v_recipients, p_event, v_kind, p_title, p_body, nullif(p_link, ''), '{}', p_email);
  perform private.audit(p_event, p_key || '.notified', 'notification', null,
    jsonb_build_object('kind', v_kind, 'count', coalesce(cardinality(v_recipients), 0)));
  return v_count;
end;
$$;
grant execute on function public.notify_event(uuid, text, text, uuid[], text, text, text, text, boolean)
to authenticated;

create function public.email_outbox_claim(p_limit integer default 20)
returns setof public.email_outbox
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'only the app drains the outbox' using errcode = '42501';
  end if;
  return query
  update public.email_outbox o
  set status = 'sending', attempts = o.attempts + 1, next_attempt_at = now() + interval '10 minutes'
  where o.id in (
    select d.id from public.email_outbox d
    where d.status in ('queued', 'sending') and d.next_attempt_at <= now()
    order by d.next_attempt_at, d.id
    limit greatest(least(p_limit, 100), 1)
    for update skip locked
  )
  returning o.*;
end;
$$;
revoke execute on function public.email_outbox_claim(integer) from authenticated;
grant execute on function public.email_outbox_claim(integer) to service_role;

create function public.email_outbox_finish(
  p_id bigint, p_outcome text, p_error text default null, p_max_attempts integer default 5
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'only the app drains the outbox' using errcode = '42501';
  end if;
  if p_outcome not in ('sent', 'skipped', 'retry') then
    raise exception 'unknown outcome "%"', p_outcome using errcode = '22023';
  end if;
  update public.email_outbox o
  set
    status = case
      when p_outcome = 'sent' then 'sent'
      when p_outcome = 'skipped' then 'skipped'
      when o.attempts >= p_max_attempts then 'failed'
      else 'queued'
    end,
    sent_at = case when p_outcome = 'sent' then now() else o.sent_at end,
    last_error = left(p_error, 500),
    next_attempt_at = case
      when p_outcome = 'retry' and o.attempts < p_max_attempts
        then now() + make_interval(mins => (4 ^ greatest(o.attempts - 1, 0))::integer)
      else o.next_attempt_at
    end
  where o.id = p_id;
end;
$$;
revoke execute on function public.email_outbox_finish(bigint, text, text, integer) from authenticated;
grant execute on function public.email_outbox_finish(bigint, text, text, integer) to service_role;

create function private.drain_email_outbox()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := private.instance_setting('tenancy') ->> 'appUrl';
  v_waiting integer;
  v_ts text := extract(epoch from now())::bigint::text;
begin
  if v_url is null then
    return 0;
  end if;
  select count(*) into v_waiting from public.email_outbox
  where status in ('queued', 'sending') and next_attempt_at <= now();
  if v_waiting = 0 then
    return 0;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/api/email/drain',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-bogey-timestamp', v_ts,
      'x-bogey-signature', encode(extensions.hmac(v_ts, private.email_drain_secret(), 'sha256'), 'hex'))
  );
  return v_waiting;
end;
$$;
revoke execute on function private.drain_email_outbox() from anon, authenticated;

create function private.prune_notifications()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.email_outbox
  where status in ('sent', 'skipped', 'failed') and created_at < now() - interval '30 days';
  delete from public.notifications where created_at < now() - interval '180 days';
$$;
revoke execute on function private.prune_notifications() from anon, authenticated;

create function private.email_outbox_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'queued', count(*) filter (where status in ('queued', 'sending')),
    'oldestQueuedAt', min(created_at) filter (where status in ('queued', 'sending')),
    'failed24h', count(*) filter (where status = 'failed' and created_at > now() - interval '1 day'),
    'lastError', (select o.last_error from public.email_outbox o
                  where o.last_error is not null order by o.id desc limit 1))
  from public.email_outbox;
$$;
revoke execute on function private.email_outbox_stats() from anon, authenticated;

select private.hide_suspended_org('public.notifications');
select private.hide_suspended_org('public.email_outbox');

select cron.schedule('bogey-email-drain', '* * * * *', 'select private.drain_email_outbox()');
select cron.schedule('bogey-prune-notifications', '23 4 * * *', 'select private.prune_notifications()');
