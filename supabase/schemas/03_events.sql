create table public.events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  slug extensions.citext not null check (slug ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  name text not null check (length(name) between 1 and 120),
  short_name text check (length(short_name) <= 32),
  kind public.event_kind not null default 'hackathon',
  description_md text not null default '',
  timezone text not null default 'UTC',
  starts_at timestamptz,
  ends_at timestamptz,
  location text,
  website_url text check (website_url ~ '^https?://'),
  visibility public.event_visibility not null default 'draft',
  is_template boolean not null default false,
  team_size_min smallint not null default 1,
  team_size_max smallint not null default 4,
  created_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, slug),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  check (team_size_min between 1 and team_size_max and team_size_max <= 50),
  check (not is_template or visibility = 'draft')
);
create index events_org_id_idx on public.events (org_id);
create index events_created_by_fk_idx on public.events (created_by);

create function private.validate_event()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.org_id <> old.org_id then
    raise exception 'an event cannot move between orgs' using errcode = '23514';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'unknown timezone "%"', new.timezone using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger events_validate before insert or update on public.events
  for each row execute function private.validate_event();
create trigger events_touch before update on public.events
  for each row execute function private.touch_updated_at();

create table public.event_windows (
  event_id uuid not null references public.events on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)?$'),
  opens_at timestamptz,
  closes_at timestamptz,
  override public.window_override,
  updated_by uuid references public.profiles on delete set null,
  updated_at timestamptz not null default now(),
  primary key (event_id, key),
  check (closes_at is null or opens_at is null or closes_at > opens_at)
);
create index event_windows_updated_by_fk_idx on public.event_windows (updated_by);

create trigger event_windows_touch before update on public.event_windows
  for each row execute function private.touch_updated_at();

create table public.divisions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  name text not null check (length(name) between 1 and 60),
  description text,
  sort smallint not null default 0,
  selectable boolean not null default true,
  switchable boolean not null default true,
  created_at timestamptz not null default now(),
  unique (event_id, name),
  unique (event_id, id)
);

create table public.tracks (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  name text not null check (length(name) between 1 and 80),
  description_md text not null default '',
  prize_md text not null default '' check (length(prize_md) <= 2000),
  sponsor_name text check (length(sponsor_name) <= 80),
  sponsor_logo_url text check (sponsor_logo_url ~ '^https?://' and length(sponsor_logo_url) <= 500),
  max_winners smallint not null default 1 check (max_winners between 1 and 20),
  opt_in boolean not null default true,
  form_id uuid,
  sort smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (event_id, name),
  unique (event_id, id)
);

create table public.event_pages (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  slug extensions.citext not null check (slug ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  title text not null check (length(title) between 1 and 120),
  body_md text not null default '',
  window_key text,
  audience public.page_audience not null default 'members',
  sort smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, slug)
);

create trigger event_pages_touch before update on public.event_pages
  for each row execute function private.touch_updated_at();

create table public.event_visitors (
  event_id uuid not null references public.events on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  first_seen_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index event_visitors_user_id_idx on public.event_visitors (user_id);

alter table public.events enable row level security;
alter table public.event_windows enable row level security;
alter table public.divisions enable row level security;
alter table public.tracks enable row level security;
alter table public.event_pages enable row level security;
alter table public.event_visitors enable row level security;

create policy event_visitors_select on public.event_visitors for select to authenticated
  using (user_id = (select auth.uid()) or (select private.can_manage(event_id)));

create policy events_select on public.events for select to anon, authenticated
  using ((select private.can_view_event(id)));
create policy events_insert on public.events for insert to authenticated
  with check ((select private.is_org_admin(org_id)));
create policy events_update on public.events for update to authenticated
  using ((select private.can_manage(id)));
create policy events_delete on public.events for delete to authenticated
  using ((select private.is_org_admin(org_id)));

create policy event_windows_select on public.event_windows for select to anon, authenticated
  using ((select private.can_view_event(event_id)));
create policy event_windows_write_insert on public.event_windows for insert to authenticated
  with check ((select private.can_manage(event_id)));
create policy event_windows_write_update on public.event_windows for update to authenticated
  using ((select private.can_manage(event_id)))
  with check ((select private.can_manage(event_id)));
create policy event_windows_write_delete on public.event_windows for delete to authenticated
  using ((select private.can_manage(event_id)));

create policy divisions_select on public.divisions for select to anon, authenticated
  using ((select private.can_view_event(event_id)));
create policy divisions_write_insert on public.divisions for insert to authenticated
  with check ((select private.can_manage(event_id)));
create policy divisions_write_update on public.divisions for update to authenticated
  using ((select private.can_manage(event_id)))
  with check ((select private.can_manage(event_id)));
create policy divisions_write_delete on public.divisions for delete to authenticated
  using ((select private.can_manage(event_id)));

create policy tracks_select on public.tracks for select to anon, authenticated
  using ((select private.section_open(event_id, 'tracks')));
create policy tracks_write_insert on public.tracks for insert to authenticated
  with check ((select private.can_manage(event_id)));
create policy tracks_write_update on public.tracks for update to authenticated
  using ((select private.can_manage(event_id)))
  with check ((select private.can_manage(event_id)));
create policy tracks_write_delete on public.tracks for delete to authenticated
  using ((select private.can_manage(event_id)));

create policy event_pages_select on public.event_pages for select to anon, authenticated
  using (
    (select private.can_manage(event_id))
    or (
      (window_key is null or (select private.window_open(event_id, window_key)))
      and (
        (audience = 'public' and (select private.is_public_event(event_id)))
        or (select private.has_permission(event_id, 'event.view'))
      )
    )
  );
create policy event_pages_write_insert on public.event_pages for insert to authenticated
  with check ((select private.can_manage(event_id)));
create policy event_pages_write_update on public.event_pages for update to authenticated
  using ((select private.can_manage(event_id)))
  with check ((select private.can_manage(event_id)));
create policy event_pages_write_delete on public.event_pages for delete to authenticated
  using ((select private.can_manage(event_id)));

create function public.open_event(p_org uuid, p_slug text)
returns setof public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
begin
  select * into v_event from public.events where org_id = p_org and slug = lower(p_slug);
  if v_event.id is null then
    return;
  end if;
  if v_event.visibility = 'unlisted' and (select auth.uid()) is not null
     and not private.can_view_event(v_event.id) then
    insert into public.event_visitors (event_id, user_id)
    values (v_event.id, (select auth.uid()))
    on conflict do nothing;
  end if;
  if private.can_view_event(v_event.id) then
    return next v_event;
  end if;
end;
$$;
grant execute on function public.open_event(uuid, text) to anon, authenticated;

create function public.create_event(
  p_org uuid, p_slug text, p_name text, p_kind public.event_kind, p_timezone text,
  p_starts_at timestamptz default null, p_ends_at timestamptz default null,
  p_team_size_min smallint default 1, p_team_size_max smallint default 4,
  p_plugin text default null
)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_windows text[] := case p_kind
    when 'hackathon' then array['registration', 'teams', 'instructions', 'submissions', 'judging', 'results', 'gallery']
    else array['registration']
  end;
begin
  if not private.is_org_admin(p_org) then
    raise exception 'only org admins can create events' using errcode = '42501';
  end if;
  if p_plugin is not null and p_plugin !~ '^[a-z0-9-]{3,32}$' then
    raise exception 'not a plugin key' using errcode = '22023';
  end if;
  if p_plugin is not null and coalesce((
    select o.value ? 'available' and not (o.value -> 'available' ? p_plugin)
    from public.settings o
    where o.scope = 'org' and o.org_id = p_org and o.namespace = 'plugins'
  ), false) then
    raise exception 'this organization does not offer that extension' using errcode = '42501';
  end if;

  insert into public.events (org_id, slug, name, kind, timezone, starts_at, ends_at,
    team_size_min, team_size_max, created_by)
  values (p_org, lower(p_slug), trim(p_name), p_kind, p_timezone, p_starts_at, p_ends_at,
    p_team_size_min, p_team_size_max, (select auth.uid()))
  returning * into v_event;

  insert into public.event_windows (event_id, key, updated_by)
  select v_event.id, unnest(v_windows), (select auth.uid());

  if p_kind = 'hackathon' then
    perform private.add_default_submission_form(v_event.id);
  end if;

  if p_plugin is not null then
    insert into public.settings (scope, event_id, namespace, value, updated_by)
    values ('event', v_event.id, 'plugins', jsonb_build_object('enabled', jsonb_build_array(p_plugin)),
      (select auth.uid()));
  end if;

  perform private.audit(v_event.id, 'event.created', 'event', v_event.id,
    jsonb_build_object('name', v_event.name, 'kind', p_kind)
      || case when p_plugin is null then '{}'::jsonb else jsonb_build_object('plugin', p_plugin) end);
  return v_event;
end;
$$;
grant execute on function public.create_event(uuid, text, text, public.event_kind, text, timestamptz, timestamptz, smallint, smallint, text) to authenticated;

create function public.clone_event(
  p_source uuid, p_slug text, p_name text, p_starts_at timestamptz default null,
  p_include text[] default array['details', 'windows', 'divisions', 'tracks', 'forms', 'judging',
    'agenda', 'pages', 'homepage', 'settings', 'onboarding', 'invites'],
  p_template boolean default false, p_ends_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_src public.events;
  v_new public.events;
  v_shift interval;
  v_all constant text[] := array['details', 'windows', 'divisions', 'tracks', 'forms', 'judging',
    'agenda', 'pages', 'homepage', 'settings', 'onboarding', 'invites'];
  v_has boolean;
  r record;
  v_id uuid;
  v_forms jsonb := '{}';
  v_rounds jsonb := '{}';
  v_divisions jsonb := '{}';
  v_slots jsonb := '{}';
  v_categories jsonb := '{}';
  v_sessions jsonb := '{}';
  v_reenter text[];
begin
  select * into v_src from public.events where id = p_source;
  if not found or not private.is_org_admin(v_src.org_id) then
    raise exception 'only org admins can copy events' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(p_include) i where i <> all (v_all)) then
    raise exception 'unknown section' using errcode = '22023';
  end if;
  if 'judging' = any (p_include) and not 'forms' = any (p_include) then
    raise exception 'judging is copied together with forms' using errcode = '22023';
  end if;
  v_shift := case
    when p_template or p_starts_at is null or v_src.starts_at is null then interval '0'
    else p_starts_at - v_src.starts_at
  end;
  if not p_template and p_ends_at is not null
    and p_ends_at <= v_src.starts_at + v_shift then
    raise exception 'the end has to be after the start' using errcode = '22023';
  end if;

  insert into public.events (org_id, slug, name, kind, timezone, starts_at, ends_at, short_name,
    description_md, location, website_url, team_size_min, team_size_max, is_template, created_by)
  select v_src.org_id, lower(p_slug), trim(p_name), v_src.kind, v_src.timezone,
    v_src.starts_at + v_shift,
    case when p_ends_at is not null and not p_template then p_ends_at else v_src.ends_at + v_shift end,
    case when 'details' = any (p_include) then v_src.short_name end,
    case when 'details' = any (p_include) then v_src.description_md else '' end,
    case when 'details' = any (p_include) then v_src.location end,
    case when 'details' = any (p_include) then v_src.website_url end,
    case when 'details' = any (p_include) then v_src.team_size_min else 1 end,
    case when 'details' = any (p_include) then v_src.team_size_max else 4 end,
    p_template, (select auth.uid())
  returning * into v_new;

  if 'windows' = any (p_include) then
    insert into public.event_windows (event_id, key, opens_at, closes_at, updated_by)
    select v_new.id, key, opens_at + v_shift, closes_at + v_shift, (select auth.uid())
    from public.event_windows where event_id = p_source;
  end if;

  if 'divisions' = any (p_include) then
    for r in select * from public.divisions where event_id = p_source order by sort, name loop
      insert into public.divisions (event_id, name, description, sort, selectable, switchable)
      values (v_new.id, r.name, r.description, r.sort, r.selectable, r.switchable)
      returning id into v_id;
      v_divisions := v_divisions || jsonb_build_object(r.id::text, v_id);
    end loop;
  end if;

  if 'forms' = any (p_include) then
    for r in select * from public.submission_forms where event_id = p_source order by sort, key loop
      insert into public.submission_forms (event_id, key, title, description_md, window_key, judged, sort)
      values (v_new.id, r.key, r.title, r.description_md, r.window_key, r.judged, r.sort)
      returning id into v_id;
      v_forms := v_forms || jsonb_build_object(r.id::text, v_id);
      insert into public.submission_items (event_id, form_id, key, label, help, kind, required, options, config, sort)
      select v_new.id, v_id, key, label, help, kind, required, options, config, sort
      from public.submission_items where form_id = r.id;
    end loop;
  end if;

  if 'tracks' = any (p_include) then
    insert into public.tracks (event_id, name, description_md, prize_md, sponsor_name, sponsor_logo_url,
      max_winners, opt_in, form_id, sort)
    select v_new.id, name, description_md, prize_md, sponsor_name, sponsor_logo_url, max_winners, opt_in,
      (v_forms ->> form_id::text)::uuid, sort
    from public.tracks where event_id = p_source;
  end if;

  if 'judging' = any (p_include) then
    for r in select * from public.judging_rounds where event_id = p_source order by form_id, ordinal loop
      insert into public.judging_rounds (event_id, form_id, ordinal, name, window_key)
      values (v_new.id, (v_forms ->> r.form_id::text)::uuid, r.ordinal, r.name, r.window_key)
      on conflict (form_id, ordinal) do update set name = excluded.name, window_key = excluded.window_key
      returning id into v_id;
      v_rounds := v_rounds || jsonb_build_object(r.id::text, v_id);
    end loop;
    insert into public.criteria (event_id, label, description_md, min_score, max_score, weight, sort, round_id)
    select v_new.id, label, description_md, min_score, max_score, weight, sort,
      (v_rounds ->> round_id::text)::uuid
    from public.criteria where event_id = p_source;
  end if;

  if 'agenda' = any (p_include) then
    for r in select * from public.session_categories where event_id = p_source loop
      insert into public.session_categories (event_id, kind, label, sort)
      values (v_new.id, r.kind, r.label, r.sort) returning id into v_id;
      v_categories := v_categories || jsonb_build_object(r.id::text, v_id);
    end loop;
    for r in select * from public.session_slots where event_id = p_source loop
      insert into public.session_slots (event_id, name, kind, starts_at, ends_at)
      values (v_new.id, r.name, r.kind, r.starts_at + v_shift, r.ends_at + v_shift)
      returning id into v_id;
      v_slots := v_slots || jsonb_build_object(r.id::text, v_id);
    end loop;
    for r in select * from public.event_sessions where event_id = p_source loop
      insert into public.event_sessions (event_id, slot_id, category_id, kind, name, description_md,
        location, starts_at, ends_at, host_note, capacity, required, takes_attendance, visibility, sort)
      values (v_new.id, (v_slots ->> r.slot_id::text)::uuid, (v_categories ->> r.category_id::text)::uuid,
        r.kind, r.name, r.description_md, r.location, r.starts_at + v_shift, r.ends_at + v_shift,
        r.host_note, r.capacity, r.required, r.takes_attendance, r.visibility, r.sort)
      returning id into v_id;
      v_sessions := v_sessions || jsonb_build_object(r.id::text, v_id);
    end loop;
    if not p_template then
      for r in
        select distinct h.user_id from public.session_hosts h
        join public.org_members om on om.org_id = v_src.org_id and om.user_id = h.user_id
        where h.event_id = p_source
      loop
        insert into public.event_members (event_id, user_id, role, added_by)
        values (v_new.id, r.user_id, 'staff', (select auth.uid()))
        on conflict do nothing;
      end loop;
      insert into public.session_hosts (event_id, session_id, user_id)
      select v_new.id, (v_sessions ->> h.session_id::text)::uuid, h.user_id
      from public.session_hosts h
      where h.event_id = p_source
        and exists (select 1 from public.event_members m where m.event_id = v_new.id and m.user_id = h.user_id);
    end if;
  end if;

  if 'pages' = any (p_include) then
    insert into public.event_pages (event_id, slug, title, body_md, window_key, audience, sort)
    select v_new.id, slug, title, body_md, window_key, audience, sort
    from public.event_pages where event_id = p_source;
  end if;

  insert into public.settings (scope, event_id, namespace, value, locked_keys, updated_by)
  select 'event', v_new.id, namespace, value, locked_keys, (select auth.uid())
  from public.settings
  where scope = 'event' and event_id = p_source
    and case namespace
      when 'home' then 'homepage' = any (p_include)
      when 'briefing' then 'details' = any (p_include)
      else 'settings' = any (p_include)
    end;

  if 'onboarding' = any (p_include) then
    insert into public.onboarding_forms (event_id, fields)
    select v_new.id, fields from public.onboarding_forms where event_id = p_source;
  end if;

  if 'invites' = any (p_include) then
    insert into public.invite_links (event_id, label, auto_approve, capacity, division_id, opens_at,
      closes_at, disabled_at, created_by)
    select v_new.id, label, auto_approve, capacity, (v_divisions ->> division_id::text)::uuid,
      opens_at + v_shift, closes_at + v_shift, now(), (select auth.uid())
    from public.invite_links where event_id = p_source;
  end if;

  select coalesce(array_agg(name order by name), '{}') into v_reenter
  from public.secrets where scope = 'event' and event_id = p_source;

  perform private.audit(v_new.id, 'event.cloned', 'event', v_new.id,
    jsonb_build_object('from', p_source, 'template', p_template, 'sections', to_jsonb(p_include)));
  return jsonb_build_object('id', v_new.id, 'slug', v_new.slug, 'reenter', to_jsonb(v_reenter));
end;
$$;
grant execute on function public.clone_event(uuid, text, text, timestamptz, text[], boolean, timestamptz) to authenticated;

-- deletes an event and returns its stored files, which the caller removes through the storage API
create function public.delete_event(p_event uuid, p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_files jsonb;
begin
  select * into v_event from public.events where id = p_event;
  if v_event.id is null
    or not ((select auth.role()) = 'service_role' or private.is_org_admin(v_event.org_id)) then
    raise exception 'only an organization owner or admin can delete this event' using errcode = '42501';
  end if;
  if p_confirm is distinct from v_event.slug::text then
    raise exception 'type the event''s web address to delete it' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'path', o.name)), '[]')
  into v_files
  from storage.objects o
  where o.bucket_id in ('event-assets', 'submissions', 'registrations', 'message-attachments')
    and (storage.foldername(o.name))[1] = p_event::text;
  perform private.audit_org(v_event.org_id, 'event.deleted', 'event', v_event.id,
    jsonb_build_object('name', v_event.name, 'slug', v_event.slug));
  delete from public.events where id = p_event;
  return v_files;
end;
$$;
grant execute on function public.delete_event(uuid, text) to authenticated;

create function public.set_windows(p_event uuid, p_windows jsonb, p_label text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  w jsonb;
begin
  if not private.can_manage(p_event) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  for w in select * from jsonb_array_elements(p_windows) loop
    insert into public.event_windows (event_id, key, opens_at, closes_at, override, updated_by)
    values (
      p_event,
      w ->> 'key',
      (w ->> 'opens_at')::timestamptz,
      (w ->> 'closes_at')::timestamptz,
      (w ->> 'override')::public.window_override,
      (select auth.uid())
    )
    on conflict (event_id, key) do update set
      opens_at = case when w ? 'opens_at' then excluded.opens_at else public.event_windows.opens_at end,
      closes_at = case when w ? 'closes_at' then excluded.closes_at else public.event_windows.closes_at end,
      override = case when w ? 'override' then excluded.override else public.event_windows.override end,
      updated_by = excluded.updated_by;
  end loop;

  perform private.audit(p_event, 'windows.changed', 'event', p_event,
    jsonb_build_object('label', p_label, 'windows', p_windows));
end;
$$;
grant execute on function public.set_windows(uuid, jsonb, text) to authenticated;

create function public.remove_window(p_event uuid, p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_users text;
begin
  if not private.can_manage(p_event) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select string_agg(title, ', ' order by title) into v_users from (
    select title from public.submission_forms where event_id = p_event and window_key = p_key
    union all
    select title from public.event_pages where event_id = p_event and window_key = p_key
    union all
    select name from public.judging_rounds where event_id = p_event and window_key = p_key
  ) used;
  if v_users is not null then
    raise exception 'it opens %; change those first', v_users using errcode = '23503';
  end if;

  delete from public.event_windows where event_id = p_event and key = p_key;
  if found then
    perform private.audit(p_event, 'window.removed', 'event', p_event, jsonb_build_object('key', p_key));
  end if;
end;
$$;
grant execute on function public.remove_window(uuid, text) to authenticated;
