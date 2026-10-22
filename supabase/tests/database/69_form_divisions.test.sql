begin;
select plan(12);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max) values
  (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public', 1, 4);
insert into public.event_windows (event_id, key, override) values
  (tests.u('ev'), 'teams', 'open'), (tests.u('ev'), 'submissions', 'open');
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['cap','mate','boss']) n;
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('cap'), 'participant'),
  (tests.u('ev'), tests.u('mate'), 'participant'),
  (tests.u('ev'), tests.u('boss'), 'organizer');
insert into public.divisions (id, event_id, name, sort, selectable, switchable) values
  (tests.u('jr'), tests.u('ev'), 'Juniors', 0, true, true),
  (tests.u('sr'), tests.u('ev'), 'Seniors', 1, true, true),
  (tests.u('stay'), tests.u('ev'), 'Stay', 2, true, false),
  (tests.u('placed'), tests.u('ev'), 'Placed', 3, false, true);
insert into public.submission_forms (id, event_id, key, title) values
  (tests.u('all'), tests.u('ev'), 'project', 'Project'),
  (tests.u('jform'), tests.u('ev'), 'juniors', 'Juniors pitch');

select tests.as_user(tests.u('boss'));
select lives_ok(format($$select public.save_submission_form(tests.u('ev'),
  jsonb_build_object('id', %L, 'key', 'juniors', 'title', 'Juniors pitch', 'division_ids', jsonb_build_array(%L)),
  '[]')$$, tests.u('jform'), tests.u('jr')), 'organizers aim a form at a division');
reset role;
select is((select count(*)::int from public.submission_form_divisions where form_id = tests.u('jform')), 1,
  'and the form remembers it');

select tests.as_user(tests.u('cap'));
select public.choose_division(tests.u('ev'), tests.u('sr'));
select public.create_team(tests.u('ev'), 'Rockets');
reset role;
select tests.as_user(tests.u('mate'));
select public.join_team((select invite_code from public.teams where name = 'Rockets' and event_id = tests.u('ev')));
reset role;

select tests.as_user(tests.u('cap'));
select throws_ok($$insert into public.submissions (event_id, form_id, team_id, title)
  select tests.u('ev'), tests.u('jform'), id, 'Nope' from public.teams where name = 'Rockets'$$, '42501', null,
  'a team in another division can''t start it');
select lives_ok($$insert into public.submissions (event_id, form_id, team_id, title)
  select tests.u('ev'), tests.u('all'), id, 'Moonshot' from public.teams where name = 'Rockets'$$,
  'a form for everyone still works');
select lives_ok($$select public.choose_team_division(tests.u('ev'), tests.u('jr'))$$,
  'a teammate moves the whole team to another division');
reset role;
select is((select division_id from public.teams where name = 'Rockets' and event_id = tests.u('ev')),
  tests.u('jr'), 'the team moved');
select is((select division_id from public.event_members where user_id = tests.u('mate') and event_id = tests.u('ev')),
  tests.u('jr'), 'and so did its members');

select tests.as_user(tests.u('cap'));
select lives_ok($$insert into public.submissions (event_id, form_id, team_id, title)
  select tests.u('ev'), tests.u('jform'), id, 'Pitch' from public.teams where name = 'Rockets'$$,
  'now the team can start the juniors form');
select throws_ok($$select public.choose_team_division(tests.u('ev'), tests.u('placed'))$$, '42501', null,
  'teams can''t pick a division only organizers place people in');
reset role;

update public.teams set division_id = tests.u('sr') where name = 'Rockets' and event_id = tests.u('ev');
select tests.as_user(tests.u('cap'));
select throws_ok($$select public.submit_project(id) from public.submissions where form_id = tests.u('jform')$$,
  '42501', null, 'a team moved out of the form''s divisions can''t submit it');
reset role;

update public.teams set division_id = tests.u('stay') where name = 'Rockets' and event_id = tests.u('ev');
select tests.as_user(tests.u('cap'));
select throws_ok($$select public.choose_team_division(tests.u('ev'), tests.u('jr'))$$, '42501', null,
  'a team in a division that can''t be left stays');
reset role;

select tests.as_user(tests.u('boss'));
select public.save_submission_form(tests.u('ev'),
  jsonb_build_object('id', tests.u('jform'), 'key', 'juniors', 'title', 'Juniors pitch', 'division_ids', '[]'::jsonb),
  '[]');
reset role;
select is((select count(*)::int from public.submission_form_divisions where form_id = tests.u('jform')), 0,
  'clearing the divisions opens the form to everyone');

select * from finish();
rollback;
