begin;
select plan(15);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max) values
  (tests.u('ev'), tests.u('org'), 'hack', 'Hack', 'public', 1, 3),
  (tests.u('old'), tests.u('org'), 'old', 'Old Hack', 'public', 1, 3);
select tests.create_user(tests.u(n), n || '@t.test', '{"org":"alpha"}') from unnest(array['o1','a','p9']) n;
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('o1'), 'organizer'), (tests.u('ev'), tests.u('p9'), 'participant');
insert into public.registrations (event_id, email, full_name, source, status) values
  (tests.u('old'), 'a@t.test', 'Ada L.', 'import', 'approved');

select tests.as_user(tests.u('o1'));
select is(public.import_roster(tests.u('ev'), '[{"email":"A@t.test","name":"Ada Lovelace","team":"Rockets"},{"email":"new@t.test","team":"rockets"},{"email":"judge@t.test","role":"judge"}]'),
  '{"added":3,"updated":0,"linked":1,"asked":0}'::jsonb, 'import reports added and linked people');
select is(public.import_roster(tests.u('ev'), '[{"email":"a@t.test"}]') ->> 'updated', '1', 'importing again updates instead of duplicating');
reset role;
insert into public.onboarding_forms (event_id, fields) values (tests.u('ev'),
  '[{"key":"why","label":"Why did you join?","kind":"longtext"}]');
select tests.as_user(tests.u('o1'));
select public.import_roster(tests.u('ev'), '[{"email":"a@t.test","answers":{"Why did you join":"Fun","Shirt":"M"}}]');
reset role;
select is((select answers from public.registrations where event_id = tests.u('ev') and email = 'a@t.test'),
  '{"why":"Fun","Shirt":"M"}'::jsonb, 'a column named like a question is filed under its key');
select is((select role::text from public.event_members where event_id = tests.u('ev') and user_id = tests.u('a')), 'participant', 'an existing account becomes a member');
select is((select t.name from public.team_members tm join public.teams t on t.id = tm.team_id where tm.user_id = tests.u('a') and tm.event_id = tests.u('ev')), 'Rockets', 'and joins the team from the import');
select is((select role::text from public.team_members where user_id = tests.u('a') and event_id = tests.u('ev')), 'captain', 'the first member captains');

select tests.create_user(tests.u('new'), 'new@t.test', '{"org":"alpha"}');
select is((select t.name from public.team_members tm join public.teams t on t.id = tm.team_id where tm.user_id = tests.u('new')), 'Rockets', 'a new account joins its imported team on sign-up');

select tests.as_user(tests.u('o1'));
select lives_ok($$select public.set_team_membership(tests.u('ev'), tests.u('new'), null)$$, 'organizer takes someone off a team');
select is_empty($$select 1 from public.team_members where user_id = tests.u('new')$$, 'they are on no team');
select lives_ok(format('select public.set_team_membership(%L, %L, %L)', tests.u('ev'), tests.u('new'),
  (select id from public.teams where name = 'Rockets')), 'and puts them back');
reset role;
select is((select count(*)::int from public.audit_log where action = 'team.member_moved' and event_id = tests.u('ev')), 2, 'each move is audited');

select tests.as_user(tests.u('p9'));
select throws_ok($$select public.set_team_membership(tests.u('ev'), tests.u('p9'), null)$$, '42501', null, 'participants cannot move people');
select throws_ok($$select public.import_roster(tests.u('ev'), '[]')$$, '42501', null, 'participants cannot import');
select is_empty($$select * from public.roster_overlaps(tests.u('ev'))$$, 'participants see no overlaps');
reset role;

select tests.as_user(tests.u('o1'));
select results_eq($$select other_event_name, name_differs from public.roster_overlaps(tests.u('ev'))$$,
  $$values ('Old Hack'::text, true)$$, 'organizers see where a person also registered and that the names differ');
reset role;

select * from finish();
rollback;
