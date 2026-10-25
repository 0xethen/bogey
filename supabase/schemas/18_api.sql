create table public.calendar_tokens (
  user_id uuid primary key references public.profiles on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.calendar_tokens enable row level security;
create policy calendar_tokens_select on public.calendar_tokens for select to authenticated
  using (user_id = (select auth.uid()));

create function private.calendar_hash(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

create function public.create_calendar_token()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := 'bgc_' || encode(extensions.gen_random_bytes(24), 'hex');
begin
  if (select auth.uid()) is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  insert into public.calendar_tokens (user_id, token_hash)
  values ((select auth.uid()), private.calendar_hash(v_token))
  on conflict (user_id) do update set token_hash = excluded.token_hash, created_at = now(), last_used_at = null;
  return v_token;
end;
$$;
revoke execute on function public.create_calendar_token() from public, anon;
grant execute on function public.create_calendar_token() to authenticated;

create function public.revoke_calendar_token()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.calendar_tokens where user_id = (select auth.uid());
$$;
revoke execute on function public.revoke_calendar_token() from public, anon;
grant execute on function public.revoke_calendar_token() to authenticated;

create function public.calendar_feed(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  select user_id into v_user from public.calendar_tokens where token_hash = private.calendar_hash(p_token);
  if v_user is null then
    return null;
  end if;
  update public.calendar_tokens set last_used_at = now() where user_id = v_user and (last_used_at is null or last_used_at < now() - interval '1 hour');
  return jsonb_build_object(
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', es.id, 'event', e.slug, 'event_name', e.name, 'name', es.name,
        'location', es.location, 'description', es.description_md,
        'starts_at', coalesce(es.starts_at, sl.starts_at), 'ends_at', coalesce(es.ends_at, sl.ends_at))
        order by coalesce(es.starts_at, sl.starts_at))
      from public.event_sessions es
      join public.session_slots sl on sl.id = es.slot_id
      join public.events e on e.id = es.event_id
      join public.event_members m on m.event_id = es.event_id and m.user_id = v_user and m.status = 'active'
      where (exists (select 1 from public.session_signups su where su.session_id = es.id and su.user_id = v_user)
          or exists (select 1 from public.session_hosts h where h.session_id = es.id and h.user_id = v_user))
        and coalesce(e.ends_at, e.starts_at, now()) > now() - interval '30 days'), '[]'),
    'windows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'event', e.slug, 'event_name', e.name, 'key', w.key, 'opens_at', w.opens_at, 'closes_at', w.closes_at)
        order by coalesce(w.opens_at, w.closes_at))
      from public.event_windows w
      join public.events e on e.id = w.event_id
      join public.event_members m on m.event_id = w.event_id and m.user_id = v_user and m.status = 'active'
      where (w.opens_at is not null or w.closes_at is not null)
        and coalesce(e.ends_at, e.starts_at, now()) > now() - interval '30 days'), '[]'));
end;
$$;
revoke execute on function public.calendar_feed(text) from public;
grant execute on function public.calendar_feed(text) to anon, authenticated;

create function public.public_announcements(p_event uuid)
returns table (id uuid, title text, body_md text, severity public.announcement_severity, published_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_public_event(p_event) then
    raise exception 'event not found' using errcode = 'P0002';
  end if;
  return query
  select a.id, a.title, a.body_md, a.severity, a.publish_at
  from public.announcements a
  where a.event_id = p_event and a.deleted_at is null and a.everyone and a.publish_at <= now()
  order by a.publish_at desc
  limit 50;
end;
$$;
revoke execute on function public.public_announcements(uuid) from public;
grant execute on function public.public_announcements(uuid) to anon, authenticated;

create function private.webhook_kind(p_action text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_action
    when 'registration.pending' then 'registration.created'
    when 'registration.approved' then 'registration.updated'
    when 'registration.rejected' then 'registration.updated'
    when 'registration.withdrawn' then 'registration.updated'
    when 'registration.waitlisted' then 'registration.updated'
    when 'registration.promoted' then 'registration.updated'
    when 'team.created' then 'team.created'
    when 'submission.submitted' then 'submission.submitted'
    when 'results.published' then 'results.published'
    when 'window.opened' then 'window.opened'
    when 'window.closed' then 'window.closed'
    when 'announcement.posted' then 'announcement.posted'
    when 'checkin.checked_in' then 'checkin.created'
  end;
$$;

create function private.webhook_kinds()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['registration.created', 'registration.updated', 'team.created', 'submission.submitted',
    'results.published', 'window.opened', 'window.closed', 'announcement.posted', 'checkin.created'];
$$;

create function private.webhook_url_ok(p_url text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_url ~* '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{1,5})?(/[^\s]*)?$'
    and length(p_url) <= 500
    and split_part(split_part(substr(p_url, 9), '/', 1), ':', 1) !~* '(^|\.)(localhost|local|internal|lan|home|corp)$'
    and split_part(split_part(substr(p_url, 9), '/', 1), ':', 1) !~ '^[0-9.]+$';
$$;

create table public.webhooks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  event_id uuid,
  url text not null check (private.webhook_url_ok(url)),
  events text[] not null check (cardinality(events) between 1 and 9 and events <@ private.webhook_kinds()),
  disabled_at timestamptz,
  created_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  foreign key (event_id) references public.events on delete cascade
);
create index webhooks_org_id_idx on public.webhooks (org_id, event_id);
create index webhooks_event_id_fk_idx on public.webhooks (event_id);
create index webhooks_created_by_fk_idx on public.webhooks (created_by);
alter table public.webhooks enable row level security;
create policy webhooks_select on public.webhooks for select to authenticated
  using ((select private.is_org_admin(org_id)) or (event_id is not null and (event_id = any ((select private.events_where('event.manage'))::uuid[]))));

create table public.webhook_secrets (
  webhook_id uuid primary key references public.webhooks on delete cascade,
  secret text not null
);
alter table public.webhook_secrets enable row level security;

create table public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid not null references public.webhooks on delete cascade,
  org_id uuid not null,
  event_id uuid,
  kind text not null,
  payload jsonb not null,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed')),
  attempts integer not null default 0,
  request_id bigint,
  sent_at timestamptz,
  response_status integer,
  last_error text check (length(last_error) <= 500),
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
create index webhook_deliveries_webhook_id_idx on public.webhook_deliveries (webhook_id, created_at desc);
create index webhook_deliveries_due_idx on public.webhook_deliveries (next_attempt_at) where status = 'queued';
create index webhook_deliveries_sending_idx on public.webhook_deliveries (sent_at) where status = 'sending';
create index webhook_deliveries_org_id_idx on public.webhook_deliveries (org_id);
alter table public.webhook_deliveries enable row level security;
create policy webhook_deliveries_select on public.webhook_deliveries for select to authenticated
  using ((select private.is_org_admin(org_id)) or (event_id is not null and (event_id = any ((select private.events_where('event.manage'))::uuid[]))));

create function private.can_manage_webhook(p_org uuid, p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_event is null then private.is_org_admin(p_org)
    else private.is_org_admin(p_org) or private.can_manage(p_event) end;
$$;
revoke execute on function private.can_manage_webhook(uuid, uuid) from public, anon, authenticated;

create function public.create_webhook(
  p_org uuid, p_event uuid default null, p_url text default null, p_events text[] default null
)
returns table (webhook_id uuid, secret text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_secret text := 'whsec_' || encode(extensions.gen_random_bytes(24), 'hex');
begin
  if p_event is not null and not exists (select 1 from public.events e where e.id = p_event and e.org_id = p_org) then
    raise exception 'that event is not in this organization' using errcode = '22023';
  end if;
  if not private.can_manage_webhook(p_org, p_event) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if nullif(btrim(p_url), '') is null or coalesce(cardinality(p_events), 0) = 0 then
    raise exception 'a webhook needs an address and at least one kind' using errcode = '22023';
  end if;
  if (select count(*) from public.webhooks w where w.org_id = p_org) >= 25 then
    raise exception 'an organization can have 25 webhooks' using errcode = '54000';
  end if;
  insert into public.webhooks (org_id, event_id, url, events, created_by)
  values (p_org, p_event, btrim(p_url), p_events, (select auth.uid()))
  returning id into v_id;
  insert into public.webhook_secrets (webhook_id, secret) values (v_id, v_secret);
  if p_event is not null then
    perform private.audit(p_event, 'webhook.created', 'webhook', v_id, jsonb_build_object('events', p_events));
  else
    perform private.audit_org(p_org, 'webhook.created', 'webhook', v_id, jsonb_build_object('events', p_events));
  end if;
  return query select v_id, v_secret;
end;
$$;
revoke execute on function public.create_webhook(uuid, uuid, text, text[]) from public, anon;
grant execute on function public.create_webhook(uuid, uuid, text, text[]) to authenticated;

create function public.update_webhook(p_id uuid, p_url text, p_events text[], p_disabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hook public.webhooks;
begin
  select * into v_hook from public.webhooks where id = p_id;
  if v_hook.id is null or not private.can_manage_webhook(v_hook.org_id, v_hook.event_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.webhooks set url = btrim(p_url), events = p_events,
    disabled_at = case when p_disabled then coalesce(disabled_at, now()) end
  where id = p_id;
  if p_disabled then
    update public.webhook_deliveries set status = 'failed', last_error = 'webhook disabled'
    where webhook_id = p_id and status = 'queued';
  end if;
  if v_hook.event_id is not null then
    perform private.audit(v_hook.event_id, 'webhook.updated', 'webhook', p_id, jsonb_build_object('disabled', p_disabled));
  else
    perform private.audit_org(v_hook.org_id, 'webhook.updated', 'webhook', p_id, jsonb_build_object('disabled', p_disabled));
  end if;
end;
$$;
revoke execute on function public.update_webhook(uuid, text, text[], boolean) from public, anon;
grant execute on function public.update_webhook(uuid, text, text[], boolean) to authenticated;

create function public.delete_webhook(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hook public.webhooks;
begin
  select * into v_hook from public.webhooks where id = p_id;
  if v_hook.id is null or not private.can_manage_webhook(v_hook.org_id, v_hook.event_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from public.webhooks where id = p_id;
  if v_hook.event_id is not null then
    perform private.audit(v_hook.event_id, 'webhook.deleted', 'webhook', p_id, '{}');
  else
    perform private.audit_org(v_hook.org_id, 'webhook.deleted', 'webhook', p_id, '{}');
  end if;
end;
$$;
revoke execute on function public.delete_webhook(uuid) from public, anon;
grant execute on function public.delete_webhook(uuid) to authenticated;

create function public.rotate_webhook_secret(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hook public.webhooks;
  v_secret text := 'whsec_' || encode(extensions.gen_random_bytes(24), 'hex');
begin
  select * into v_hook from public.webhooks where id = p_id;
  if v_hook.id is null or not private.can_manage_webhook(v_hook.org_id, v_hook.event_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.webhook_secrets set secret = v_secret where webhook_id = p_id;
  if v_hook.event_id is not null then
    perform private.audit(v_hook.event_id, 'webhook.secret_rotated', 'webhook', p_id, '{}');
  else
    perform private.audit_org(v_hook.org_id, 'webhook.secret_rotated', 'webhook', p_id, '{}');
  end if;
  return v_secret;
end;
$$;
revoke execute on function public.rotate_webhook_secret(uuid) from public, anon;
grant execute on function public.rotate_webhook_secret(uuid) to authenticated;

create function public.resend_webhook_delivery(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.webhook_deliveries;
begin
  select * into v_row from public.webhook_deliveries where id = p_id;
  if v_row.id is null or not private.can_manage_webhook(v_row.org_id, v_row.event_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.webhook_deliveries set status = 'queued', attempts = 0, next_attempt_at = now(), last_error = null
  where id = p_id and status in ('sent', 'failed');
end;
$$;
revoke execute on function public.resend_webhook_delivery(uuid) from public, anon;
grant execute on function public.resend_webhook_delivery(uuid) to authenticated;

create function private.queue_webhooks(
  p_org uuid, p_event uuid, p_kind text, p_action text, p_target_type text, p_target_id uuid,
  p_meta jsonb, p_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
begin
  select * into v_event from public.events where id = p_event;
  insert into public.webhook_deliveries (webhook_id, org_id, event_id, kind, payload)
  select w.id, w.org_id, p_event, p_kind, jsonb_build_object(
    'kind', p_kind, 'action', p_action, 'at', p_at,
    'event', jsonb_build_object('id', v_event.id, 'slug', v_event.slug, 'name', v_event.name),
    'target', jsonb_build_object('type', p_target_type, 'id', p_target_id),
    'data', p_meta)
  from public.webhooks w
  where w.org_id = p_org and (w.event_id is null or w.event_id = p_event)
    and w.disabled_at is null and p_kind = any (w.events);
end;
$$;
revoke execute on function private.queue_webhooks(uuid, uuid, text, text, text, uuid, jsonb, timestamptz)
  from public, anon, authenticated;

create function private.webhook_from_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text := private.webhook_kind(new.action);
begin
  -- A scheduled announcement is sent when it goes live, by deliver_webhooks.
  if v_kind is null or new.event_id is null or coalesce((new.meta ->> 'scheduled')::boolean, false) then
    return null;
  end if;
  perform private.queue_webhooks(new.org_id, new.event_id, v_kind, new.action, new.target_type,
    new.target_id, new.meta, new.created_at);
  return null;
exception when others then
  return null;
end;
$$;
create trigger audit_log_webhooks after insert on public.audit_log
  for each row execute function private.webhook_from_audit();

create function private.webhook_format(p_url text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_url ~* '^https://((ptb|canary)\.)?discord(app)?\.com/api/webhooks/' then 'discord'
    when p_url ~* '^https://hooks\.slack\.com/' then 'slack'
    else 'json'
  end;
$$;

create function private.webhook_summary(p_payload jsonb, p_quote text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_data jsonb := coalesce(p_payload -> 'data', '{}');
  -- Anything people typed is quoted for the chat service, so it can't add links or formatting.
  v_name text := case when p_quote is null then coalesce(v_data ->> 'name', '')
    else regexp_replace(coalesce(v_data ->> 'name', ''), p_quote, '\\\1', 'g') end;
  v_title text := case when p_quote is null then coalesce(v_data ->> 'title', '')
    else regexp_replace(coalesce(v_data ->> 'title', ''), p_quote, '\\\1', 'g') end;
  v_window text := case when p_quote is null then coalesce(v_data ->> 'key', '')
    else regexp_replace(coalesce(v_data ->> 'key', ''), p_quote, '\\\1', 'g') end;
begin
  return case p_payload ->> 'action'
    when 'registration.pending' then 'Someone registered and is waiting for review.'
    when 'registration.approved' then 'A registration was approved.'
    when 'registration.rejected' then 'A registration was declined.'
    when 'registration.withdrawn' then 'Someone withdrew their registration.'
    when 'registration.waitlisted' then 'Someone joined the waitlist.'
    when 'registration.promoted' then 'Someone moved up from the waitlist.'
    when 'team.created' then format('Team "%s" was created.', v_name)
    when 'submission.submitted' then 'A project was submitted.'
    when 'results.published' then 'Results are published.'
    when 'window.opened' then format('The %s window opened.', v_window)
    when 'window.closed' then format('The %s window closed.', v_window)
    when 'announcement.posted' then case
      when coalesce((v_data ->> 'everyone')::boolean, false) then format('Announcement: %s', v_title)
      else 'An announcement was posted.'
    end
    when 'checkin.checked_in' then 'Someone checked in.'
    else p_payload ->> 'kind'
  end;
end;
$$;

-- Discord and Slack take their own message shape; every other address gets the signed JSON.
create function private.webhook_body(p_url text, p_payload jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_format text := private.webhook_format(p_url);
  v_base text;
  v_link text;
  v_text text;
begin
  if v_format = 'json' then
    return p_payload;
  end if;
  select 'https://' || d.hostname into v_base from public.org_domains d
  join public.events e on e.org_id = d.org_id
  where e.id = (p_payload #>> '{event,id}')::uuid and d.is_primary;
  v_base := rtrim(coalesce(v_base, private.instance_setting('tenancy') ->> 'appUrl', ''), '/');
  if v_base <> '' then
    v_link := v_base || '/events/' || (p_payload #>> '{event,slug}');
  end if;
  if v_format = 'discord' then
    v_text := format('**%s** · %s',
      regexp_replace(p_payload #>> '{event,name}', '([\\*_~`|>#\[\]()<@-])', '\\\1', 'g'),
      private.webhook_summary(p_payload, '([\\*_~`|>#\[\]()<@-])'));
    if v_link is not null then
      v_text := v_text || E'\n<' || v_link || '>';
    end if;
    return jsonb_build_object('content', left(v_text, 2000),
      'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb));
  end if;
  v_text := format('*%s* · %s',
    replace(replace(replace(p_payload #>> '{event,name}', '&', '&amp;'), '<', '&lt;'), '>', '&gt;'),
    replace(replace(replace(private.webhook_summary(p_payload, null), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'));
  if v_link is not null then
    v_text := v_text || E'\n<' || v_link || '|Open the event>';
  end if;
  return jsonb_build_object('text', v_text);
end;
$$;
revoke execute on function private.webhook_body(text, jsonb) from public, anon, authenticated;

create function private.queue_due_announcement_webhooks()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  for v_row in
    select a.id, a.event_id, a.title, a.everyone, a.publish_at, e.org_id
    from public.announcements a
    join public.events e on e.id = a.event_id
    where a.deleted_at is null
      and a.publish_at > a.created_at
      and a.publish_at <= now()
      and a.publish_at > now() - interval '1 hour'
      and not exists (
        select 1 from public.webhook_deliveries d
        where d.kind = 'announcement.posted' and d.payload #>> '{target,id}' = a.id::text
      )
  loop
    perform private.queue_webhooks(v_row.org_id, v_row.event_id, 'announcement.posted',
      'announcement.posted', 'announcement', v_row.id,
      jsonb_build_object('title', v_row.title, 'everyone', v_row.everyone), v_row.publish_at);
  end loop;
end;
$$;
revoke execute on function private.queue_due_announcement_webhooks() from public, anon, authenticated;

create function private.deliver_webhooks()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_response record;
  v_body text;
  v_ts text;
  v_secret text;
  v_url text;
  v_request bigint;
  v_count integer := 0;
  v_delays constant integer[] := array[1, 5, 30, 120, 720];
  v_payload jsonb;
begin
  perform private.queue_due_announcement_webhooks();

  for v_row in
    select d.id, d.request_id, d.attempts, d.sent_at from public.webhook_deliveries d
    where d.status = 'sending' for update skip locked
  loop
    select r.status_code, r.error_msg, r.content into v_response from net._http_response r where r.id = v_row.request_id;
    if v_response is null and v_row.sent_at > now() - interval '10 minutes' then
      continue;
    end if;
    if v_response.status_code between 200 and 299 then
      update public.webhook_deliveries set status = 'sent', delivered_at = now(), response_status = v_response.status_code,
        last_error = null where id = v_row.id;
    elsif v_response.status_code between 400 and 499 and v_response.status_code not in (408, 429) then
      -- The address refused this request; sending it again won't change the answer.
      update public.webhook_deliveries set status = 'failed', response_status = v_response.status_code,
        last_error = left('answered ' || v_response.status_code
          || coalesce(': ' || nullif(btrim(v_response.content), ''), ''), 500)
      where id = v_row.id;
    else
      update public.webhook_deliveries set
        status = case when attempts >= 6 then 'failed' else 'queued' end,
        next_attempt_at = now() + make_interval(mins => v_delays[least(attempts, 5)]),
        response_status = v_response.status_code,
        last_error = left(coalesce(v_response.error_msg, case when v_response.status_code is null then 'no response' else 'answered ' || v_response.status_code end), 500)
      where id = v_row.id;
    end if;
  end loop;

  for v_row in
    select d.id, d.webhook_id, d.kind, d.payload from public.webhook_deliveries d
    join public.webhooks w on w.id = d.webhook_id and w.disabled_at is null
    where d.status = 'queued' and d.next_attempt_at <= now()
    order by d.next_attempt_at limit 50 for update of d skip locked
  loop
    select w.url, s.secret into v_url, v_secret from public.webhooks w
    join public.webhook_secrets s on s.webhook_id = w.id where w.id = v_row.webhook_id;
    v_payload := private.webhook_body(v_url, v_row.payload);
    v_body := v_payload::text;
    v_ts := extract(epoch from now())::bigint::text;
    select net.http_post(
      url := v_url,
      body := v_payload,
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'user-agent', 'Bogey-Webhook/1',
        'x-bogey-event', v_row.kind,
        'x-bogey-delivery', v_row.id::text,
        'x-bogey-timestamp', v_ts,
        'x-bogey-signature', 'sha256=' || encode(extensions.hmac(v_ts || '.' || v_body, v_secret, 'sha256'), 'hex')),
      timeout_milliseconds := 10000) into v_request;
    update public.webhook_deliveries set status = 'sending', attempts = attempts + 1, request_id = v_request, sent_at = now()
    where id = v_row.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke execute on function private.deliver_webhooks() from public, anon, authenticated;

create function private.prune_webhook_deliveries()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.webhook_deliveries where created_at < now() - interval '30 days';
$$;
revoke execute on function private.prune_webhook_deliveries() from public, anon, authenticated;

select private.hide_suspended_org('public.webhooks');
select private.hide_suspended_org('public.webhook_deliveries');

select cron.schedule('bogey-webhooks', '* * * * *', 'select private.deliver_webhooks()');
select cron.schedule('bogey-prune-webhooks', '41 4 * * *', 'select private.prune_webhook_deliveries()');

create function public.event_archive_people(p_event uuid)
returns table (user_id uuid, email text, display_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select e.org_id into v_org from public.events e where e.id = p_event;
  if v_org is null or not ((select auth.role()) = 'service_role' or private.is_org_admin(v_org)) then
    raise exception 'only organization admins can archive an event' using errcode = '42501';
  end if;
  return query
  select m.user_id, u.email::text, p.display_name
  from public.event_members m
  join public.profiles p on p.id = m.user_id
  join auth.users u on u.id = m.user_id
  where m.event_id = p_event
  order by p.display_name;
end;
$$;
revoke execute on function public.event_archive_people(uuid) from public, anon;
grant execute on function public.event_archive_people(uuid) to authenticated, service_role;

create function public.portfolios_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (private.instance_setting('accounts') ->> 'portfolios')::boolean is true;
$$;
revoke execute on function public.portfolios_enabled() from public;
grant execute on function public.portfolios_enabled() to authenticated;

create function public.public_profile(p_handle text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
begin
  if public.portfolios_enabled() is not true then
    return null;
  end if;
  select * into v_profile from public.profiles where handle = p_handle::extensions.citext;
  if v_profile.id is null then
    return null;
  end if;
  if v_profile.visibility <> 'public' and v_profile.id is distinct from (select auth.uid())
    and not private.shares_org(v_profile.id) then
    return null;
  end if;
  return jsonb_build_object(
    'name', v_profile.display_name,
    'handle', v_profile.handle,
    'avatarPath', v_profile.avatar_path,
    'pronouns', v_profile.pronouns,
    'bio', v_profile.bio_md,
    'links', v_profile.links,
    'visibility', v_profile.visibility,
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'title', s.title, 'team', t.name, 'event', e.slug, 'eventName', e.name, 'submittedAt', s.submitted_at)
        order by s.submitted_at desc)
      from public.team_members tm
      join public.submissions s on s.team_id = tm.team_id and s.status = 'submitted' and s.is_public
      join public.teams t on t.id = s.team_id
      join public.events e on e.id = s.event_id
      where tm.user_id = v_profile.id and private.gallery_open(s.event_id)), '[]'),
    'awards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', a.kind, 'label', a.label, 'place', a.place, 'project', s.title, 'event', e.slug, 'eventName', e.name)
        order by e.starts_at desc nulls last, a.sort)
      from public.team_members tm
      join public.awards a on a.submission_id is not null
      join public.submissions s on s.id = a.submission_id and s.team_id = tm.team_id
      join public.events e on e.id = a.event_id
      where tm.user_id = v_profile.id and private.is_public_event(a.event_id)
        and private.latest_publication(a.event_id) is not null), '[]'),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('slug', e.slug, 'name', e.name, 'startsAt', e.starts_at)
        order by e.starts_at desc nulls last)
      from public.checkins c
      join public.events e on e.id = c.event_id
      where c.user_id = v_profile.id and private.is_public_event(e.id)), '[]'));
end;
$$;
revoke execute on function public.public_profile(text) from public;
grant execute on function public.public_profile(text) to anon, authenticated;
