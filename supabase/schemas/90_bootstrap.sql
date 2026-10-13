create function public.bogey_create_org(p_org_slug text, p_org_name text, p_hostname text, p_owner uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  insert into public.orgs (slug, name) values (p_org_slug, p_org_name)
  on conflict (slug) do update set name = excluded.name
  returning id into v_org;

  if p_hostname is not null then
    insert into public.org_domains (hostname, org_id, is_primary, verified_at)
    values (lower(p_hostname), v_org, not exists (select 1 from public.org_domains where org_id = v_org and is_primary), now())
    on conflict (hostname) do update set org_id = excluded.org_id;
  end if;

  if p_owner is not null then
    insert into public.org_members (org_id, user_id, role) values (v_org, p_owner, 'owner')
    on conflict (org_id, user_id) do update set role = 'owner';
  end if;

  perform private.audit_org(v_org, 'org.created', 'org', v_org, jsonb_build_object('hostname', p_hostname));
  return v_org;
end;
$$;

create function public.bogey_bootstrap(
  p_org_slug text, p_org_name text, p_hostname text, p_owner uuid, p_default boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.bogey_create_org(p_org_slug, p_org_name, p_hostname, p_owner);
begin
  if p_default then
    insert into public.settings (scope, namespace, value) values ('instance', 'tenancy', jsonb_build_object('defaultOrg', v_org))
    on conflict (scope, org_id, event_id, namespace) do update
      set value = public.settings.value || excluded.value;
  end if;

  if p_owner is not null then
    insert into public.platform_admins (user_id) values (p_owner) on conflict do nothing;
  end if;

  perform private.audit_org(v_org, 'org.bootstrapped', 'org', v_org, jsonb_build_object('hostname', p_hostname));
  return v_org;
end;
$$;

create function private.seed_demo_agenda(p_event uuid, p_day date)
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
        jsonb_build_object('kind', 'check-in', 'name', 'Student Check-in', 'location', 'Lobby',
          'required', true, 'takes_attendance', true))),
      private.demo_slot(p_day, v_zone, null, 'everyone', '09:30', '09:55', jsonb_build_array(
        jsonb_build_object('kind', 'ceremony', 'name', 'Opening', 'location', 'Main Hall', 'required', true),
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
        jsonb_build_object('kind', 'meal', 'name', 'Lunch', 'location', 'Cafeteria', 'required', true))),
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
        jsonb_build_object('kind', 'deadline', 'name', 'Submission Window',
          'description_md', 'Last call: submit your project.', 'required', true))),
      private.demo_slot(p_day, v_zone, 'Round 4', 'choose', '15:00', '15:55', jsonb_build_array(
        private.demo_workshop('Cybersecurity and Web Vulnerabilities', null, 'Room 101', 30,
          v_hosts, array['5', '7'], 'Testing5 Person and Testing7 Person'),
        private.demo_workshop('Serverless Computing', null, 'Room 102', 30,
          v_hosts, array['6'], 'Testing6 Person'),
        jsonb_build_object('kind', 'judging', 'name', 'Judging', 'location', 'Main Hall',
          'description_md', 'Judges visit each team. Sponsor workshops run alongside.',
          'visibility', 'staff'))),
      private.demo_slot(p_day, v_zone, null, 'everyone', '16:00', '16:30', jsonb_build_array(
        jsonb_build_object('kind', 'ceremony', 'name', 'Award Ceremony', 'location', 'Main Hall',
          'required', true)))
    )
  );

  perform private.write_agenda(p_event, v_agenda);
end;
$$;

create function private.demo_time(p_day date, p_zone text, p_time text)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select (p_day + p_time::time) at time zone p_zone;
$$;

create function private.demo_slot(p_day date, p_zone text, p_name text, p_kind text,
  p_starts text, p_ends text, p_sessions jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('name', p_name, 'kind', p_kind,
    'starts_at', private.demo_time(p_day, p_zone, p_starts),
    'ends_at', case when p_ends is null then null else private.demo_time(p_day, p_zone, p_ends) end,
    'sessions', p_sessions);
$$;

create function private.demo_workshop(p_name text, p_category text, p_location text, p_capacity integer,
  p_hosts jsonb, p_host_numbers text[], p_host_names text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('kind', 'workshop', 'name', p_name, 'category', p_category,
    'location', p_location, 'capacity', p_capacity, 'takes_attendance', true,
    'hosts', coalesce((select jsonb_agg(p_hosts -> n) from unnest(p_host_numbers) n where p_hosts ? n), '[]'),
    'host_note', case when exists (select 1 from unnest(p_host_numbers) n where not p_hosts ? n)
      then p_host_names end);
$$;

create function public.bogey_seed_demo(p_org uuid)
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

  insert into public.events (org_id, slug, name, short_name, kind, description_md, timezone,
    starts_at, ends_at, location, visibility, team_size_min, team_size_max)
  values (p_org, 'demo-hackathon', 'Demo Hackathon', 'Demo', 'hackathon',
    'A 24-hour build sprint. Form a team of up to four, pick a track, and ship something.',
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
    ('event', v_hack, 'submissions', '{"autoSubmit":true}');

  perform private.audit_org(p_org, 'org.demo_seeded', 'org', p_org, '{}');
end;
$$;

revoke execute on function
  public.bogey_create_org(text, text, text, uuid),
  public.bogey_bootstrap(text, text, text, uuid, boolean),
  public.bogey_seed_demo(uuid)
from authenticated;
grant execute on function
  public.bogey_create_org(text, text, text, uuid),
  public.bogey_bootstrap(text, text, text, uuid, boolean),
  public.bogey_seed_demo(uuid)
to service_role;
