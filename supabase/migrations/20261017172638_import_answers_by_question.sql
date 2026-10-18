-- import_answers_by_question: an imported column named like a registration question is filed
-- under that question's key; the demo hackathon asks for grade, school and why they joined, none required

create or replace function public.import_roster(p_event uuid, p_rows jsonb, p_notify boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_email extensions.citext;
  v_existing public.registrations;
  v_user uuid;
  v_added integer := 0;
  v_updated integer := 0;
  v_linked integer := 0;
  v_asked integer := 0;
  v_options text[];
  v_division uuid;
  v_sessions uuid[];
  v_answers jsonb;
  v_fields jsonb := coalesce((select f.fields from public.onboarding_forms f where f.event_id = p_event), '[]');
begin
  if not private.can_manage(p_event) then
    raise exception 'only organizers can import people' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then
    raise exception 'import at most 2000 rows at a time' using errcode = '22023';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_email := lower(trim(v_row ->> 'email'))::extensions.citext;
    select * into v_existing from public.registrations where event_id = p_event and email = v_email;

    v_options := array(
      select distinct left(trim(o), 60) from jsonb_array_elements_text(
        case when jsonb_typeof(v_row -> 'teamOptions') = 'array' then v_row -> 'teamOptions' else '[]' end
      ) o
      where trim(o) <> ''
      limit 10
    );
    v_division := (
      select d.id from public.divisions d
      where d.event_id = p_event and d.id::text = v_row ->> 'division'
    );
    v_sessions := array(
      select s.id from public.event_sessions s
      where s.event_id = p_event
        and s.id::text in (select jsonb_array_elements_text(
          case when jsonb_typeof(v_row -> 'sessions') = 'array' then v_row -> 'sessions' else '[]' end
        ))
      limit 50
    );
    v_answers := case when jsonb_typeof(v_row -> 'answers') = 'object' then v_row -> 'answers' else '{}' end;
    if length(v_answers::text) > 20000 then
      raise exception 'answers for % are too long', v_email using errcode = '22023';
    end if;
    -- a column named like a registration question ("School", "Why did you join") is filed under
    -- that question's key, so it lines up with what people answer themselves or at the kiosk
    v_answers := (
      select coalesce(jsonb_object_agg(coalesce(q.key, a.key), a.value), '{}')
      from jsonb_each(v_answers) a
      left join lateral (
        select field ->> 'key' as key from jsonb_array_elements(v_fields) field
        where regexp_replace(lower(a.key), '[^a-z0-9]+', '', 'g') in (
          regexp_replace(lower(field ->> 'key'), '[^a-z0-9]+', '', 'g'),
          regexp_replace(lower(field ->> 'label'), '[^a-z0-9]+', '', 'g'))
        limit 1
      ) q on true
    );
    insert into public.registrations (
      event_id, email, full_name, source, role, team_hint, team_options, division_id,
      session_picks, answers, status
    )
    values (
      p_event, v_email, nullif(trim(v_row ->> 'name'), ''), 'import',
      coalesce(nullif(v_row ->> 'role', ''), 'participant')::public.event_role,
      case when cardinality(v_options) = 0 then nullif(trim(v_row ->> 'team'), '') end,
      v_options, v_division, v_sessions, v_answers, 'approved'
    )
    on conflict (event_id, email) do update set
      full_name = coalesce(excluded.full_name, public.registrations.full_name),
      role = excluded.role,
      team_hint = coalesce(excluded.team_hint, public.registrations.team_hint),
      team_options = case
        when cardinality(excluded.team_options) > 0 then excluded.team_options
        when excluded.team_hint is not null then '{}'
        else public.registrations.team_options end,
      division_id = coalesce(excluded.division_id, public.registrations.division_id),
      session_picks = case when cardinality(excluded.session_picks) > 0
        then excluded.session_picks else public.registrations.session_picks end,
      answers = public.registrations.answers || excluded.answers,
      status = 'approved'
    returning user_id into v_user;
    if cardinality(v_options) > 0 then v_asked := v_asked + 1; end if;

    if v_existing.id is null then v_added := v_added + 1; else v_updated := v_updated + 1; end if;
    if p_notify and v_existing.id is null then
      if v_user is not null then
        perform private.notify(array[v_user], p_event, 'registration.approved', 'You''re in', null,
          '/events/' || (select slug from public.events where id = p_event), '{}');
      else
        perform private.enqueue_email(private.event_org(p_event), p_event, null, v_email::text, 'event.invite',
          jsonb_build_object('event', (select name from public.events where id = p_event),
            'path', '/events/' || (select slug from public.events where id = p_event)));
      end if;
    end if;
    if v_user is not null then v_linked := v_linked + 1; end if;
  end loop;

  perform private.audit(p_event, 'registration.imported', 'event', p_event,
    jsonb_build_object('added', v_added, 'updated', v_updated, 'asked', v_asked));
  return jsonb_build_object('added', v_added, 'updated', v_updated, 'linked', v_linked, 'asked', v_asked);
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
    '[{"key":"grade","label":"Grade","kind":"text","required":false},
      {"key":"school","label":"School","kind":"text","required":false},
      {"key":"why","label":"Why did you join?","kind":"longtext","required":false}]');

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
