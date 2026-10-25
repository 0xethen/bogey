begin;
select plan(5);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max) values
  (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public', 1, 4);
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['cap','mate','boss']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('boss'), 'owner');
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('cap'), 'participant'),
  (tests.u('ev'), tests.u('mate'), 'participant');
insert into public.divisions (id, event_id, name, sort) values
  (tests.u('jr'), tests.u('ev'), 'Juniors', 0),
  (tests.u('sr'), tests.u('ev'), 'Seniors', 1);
insert into public.teams (id, event_id, name) values (tests.u('rockets'), tests.u('ev'), 'Rockets');
insert into public.team_members (event_id, team_id, user_id) values
  (tests.u('ev'), tests.u('rockets'), tests.u('cap')), (tests.u('ev'), tests.u('rockets'), tests.u('mate'));

select tests.as_user(tests.u('cap'));
select lives_ok($$select public.choose_team_division(tests.u('ev'), tests.u('jr'))$$, 'a participant chooses the team''s division');
reset role;
select is((select division_chosen_by from public.teams where id = tests.u('rockets')), tests.u('cap'), 'and the choice is theirs');

select tests.as_user(tests.u('mate'));
select throws_ok($$select public.choose_team_division(tests.u('ev'), tests.u('sr'))$$, '42501', null,
  'a teammate can''t switch it');
reset role;

select tests.as_user(tests.u('cap'));
select lives_ok($$select public.choose_team_division(tests.u('ev'), tests.u('sr'))$$, 'the chooser still can');
reset role;

delete from public.team_members where team_id = tests.u('rockets') and user_id = tests.u('cap');
select tests.as_user(tests.u('mate'));
select lives_ok($$select public.choose_team_division(tests.u('ev'), tests.u('jr'))$$, 'once the chooser leaves, a teammate can');
reset role;

select * from finish();
rollback;
