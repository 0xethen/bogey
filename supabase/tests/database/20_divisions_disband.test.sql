begin;
select plan(11);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max) values
  (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public', 1, 4);
insert into public.event_windows (event_id, key, override) values (tests.u('ev'), 'teams', 'open');
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['cap','mate','boss']) n;
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('cap'), 'participant'),
  (tests.u('ev'), tests.u('mate'), 'participant'),
  (tests.u('ev'), tests.u('boss'), 'organizer');
insert into public.divisions (id, event_id, name, sort, selectable, switchable) values
  (tests.u('open'), tests.u('ev'), 'Open', 0, true, true),
  (tests.u('stay'), tests.u('ev'), 'Stay', 1, true, false),
  (tests.u('placed'), tests.u('ev'), 'Placed', 2, false, false);

select tests.as_user(tests.u('cap'));
select lives_ok($$select public.choose_division(tests.u('ev'), tests.u('open'))$$,
  'a participant picks a division they may pick');
select throws_ok($$select public.choose_division(tests.u('ev'), tests.u('placed'))$$, '42501', null,
  'but not one only organizers place people in');
select public.create_team(tests.u('ev'), 'Rockets');
select lives_ok($$select public.choose_division(tests.u('ev'), tests.u('stay'))$$,
  'alone on their team, they can switch');
reset role;
select is((select division_id from public.teams where name = 'Rockets' and event_id = tests.u('ev')),
  tests.u('stay'), 'and the team of just them moves along');

select tests.as_user(tests.u('cap'));
select throws_ok($$select public.choose_division(tests.u('ev'), tests.u('open'))$$, '42501', null,
  'a division that can''t be switched out of keeps them');
reset role;

select tests.as_user(tests.u('mate'));
select throws_ok($$select public.set_division(tests.u('ev'), tests.u('cap'), tests.u('open'))$$,
  '42501', null, 'participants can''t place others');
reset role;
select tests.as_user(tests.u('boss'));
select lives_ok($$select public.set_division(tests.u('ev'), tests.u('cap'), tests.u('placed'))$$,
  'organizers place anyone anywhere');
reset role;
select is((select division_id from public.event_members where user_id = tests.u('cap') and event_id = tests.u('ev')),
  tests.u('placed'), 'and it sticks');

update public.event_members set division_id = tests.u('placed') where user_id = tests.u('mate') and event_id = tests.u('ev');
select tests.as_user(tests.u('mate'));
select public.join_team((select invite_code from public.teams where name = 'Rockets' and event_id = tests.u('ev')));
select throws_ok($$select public.disband_team(tests.u('ev'))$$, '42501', null,
  'a teammate who isn''t captain can''t disband by default');
reset role;
select tests.as_user(tests.u('cap'));
select lives_ok($$select public.disband_team(tests.u('ev'))$$, 'the captain can');
reset role;
select is_empty($$select 1 from public.teams where name = 'Rockets' and event_id = tests.u('ev')$$,
  'and the team is gone');

select * from finish();
rollback;
