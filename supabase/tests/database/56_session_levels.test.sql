begin;
select plan(6);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, visibility) values (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public');
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','p1']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner');
insert into public.event_members (event_id, user_id, role) values (tests.u('ev'), tests.u('p1'), 'participant');

select tests.as_user(tests.u('p1'));
select throws_ok($$select public.save_session_levels(tests.u('ev'), '[]')$$, '42501', null, 'participants can''t save levels');
reset role;

select tests.as_user(tests.u('own'));
select lives_ok($$select public.save_session_levels(tests.u('ev'),
  '[{"kind":"workshop","label":"Beginner"},{"kind":"workshop","label":"Advanced"}]')$$, 'organizers save a type''s levels');
select public.save_agenda(tests.u('ev'), jsonb_build_object('slots', jsonb_build_array(
  jsonb_build_object('id', tests.u('slot'), 'kind', 'choose', 'starts_at', now(),
    'sessions', jsonb_build_array(jsonb_build_object('id', tests.u('git'), 'name', 'Git', 'kind', 'workshop', 'category', 'Beginner'))))));
select is((select count(*)::integer from public.session_categories where event_id = tests.u('ev')), 2, 'an agenda saved without levels keeps them');
select is((select c.label from public.event_sessions s join public.session_categories c on c.id = s.category_id where s.id = tests.u('git')), 'Beginner', 'and sessions pick one by label');
select public.save_session_levels(tests.u('ev'), '[{"kind":"workshop","label":"Advanced"}]');
select is((select category_id from public.event_sessions where id = tests.u('git')), null, 'removing a level leaves its sessions without one');
reset role;
select is((select count(*)::integer from public.audit_log where event_id = tests.u('ev') and action = 'sessions.levels_saved'), 2, 'saving levels is audited');

select * from finish();
rollback;
