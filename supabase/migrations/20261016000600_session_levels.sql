-- session levels are saved with their types; one-off demo sessions have no type

-- replaces a session type's levels (session_categories); sessions on a removed level keep no level
create function private.write_session_levels(p_event uuid, p_levels jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.session_categories c
  where c.event_id = p_event
    and not exists (
      select 1 from jsonb_array_elements(coalesce(p_levels, '[]')) as l
      where l ->> 'kind' = c.kind and l ->> 'label' = c.label
    );
  insert into public.session_categories (event_id, kind, label, sort)
  select p_event, l.value ->> 'kind', l.value ->> 'label', (l.ordinality - 1)::smallint
  from jsonb_array_elements(coalesce(p_levels, '[]')) with ordinality as l(value, ordinality)
  on conflict (event_id, kind, label) do update set sort = excluded.sort;
end;
$$;

create function public.save_session_levels(p_event uuid, p_levels jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can_manage(p_event) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_levels) <> 'array' or jsonb_array_length(p_levels) > 100 then
    raise exception 'levels must be a list of at most 100' using errcode = '22023';
  end if;
  perform private.write_session_levels(p_event, p_levels);
  perform private.audit(p_event, 'sessions.levels_saved', 'event', p_event,
    jsonb_build_object('levels', jsonb_array_length(p_levels)));
end;
$$;
grant execute on function public.save_session_levels(uuid, jsonb) to authenticated;

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
        location, starts_at, ends_at, host_note, capacity, required, takes_attendance, visibility, sort)
      values (v_session_id, p_event, v_slot_id,
        (select c.id from public.session_categories c
          where c.event_id = p_event and c.kind = coalesce(v_session ->> 'kind', 'session')
            and c.label = v_session ->> 'category'),
        coalesce(v_session ->> 'kind', 'session'), v_session ->> 'name',
        coalesce(v_session ->> 'description_md', ''), nullif(v_session ->> 'location', ''),
        (v_session ->> 'starts_at')::timestamptz, (v_session ->> 'ends_at')::timestamptz,
        nullif(v_session ->> 'host_note', ''), (v_session ->> 'capacity')::integer,
        coalesce((v_session ->> 'required')::boolean, false),
        coalesce((v_session ->> 'takes_attendance')::boolean, false),
        coalesce(v_session ->> 'visibility', 'everyone')::public.session_visibility,
        cardinality(v_keep_sessions)::smallint)
      on conflict (id) do update set
        slot_id = excluded.slot_id, category_id = excluded.category_id, kind = excluded.kind,
        name = excluded.name, description_md = excluded.description_md, location = excluded.location,
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

create or replace function private.seed_demo_agenda(p_event uuid, p_day date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_zone text := (select timezone from public.events where id = p_event);
  v_hosts jsonb := '{}';
  v_host record;
  v_agenda jsonb;
begin
  for v_host in
    select u.id, p.display_name, substring(u.email from 'bogeytesting(\d)') as n
    from auth.users u join public.profiles p on p.id = u.id
    where u.email ~ '^itsethent\+bogeytesting[1-7]@gmail\.com$'
  loop
    insert into public.event_members (event_id, user_id, role) values (p_event, v_host.id, 'staff')
    on conflict (event_id, user_id) do nothing;
    v_hosts := v_hosts || jsonb_build_object(v_host.n, v_host.id);
  end loop;

  v_agenda := jsonb_build_object(
    'categories', jsonb_build_array(
      jsonb_build_object('kind', 'workshop', 'label', 'Beginner'),
      jsonb_build_object('kind', 'workshop', 'label', 'Advanced')),
    'slots', jsonb_build_array(
      private.demo_slot(p_day, v_zone, null, 'everyone', '09:00', null, jsonb_build_array(
        jsonb_build_object('name', 'Student Check-in', 'location', 'Lobby',
          'required', true, 'takes_attendance', true))),
      private.demo_slot(p_day, v_zone, null, 'everyone', '09:30', '09:55', jsonb_build_array(
        jsonb_build_object('name', 'Opening', 'location', 'Main Hall', 'required', true),
        jsonb_build_object('kind', 'talk', 'name', 'Amazon Opening Speaker', 'location', 'Main Hall',
          'starts_at', private.demo_time(p_day, v_zone, '09:40'), 'host_note', 'Amazon'))),
      private.demo_slot(p_day, v_zone, 'Round 1', 'everyone', '10:00', '12:00', jsonb_build_array(
        jsonb_build_object('kind', 'workshop', 'name', 'Programming with AI',
          'description_md', 'Presented by Amazon.', 'location', 'Main Hall', 'host_note', 'Amazon',
          'takes_attendance', true))),
      private.demo_slot(p_day, v_zone, null, 'everyone', '12:10', '12:30', jsonb_build_array(
        jsonb_build_object('kind', 'talk', 'name', 'Dr. Nasser', 'location', 'Main Hall',
          'ends_at', private.demo_time(p_day, v_zone, '12:20')),
        jsonb_build_object('kind', 'talk', 'name', 'Speaker #3', 'location', 'Main Hall',
          'starts_at', private.demo_time(p_day, v_zone, '12:20')))),
      private.demo_slot(p_day, v_zone, null, 'everyone', '12:30', '12:50', jsonb_build_array(
        jsonb_build_object('name', 'Lunch', 'location', 'Cafeteria', 'required', true))),
      private.demo_slot(p_day, v_zone, 'Round 2', 'choose', '12:50', '13:35', jsonb_build_array(
        private.demo_workshop('Essential Sorting and Searching Algorithms', 'Beginner', 'Room 101', 30,
          v_hosts, array['1'], 'Testing1 Person'),
        private.demo_workshop('Fight Wildfires with AI', 'Advanced', 'Room 102', 30,
          v_hosts, array['2'], 'Testing2 Person'))),
      private.demo_slot(p_day, v_zone, 'Round 3', 'choose', '13:40', '14:25', jsonb_build_array(
        private.demo_workshop('Git and GitHub', 'Beginner', 'Room 101', 30,
          v_hosts, array['3', '4'], 'Testing3 Person and Testing4 Person'),
        private.demo_workshop('Full Stack Development', 'Advanced', 'Room 102', 30,
          v_hosts, array['5', '6'], 'Testing5 Person and Testing6 Person'))),
      private.demo_slot(p_day, v_zone, null, 'everyone', '14:45', '15:00', jsonb_build_array(
        jsonb_build_object('name', 'Submission Window',
          'description_md', 'Last call: submit your project.', 'required', true))),
      private.demo_slot(p_day, v_zone, 'Round 4', 'choose', '15:00', '15:55', jsonb_build_array(
        private.demo_workshop('Cybersecurity and Web Vulnerabilities', null, 'Room 101', 30,
          v_hosts, array['5', '7'], 'Testing5 Person and Testing7 Person'),
        private.demo_workshop('Serverless Computing', null, 'Room 102', 30,
          v_hosts, array['6'], 'Testing6 Person'),
        jsonb_build_object('name', 'Judging', 'location', 'Main Hall',
          'description_md', 'Judges visit each team. Sponsor workshops run alongside.',
          'visibility', 'staff'))),
      private.demo_slot(p_day, v_zone, null, 'everyone', '16:00', '16:30', jsonb_build_array(
        jsonb_build_object('name', 'Award Ceremony', 'location', 'Main Hall',
          'required', true)))
    )
  );

  perform private.write_agenda(p_event, v_agenda);
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
    ('event', v_hack, 'privacy', '{"about":"public"}'),
    ('event', v_hack, 'agenda', '{"kinds":[{"key":"talk","label":"Talk","tone":"blue","icon":"microphone"},{"key":"workshop","label":"Workshop","tone":"green","icon":"tools"}]}');

  perform private.audit_org(p_org, 'org.demo_seeded', 'org', p_org, '{}');
end;
$$;
