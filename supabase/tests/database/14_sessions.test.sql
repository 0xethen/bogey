begin;
select plan(25);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, visibility) values (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public');
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','p1','p2','p3','host','staff','out']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner');
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('p1'), 'participant'), (tests.u('ev'), tests.u('p2'), 'participant'),
  (tests.u('ev'), tests.u('p3'), 'participant'), (tests.u('ev'), tests.u('host'), 'participant'),
  (tests.u('ev'), tests.u('staff'), 'staff');

select tests.as_user(tests.u('p1'));
select throws_ok($$select public.save_agenda(tests.u('ev'), '{"slots":[]}')$$, '42501', null, 'participants can''t save the agenda');
reset role;
select tests.as_user(tests.u('own'));
select is(public.save_agenda(tests.u('ev'), jsonb_build_object(
  'categories', '[{"kind":"workshop","label":"Beginner"},{"kind":"workshop","label":"Advanced"}]'::jsonb,
  'slots', jsonb_build_array(
    jsonb_build_object('id', tests.u('lunch-slot'), 'kind', 'everyone', 'starts_at', now() - interval '10 minutes',
      'sessions', jsonb_build_array(jsonb_build_object('id', tests.u('lunch'), 'name', 'Lunch', 'kind', 'meal', 'required', true, 'takes_attendance', true))),
    jsonb_build_object('id', tests.u('r1'), 'name', 'Round 1', 'kind', 'choose', 'starts_at', now() - interval '5 minutes',
      'ends_at', now() + interval '1 hour',
      'sessions', jsonb_build_array(
        jsonb_build_object('id', tests.u('git'), 'name', 'Git', 'kind', 'workshop', 'category', 'Beginner', 'capacity', 1,
          'takes_attendance', true, 'hosts', jsonb_build_array(tests.u('host'))),
        jsonb_build_object('id', tests.u('ai'), 'name', 'AI', 'kind', 'workshop', 'category', 'Advanced', 'takes_attendance', true,
          'page_md', 'Slides: https://example.org/ai'),
        jsonb_build_object('id', tests.u('judging'), 'name', 'Judging', 'visibility', 'staff')))
  ))), 0, 'organizer saves the agenda');
select is((select count(*)::integer from public.event_sessions where event_id = tests.u('ev')), 4, 'four sessions saved');
select is((select c.label from public.event_sessions s join public.session_categories c on c.id = s.category_id where s.id = tests.u('git')), 'Beginner', 'categories match by kind and label');
select is((select count(*)::integer from public.audit_log where action = 'sessions.agenda_saved'), 1, 'saving is audited');
reset role;

select tests.as_user(tests.u('p1'));
select is((select count(*)::integer from public.event_sessions where event_id = tests.u('ev')), 3, 'participants don''t see staff sessions');
select is(jsonb_array_length(public.event_agenda(tests.u('ev')) -> 'slots' -> 1 -> 'sessions'), 2, 'nor does their agenda');
select is((select s ->> 'page_md' from jsonb_array_elements(public.event_agenda(tests.u('ev')) -> 'slots' -> 1 -> 'sessions') s
  where s ->> 'name' = 'AI'), 'Slides: https://example.org/ai', 'a session''s page comes with the agenda');
reset role;
select tests.as_user(tests.u('staff'));
select is((select count(*)::integer from public.event_sessions where event_id = tests.u('ev')), 4, 'staff see every session');
reset role;
insert into public.settings (scope, event_id, namespace, value)
values ('event', tests.u('ev'), 'privacy', '{"agenda":"public"}');
select tests.as_anon();
select is(jsonb_array_length(public.event_agenda(tests.u('ev')) -> 'slots'), 2, 'anyone sees a public event''s agenda when it''s shared');
reset role;

select tests.as_user(tests.u('p1'));
select throws_ok($$select public.choose_session(tests.u('git'))$$, '42501', null, 'closed window refuses picks');
reset role;
insert into public.event_windows (event_id, key, override) values (tests.u('ev'), 'sessions', 'open');
select tests.as_user(tests.u('p1'));
select throws_ok($$select public.choose_session(tests.u('lunch'))$$, '22023', null, 'nothing to pick in a for-everyone slot');
select lives_ok($$select public.choose_session(tests.u('git'))$$, 'p1 picks Git');
reset role;
select tests.as_user(tests.u('p2'));
select throws_ok($$select public.choose_session(tests.u('git'))$$, '23514', null, 'a full session refuses');
select throws_ok($$select public.choose_session(tests.u('judging'))$$, 'P0002', null, 'hidden sessions can''t be picked');
reset role;
select tests.as_user(tests.u('p1'));
select lives_ok($$select public.choose_session(tests.u('ai'))$$, 'changing a pick moves it');
select is((select session_id from public.session_signups where user_id = tests.u('p1')), tests.u('ai'), 'one pick per slot');
select throws_ok($$insert into public.session_signups (event_id, slot_id, session_id, user_id) values (tests.u('ev'), tests.u('r1'), tests.u('git'), tests.u('p1'))$$, '42501', null, 'no direct writes');
reset role;

select tests.as_user(tests.u('host'));
select lives_ok($$select public.set_attendance(tests.u('git'), tests.u('p3'), true)$$, 'hosts take attendance in their session');
select throws_ok($$select public.set_attendance(tests.u('ai'), tests.u('p3'), true)$$, '42501', null, 'but not in others');
select ok((select public.session_code(tests.u('git'))) ~ '^[A-Z2-9]{6}$', 'hosts read the check-in code');
reset role;
select set_config('tests.code', (select code from public.session_codes where session_id = tests.u('git')), true);
select tests.as_user(tests.u('p1'));
select throws_ok($$select public.session_code(tests.u('git'))$$, '42501', null, 'participants can''t read codes');
select throws_ok($$select public.check_in_session(tests.u('ev'), current_setting('tests.code'))$$,
  '22023', null, 'checking into another session than your pick refuses');
reset role;
select tests.as_user(tests.u('p2'));
select is(public.check_in_session(tests.u('ev'), lower(current_setting('tests.code'))), 'Git', 'walk-ins check in with the code, any case');
reset role;
select tests.as_user(tests.u('staff'));
select is((select count(*)::integer from public.event_attendance(tests.u('ev')) where session_id = tests.u('lunch') and expected), 4, 'lunch is expected of every participant');
reset role;

select * from finish();
rollback;
