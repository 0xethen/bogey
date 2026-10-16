-- one About, for members unless privacy.about shares it; the participants-only briefing joins it

create or replace function private.setting_defaults(p_namespace text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce($json${"branding":{},"registration":{"signup":"invite","mode":"review","capacity":0,"autoPromote":true},"email":{},"tenancy":{},"accounts":{"deletionRequests":true,"requireAdminMfa":true,"portfolios":false},"signin":{"providers":[]},"audit":{"retentionDays":60},"access":{"allowedNetworks":[],"onlyUsers":[],"onlyTeams":[],"onlyDivisions":[]},"network":{"clientIpHeader":"x-forwarded-for","trustedHops":1,"trustedProxies":[]},"seo":{"indexing":true},"limits":{},"submissions":{"autoSubmit":false,"deletion":"allow","reminderHours":24,"publicToggle":false},"schedule":{"display":"list","hiddenWindows":[],"showEventTimezone":false},"agenda":{"kinds":[],"reminderMinutes":30},"home":{"layout":{"main":[{"id":"next-steps","type":"next-steps"},{"id":"agenda","type":"agenda"}],"aside":[{"id":"announcements","type":"announcements"},{"id":"facts","type":"facts"},{"id":"prizes","type":"prizes"},{"id":"about","type":"about"}]}},"identity":{"enabled":false},"chat":{"enabled":true,"staff":true,"participants":true,"judges":false,"copyTeam":true},"certificates":{"enabled":false},"announcements":{"toasts":true,"urgentStays":true,"postAs":"author","judges":false},"teams":{"disband":"captain","board":true,"switching":true,"askOrganizer":true,"creation":"participants","leaveLimit":2},"divisions":{"askOnJoin":true},"venue":{},"privacy":{"about":"members","agenda":"members","tracks":"public"},"about":{},"checkin":{"confirmName":true,"allowWalkIns":false,"badgeEmailHours":24,"requiredToCompete":false},"voting":{"enabled":false,"who":"participants","votesPerPerson":1,"ownTeam":false,"showCounts":false},"judging":{"blind":false,"showRankings":"organizers","normalize":"none","minJudges":2,"shareWithTeams":"feedback","judgeRubric":true,"teamRubric":false,"teamRubricShows":"name","deliberation":"assigned","flagGap":0,"holdFlagged":true},"plugins":{"enabled":[]}}$json$::jsonb -> p_namespace, '{}');
$$;

create or replace function public.settings_for(p_namespaces text[], p_org uuid default null, p_event uuid default null)
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
    if private.is_public_namespace(v_ns) or v_member
      or (v_ns = 'about' and p_event is not null and private.section_open(p_event, 'about')) then
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

drop policy settings_select on public.settings;
create policy settings_select on public.settings for select to anon, authenticated
  using (
    case scope
      when 'instance' then not private.is_admin_only_namespace(namespace)
        or (select private.is_platform_admin())
      when 'org' then private.is_public_namespace(namespace) or (select private.is_org_member(org_id))
      when 'event' then (select private.can_view_event(event_id))
        and (private.is_public_namespace(namespace)
          or (select private.has_permission(event_id, 'event.view'))
          or (namespace = 'about' and (select private.section_open(event_id, 'about'))))
    end
  );

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

create or replace function public.bogey_seed_demo(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hack uuid;
  v_ms uuid;
  v_hs uuid;
  v_now timestamptz := date_trunc('hour', now());
  v_day date := (now() at time zone 'America/New_York')::date;
begin
  delete from public.events where org_id = p_org and slug = 'demo-hackathon';

  insert into public.events (org_id, slug, name, short_name, kind, timezone,
    starts_at, ends_at, location, visibility, team_size_min, team_size_max)
  values (p_org, 'demo-hackathon', 'Demo Hackathon', 'Demo', 'hackathon',
    'America/New_York', v_now - interval '2 hours', v_now + interval '22 hours', 'Main Hall',
    'public', 1, 4)
  returning id into v_hack;

  insert into public.divisions (event_id, name, sort) values (v_hack, 'Middle school', 0) returning id into v_ms;
  insert into public.divisions (event_id, name, sort) values (v_hack, 'High school', 1) returning id into v_hs;
  insert into public.tracks (event_id, name, description_md, sort) values
    (v_hack, 'Best use of AI', 'Projects where a model does real work.', 0),
    (v_hack, 'Social good', 'Something that helps your community.', 1),
    (v_hack, 'Best design', 'Polish, clarity, delight.', 2);

  insert into public.event_windows (event_id, key, opens_at, closes_at) values
    (v_hack, 'registration', v_now - interval '14 days', v_now),
    (v_hack, 'teams', v_now - interval '2 hours', v_now + interval '12 hours'),
    (v_hack, 'instructions', v_now - interval '2 hours', null),
    (v_hack, 'sessions', v_now - interval '7 days', ((v_day + time '12:50') at time zone 'America/New_York')),
    (v_hack, 'submissions', v_now - interval '2 hours', v_now + interval '22 hours'),
    (v_hack, 'judging', v_now + interval '22 hours', v_now + interval '26 hours'),
    (v_hack, 'results', v_now + interval '26 hours', null),
    (v_hack, 'gallery', v_now + interval '26 hours', null);

  insert into public.event_pages (event_id, slug, title, body_md, window_key, audience, sort) values
    (v_hack, 'rules', 'Rules', E'- Teams of up to four.\n- All code written during the event.\n- Be kind.', null, 'public', 0),
    (v_hack, 'resources', 'Resources', E'- Wi-Fi: `demo-guest`\n- Mentors are in room 104.', null, 'members', 1),
    (v_hack, 'instructions', 'The brief', E'Build something that makes **waiting** less painful.', 'instructions', 'members', 2);

  insert into public.criteria (event_id, label, description_md, max_score, weight, sort) values
    (v_hack, 'Impact', 'Does it matter to someone?', 10, 1.5, 0),
    (v_hack, 'Execution', 'Does it work?', 10, 1, 1),
    (v_hack, 'Design', 'Is it pleasant and clear?', 10, 1, 2),
    (v_hack, 'Presentation', 'Did the demo land?', 10, 0.5, 3);

  perform private.add_default_submission_form(v_hack);
  insert into public.submission_items (event_id, form_id, key, label, help, kind, required, sort)
  select v_hack, f.id, 'built_with', 'Built with', 'Languages, frameworks, APIs.', 'text', false, 5
  from public.submission_forms f where f.event_id = v_hack and f.key = 'project';

  insert into public.onboarding_forms (event_id, fields) values (v_hack,
    '[{"key":"school","label":"School","kind":"text","required":true},
      {"key":"shirt","label":"T-shirt size","kind":"select","required":false,"options":["S","M","L","XL"]}]');

  perform private.seed_demo_agenda(v_hack, v_day);

  insert into public.announcements (event_id, title, body_md, severity) values
    (v_hack, 'Welcome!', 'Opening ceremony starts in the Main Hall. Grab a seat.', 'info');

  insert into public.settings (scope, event_id, namespace, value) values
    ('event', v_hack, 'registration', '{"mode":"open"}'),
    ('event', v_hack, 'submissions', '{"autoSubmit":true}'),
    ('event', v_hack, 'about', jsonb_build_object('body',
      'A 24-hour build sprint. Form a team of up to four, pick a track, and ship something.')),
    ('event', v_hack, 'privacy', '{"about":"public"}');

  perform private.audit_org(p_org, 'org.demo_seeded', 'org', p_org, '{}');
end;
$$;

-- events that only had a public About keep showing it to everyone
insert into public.settings (scope, event_id, namespace, value)
select 'event', e.id, 'privacy', '{"about":"public"}'::jsonb
from public.events e
where e.description_md <> ''
  and not exists (
    select 1 from public.settings b
    where b.scope = 'event' and b.event_id = e.id and b.namespace = 'briefing'
      and coalesce(b.value ->> 'body', '') <> '')
on conflict (scope, org_id, event_id, namespace)
  do update set value = public.settings.value || '{"about":"public"}'::jsonb;

update public.settings set namespace = 'about' where scope = 'event' and namespace = 'briefing';

insert into public.settings (scope, event_id, namespace, value)
select 'event', e.id, 'about', jsonb_build_object('body', e.description_md)
from public.events e
where e.description_md <> ''
on conflict (scope, org_id, event_id, namespace) do update
  set value = public.settings.value || jsonb_build_object('body',
    left(excluded.value ->> 'body'
      || coalesce(E'\n\n' || nullif(public.settings.value ->> 'body', ''), ''), 20000));

-- the For participants home block becomes About, or goes when the page already has one
do $$
declare
  r record;
  v_layout jsonb;
  v_side text;
  v_out jsonb;
  v_has_about boolean;
begin
  for r in select id, value -> 'layout' as layout from public.settings
    where namespace = 'home' and jsonb_typeof(value -> 'layout') = 'object'
  loop
    v_layout := r.layout;
    v_has_about := exists (
      select 1 from jsonb_array_elements(
        case when jsonb_typeof(v_layout -> 'main') = 'array' then v_layout -> 'main' else '[]' end
        || case when jsonb_typeof(v_layout -> 'aside') = 'array' then v_layout -> 'aside' else '[]' end) b
      where b ->> 'type' = 'about');
    foreach v_side in array array['main', 'aside'] loop
      if jsonb_typeof(v_layout -> v_side) = 'array' then
        select coalesce(jsonb_agg(
            case when b ->> 'type' = 'briefing' then '{"id":"about","type":"about"}'::jsonb else b end
            order by n), '[]')
        into v_out
        from jsonb_array_elements(v_layout -> v_side) with ordinality t(b, n)
        where b ->> 'type' is distinct from 'briefing'
          or (not v_has_about and n = (
            select min(m) from jsonb_array_elements(v_layout -> v_side) with ordinality u(c, m)
            where c ->> 'type' = 'briefing'));
        v_has_about := v_has_about or exists (
          select 1 from jsonb_array_elements(v_out) b where b ->> 'type' = 'about');
        v_layout := jsonb_set(v_layout, array[v_side], v_out);
      end if;
    end loop;
    if v_layout is distinct from r.layout then
      update public.settings set value = jsonb_set(value, '{layout}', v_layout) where id = r.id;
    end if;
  end loop;
end;
$$;

alter table public.events drop column description_md;
