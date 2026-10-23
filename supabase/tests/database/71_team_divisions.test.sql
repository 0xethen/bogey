begin;
select plan(11);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max) values
  (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public', 1, 4);
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['cap','mate','boss']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('boss'), 'owner');
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('cap'), 'participant'),
  (tests.u('ev'), tests.u('mate'), 'participant'),
  (tests.u('ev'), tests.u('boss'), 'organizer');
insert into public.divisions (id, event_id, name, sort) values
  (tests.u('jr'), tests.u('ev'), 'Juniors', 0),
  (tests.u('sr'), tests.u('ev'), 'Seniors', 1);
update public.event_members set division_id = tests.u('sr') where user_id = tests.u('cap');
insert into public.teams (id, event_id, name) values (tests.u('rockets'), tests.u('ev'), 'Rockets');

select tests.as_user(tests.u('boss'));
select public.set_team_membership(tests.u('ev'), tests.u('cap'), tests.u('rockets'));
reset role;
select is((select division_id from public.teams where id = tests.u('rockets')), tests.u('sr'),
  'a team without a division takes its first member''s');

update public.event_members set division_id = tests.u('jr') where user_id = tests.u('mate');
select tests.as_user(tests.u('boss'));
select public.set_team_membership(tests.u('ev'), tests.u('mate'), tests.u('rockets'));
reset role;
select is((select division_id from public.event_members where event_id = tests.u('ev') and user_id = tests.u('mate')),
  tests.u('sr'), 'someone an organizer moves onto a team takes the team''s division');

select tests.as_user(tests.u('cap'));
select throws_ok($$select public.set_teams_division(tests.u('ev'), array[tests.u('rockets')], tests.u('jr'))$$,
  '42501', null, 'participants can''t place teams');
reset role;

select tests.as_user(tests.u('boss'));
select is(public.set_teams_division(tests.u('ev'), array[tests.u('rockets')], tests.u('jr')), 1,
  'organizers place a team in a division');
reset role;
select is((select count(*)::int from public.event_members
  where event_id = tests.u('ev') and user_id in (tests.u('cap'), tests.u('mate')) and division_id = tests.u('jr')), 2,
  'and its members follow');
select is((select count(*)::int from public.audit_log where action = 'division.assigned' and event_id = tests.u('ev')), 1,
  'and it''s audited');

update public.event_members set division_id = tests.u('sr') where user_id = tests.u('cap');
select is((select division_id from public.event_members where event_id = tests.u('ev') and user_id = tests.u('cap')),
  tests.u('jr'), 'a member on a team keeps the team''s division');

select tests.as_user(tests.u('boss'));
select throws_ok($$select public.set_division(tests.u('ev'), tests.u('cap'), tests.u('sr'))$$, '23514', null,
  'moving one teammate alone asks to move the team');
select public.set_team_membership(tests.u('ev'), tests.u('cap'), null);
select public.set_division(tests.u('ev'), tests.u('cap'), tests.u('sr'));
reset role;
select is((select division_id from public.event_members where event_id = tests.u('ev') and user_id = tests.u('cap')),
  tests.u('sr'), 'someone without a team keeps their own division');
select is((select division_id from public.teams where id = tests.u('rockets')), tests.u('jr'),
  'and their old team keeps its division');

insert into public.submission_forms (id, event_id, key, title) values (tests.u('form'), tests.u('ev'), 'pitch', 'Pitch');
insert into public.submission_form_divisions (event_id, form_id, division_id) values
  (tests.u('ev'), tests.u('form'), tests.u('jr'));
select tests.as_user(tests.u('boss'));
select public.clone_event(tests.u('ev'), 'copy', 'Copy');
reset role;
select is((select d.name from public.submission_form_divisions fd
  join public.divisions d on d.id = fd.division_id
  join public.events e on e.id = fd.event_id where e.slug = 'copy'), 'Juniors',
  'copying an event keeps which divisions each form is for');

select * from finish();
rollback;
