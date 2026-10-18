-- session_pages: a session can have a page of its own (page_md); one that takes attendance always has one,
-- and agenda.tabMenu lists them under the Agenda tab

alter table public.event_sessions add column if not exists page_md text not null default ''
  check (length(page_md) <= 50000);

create or replace function public.event_agenda(p_event uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_member boolean := private.has_permission(p_event, 'event.view');
begin
  if not private.can_view_event(p_event) then
    raise exception 'event not found' using errcode = 'P0002';
  end if;
  if not private.section_open(p_event, 'agenda') then
    return jsonb_build_object('signups_open', false, 'categories', '[]'::jsonb, 'slots', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'signups_open', private.window_open(p_event, 'sessions'),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('kind', c.kind, 'label', c.label) order by c.kind, c.sort, c.label)
      from public.session_categories c where c.event_id = p_event
    ), '[]'),
    'slots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', sl.id, 'name', sl.name, 'kind', sl.kind,
        'starts_at', sl.starts_at, 'ends_at', sl.ends_at,
        'sessions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', s.id, 'kind', s.kind, 'name', s.name, 'description_md', s.description_md,
            'page_md', s.page_md,
            'location', s.location, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
            'host_note', s.host_note, 'capacity', s.capacity, 'required', s.required,
            'takes_attendance', s.takes_attendance, 'visibility', s.visibility,
            'category', (select c.label from public.session_categories c where c.id = s.category_id),
            'hosts', coalesce((
              select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name) order by p.display_name)
              from public.session_hosts h join public.profiles p on p.id = h.user_id
              where h.session_id = s.id and v_member
            ), '[]'),
            'taken', (select count(*) from public.session_signups g where g.session_id = s.id),
            'mine', exists (
              select 1 from public.session_signups g where g.session_id = s.id and g.user_id = v_uid
            ),
            'attended', exists (
              select 1 from public.session_attendance a where a.session_id = s.id and a.user_id = v_uid
            ),
            'can_take_attendance', s.takes_attendance and private.takes_attendance(p_event, s.id)
          ) order by coalesce(s.starts_at, sl.starts_at), s.sort, s.name)
          from public.event_sessions s
          where s.slot_id = sl.id and private.can_see_session(p_event, s.id, s.visibility)
        ), '[]')
      ) order by sl.starts_at, sl.name)
      from public.session_slots sl where sl.event_id = p_event
    ), '[]')
  );
end;
$$;

create or replace function private.write_agenda(p_event uuid, p_agenda jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removed integer;
  v_slot jsonb;
  v_slot_id uuid;
  v_session jsonb;
  v_session_id uuid;
  v_keep_slots uuid[] := '{}';
  v_keep_sessions uuid[] := '{}';
  v_kind text;
begin
  for v_kind in
    select distinct sess ->> 'kind'
    from jsonb_array_elements(coalesce(p_agenda -> 'slots', '[]')) sl,
      jsonb_array_elements(coalesce(sl -> 'sessions', '[]')) sess
    where (sess ->> 'kind') like '%.%'
  loop
    if not private.plugin_enabled(p_event, split_part(v_kind, '.', 1))
      and not exists (select 1 from public.event_sessions where event_id = p_event and kind = v_kind) then
      raise exception 'turn on the % extension to use its session types', split_part(v_kind, '.', 1)
        using errcode = '22023';
    end if;
  end loop;

  if p_agenda ? 'categories' then
    perform private.write_session_levels(p_event, p_agenda -> 'categories');
  end if;

  for v_slot in select * from jsonb_array_elements(coalesce(p_agenda -> 'slots', '[]')) loop
    v_slot_id := coalesce((v_slot ->> 'id')::uuid, gen_random_uuid());
    insert into public.session_slots (id, event_id, name, kind, starts_at, ends_at)
    values (v_slot_id, p_event, nullif(v_slot ->> 'name', ''), (v_slot ->> 'kind')::public.slot_kind,
      (v_slot ->> 'starts_at')::timestamptz, (v_slot ->> 'ends_at')::timestamptz)
    on conflict (id) do update set
      name = excluded.name, kind = excluded.kind, starts_at = excluded.starts_at, ends_at = excluded.ends_at
    where public.session_slots.event_id = p_event;
    v_keep_slots := v_keep_slots || v_slot_id;

    for v_session in
      select value from jsonb_array_elements(coalesce(v_slot -> 'sessions', '[]')) with ordinality
      order by ordinality
    loop
      v_session_id := coalesce((v_session ->> 'id')::uuid, gen_random_uuid());
      insert into public.event_sessions (id, event_id, slot_id, category_id, kind, name, description_md,
        page_md, location, starts_at, ends_at, host_note, capacity, required, takes_attendance, visibility, sort)
      values (v_session_id, p_event, v_slot_id,
        (select c.id from public.session_categories c
          where c.event_id = p_event and c.kind = coalesce(v_session ->> 'kind', 'session')
            and c.label = v_session ->> 'category'),
        coalesce(v_session ->> 'kind', 'session'), v_session ->> 'name',
        coalesce(v_session ->> 'description_md', ''), coalesce(v_session ->> 'page_md', ''),
        nullif(v_session ->> 'location', ''),
        (v_session ->> 'starts_at')::timestamptz, (v_session ->> 'ends_at')::timestamptz,
        nullif(v_session ->> 'host_note', ''), (v_session ->> 'capacity')::integer,
        coalesce((v_session ->> 'required')::boolean, false),
        coalesce((v_session ->> 'takes_attendance')::boolean, false),
        coalesce(v_session ->> 'visibility', 'everyone')::public.session_visibility,
        cardinality(v_keep_sessions)::smallint)
      on conflict (id) do update set
        slot_id = excluded.slot_id, category_id = excluded.category_id, kind = excluded.kind,
        name = excluded.name, description_md = excluded.description_md, page_md = excluded.page_md,
        location = excluded.location,
        starts_at = excluded.starts_at, ends_at = excluded.ends_at, host_note = excluded.host_note,
        capacity = excluded.capacity, required = excluded.required,
        takes_attendance = excluded.takes_attendance, visibility = excluded.visibility, sort = excluded.sort
      where public.event_sessions.event_id = p_event;
      v_keep_sessions := v_keep_sessions || v_session_id;

      delete from public.session_hosts
      where session_id = v_session_id
        and user_id not in (
          select (value #>> '{}')::uuid from jsonb_array_elements(coalesce(v_session -> 'hosts', '[]'))
        );
      insert into public.session_hosts (event_id, session_id, user_id)
      select p_event, v_session_id, (value #>> '{}')::uuid
      from jsonb_array_elements(coalesce(v_session -> 'hosts', '[]'))
      on conflict do nothing;
    end loop;
  end loop;

  delete from public.event_sessions where event_id = p_event and id <> all (v_keep_sessions);
  get diagnostics v_removed = row_count;
  delete from public.session_slots where event_id = p_event and id <> all (v_keep_slots);
  delete from public.session_signups g using public.session_slots sl
  where g.slot_id = sl.id and sl.event_id = p_event and sl.kind = 'everyone';

  perform private.audit(p_event, 'sessions.agenda_saved', 'event', p_event, jsonb_build_object(
    'slots', cardinality(v_keep_slots), 'sessions', cardinality(v_keep_sessions), 'removed', v_removed));
  return v_removed;
end;
$$;

create or replace function public.clone_event(
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
  v_rubrics jsonb := '{}';
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
    location, website_url, team_size_min, team_size_max, is_template, created_by)
  select v_src.org_id, lower(p_slug), trim(p_name), v_src.kind, v_src.timezone,
    v_src.starts_at + v_shift,
    case when p_ends_at is not null and not p_template then p_ends_at else v_src.ends_at + v_shift end,
    case when 'details' = any (p_include) then v_src.short_name end,
    case when 'details' = any (p_include) then v_src.location end,
    case when 'details' = any (p_include) then v_src.website_url end,
    case when 'details' = any (p_include) then v_src.team_size_min else 1 end,
    case when 'details' = any (p_include) then v_src.team_size_max else 4 end,
    p_template, (select auth.uid())
  returning * into v_new;

  if 'windows' = any (p_include) then
    insert into public.event_windows (event_id, key, opens_at, closes_at, reminder_minutes, updated_by)
    select v_new.id, key, opens_at + v_shift, closes_at + v_shift, reminder_minutes, (select auth.uid())
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
    for r in select * from public.rubrics where event_id = p_source loop
      insert into public.rubrics (event_id, name, description_md, sort)
      values (v_new.id, r.name, r.description_md, r.sort) returning id into v_id;
      v_rubrics := v_rubrics || jsonb_build_object(r.id::text, v_id);
    end loop;
    insert into public.criteria (event_id, label, description_md, min_score, max_score, weight, sort, round_id, rubric_id)
    select v_new.id, label, description_md, min_score, max_score, weight, sort,
      (v_rounds ->> round_id::text)::uuid, (v_rubrics ->> rubric_id::text)::uuid
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
        page_md, location, starts_at, ends_at, host_note, capacity, required, takes_attendance, visibility, sort)
      values (v_new.id, (v_slots ->> r.slot_id::text)::uuid, (v_categories ->> r.category_id::text)::uuid,
        r.kind, r.name, r.description_md, r.page_md, r.location, r.starts_at + v_shift, r.ends_at + v_shift,
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
      when 'about' then 'details' = any (p_include)
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

create or replace function private.setting_defaults(p_namespace text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce($json${"branding":{},"registration":{"signup":"invite","mode":"review","capacity":0,"autoPromote":true},"email":{},"tenancy":{},"accounts":{"deletionRequests":true,"requireAdminMfa":true,"portfolios":false,"deviceSignOut":false,"maxPasskeys":5},"signin":{"providers":[]},"audit":{"retentionDays":60},"access":{"allowedNetworks":[],"onlyUsers":[],"onlyTeams":[],"onlyDivisions":[]},"network":{"clientIpHeader":"x-forwarded-for","trustedHops":1,"trustedProxies":[]},"seo":{"indexing":true},"limits":{},"submissions":{"autoSubmit":false,"deletion":"allow","reminderHours":24,"publicToggle":false},"schedule":{"display":"list","hiddenWindows":[],"showEventTimezone":false},"agenda":{"kinds":[],"reminderMinutes":5,"tabMenu":true},"home":{"layout":{"main":[{"id":"next-steps","type":"next-steps"},{"id":"agenda","type":"agenda"}],"aside":[{"id":"announcements","type":"announcements"},{"id":"facts","type":"facts"},{"id":"prizes","type":"prizes"},{"id":"about","type":"about"}]}},"tabs":{"items":[]},"identity":{"enabled":false},"chat":{"enabled":true,"staff":true,"participants":false,"judges":false,"copyTeam":true},"certificates":{"enabled":false},"announcements":{"toasts":true,"urgentStays":true,"postAs":"author","judges":false},"teams":{"disband":"captain","board":false,"switching":true,"askOrganizer":true,"creation":"participants","leaveLimit":0},"divisions":{"askOnJoin":true},"venue":{},"privacy":{"about":"members","agenda":"members","tracks":"public"},"about":{},"checkin":{"confirmName":true,"allowWalkIns":false,"badgeEmailHours":24,"requiredToCompete":false,"takers":["organizer","staff"]},"voting":{"enabled":false,"who":"participants","votesPerPerson":1,"ownTeam":false,"showCounts":false},"judging":{"blind":false,"showRankings":"organizers","normalize":"none","minJudges":2,"shareWithTeams":"feedback","judgeRubric":true,"teamRubric":false,"teamRubricShows":"name","deliberation":"assigned","flagGap":0,"holdFlagged":true},"plugins":{"enabled":[]}}$json$::jsonb -> p_namespace, '{}');
$$;
