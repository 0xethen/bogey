begin;
select plan(20);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'rules', 'Rules');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max) values
  (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public', 1, 4);
insert into public.event_windows (event_id, key, override) values
  (tests.u('ev'), 'teams', 'open'), (tests.u('ev'), 'submissions', 'open');
insert into public.submission_forms (id, event_id, key, title) values (tests.u('form'), tests.u('ev'), 'project', 'Project');
select tests.create_user(tests.u(n), n || '@rules.test') from unnest(array['a', 'b', 'c', 'own']) n;
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('a'), 'participant'), (tests.u('ev'), tests.u('b'), 'participant'),
  (tests.u('ev'), tests.u('c'), 'participant');
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner');

-- the leave limit (2 by default) stops team after team
select tests.as_user(tests.u('a'));
select lives_ok($$select public.create_team(tests.u('ev'), 'One')$$, 'a participant starts a team');
select lives_ok($$select public.leave_team(tests.u('ev'))$$, 'leaves it');
select lives_ok($$select public.create_team(tests.u('ev'), 'Two')$$, 'starts another');
select lives_ok($$select public.leave_team(tests.u('ev'))$$, 'leaves that too');
select lives_ok($$select public.create_team(tests.u('ev'), 'Three')$$, 'starts a third');
select throws_ok($$select public.leave_team(tests.u('ev'))$$, 'P0001',
  'you''ve left a team as many times as this event allows; ask an organizer', 'but can''t leave a third time');
reset role;
select is((select teams_left::integer from public.event_members where event_id = tests.u('ev') and user_id = tests.u('a')), 2,
  'leaving is counted');
select is((select count(*)::integer from public.audit_log where event_id = tests.u('ev') and action = 'team.left'), 2,
  'and audited');

-- leaving tells the team; a captain can shut out an old code
select tests.as_user(tests.u('b'));
select lives_ok(format('select public.join_team(%L)', (select invite_code from public.teams where event_id = tests.u('ev') and name = 'Three')),
  'a teammate joins with the code');
select throws_ok($$select public.new_team_code(tests.u('ev'))$$, '42501', null, 'only the captain changes the code');
reset role;
select tests.as_user(tests.u('a'));
select isnt(public.new_team_code(tests.u('ev')), (select invite_code from public.teams where name = 'Three' and event_id = tests.u('ev') limit 1),
  'the captain gets a new code');
reset role;
update public.event_members set teams_left = 0 where event_id = tests.u('ev') and user_id = tests.u('b');
select tests.as_user(tests.u('b'));
select lives_ok($$select public.leave_team(tests.u('ev'))$$, 'the teammate leaves');
reset role;
select is((select count(*)::integer from public.notifications where user_id = tests.u('a') and kind = 'team.left'), 1,
  'and the captain hears about it');

-- a locked team or a submitted project keeps people where they are
update public.teams set locked_at = now() where event_id = tests.u('ev') and name = 'Three';
update public.event_members set teams_left = 0 where event_id = tests.u('ev') and user_id = tests.u('a');
select tests.as_user(tests.u('a'));
select throws_ok($$select public.leave_team(tests.u('ev'))$$, 'P0001', 'this team is locked; ask an organizer',
  'no leaving a locked team');
reset role;
update public.teams set locked_at = null where event_id = tests.u('ev') and name = 'Three';
insert into public.submissions (event_id, form_id, team_id, title, status, submitted_at)
select tests.u('ev'), tests.u('form'), id, 'Done', 'submitted', now() from public.teams where event_id = tests.u('ev') and name = 'Three';
select tests.as_user(tests.u('a'));
select throws_ok($$select public.leave_team(tests.u('ev'))$$, 'P0001',
  'your team has submitted a project; ask an organizer', 'no leaving after the team submitted');
select throws_ok($$select public.disband_team(tests.u('ev'))$$, 'P0001',
  'your team has submitted a project; ask an organizer', 'or disbanding it');
reset role;

-- switching off covers disbanding too
insert into public.settings (scope, event_id, namespace, value)
values ('event', tests.u('ev'), 'teams', '{"switching":false,"disband":"members","creation":"organizers"}');
delete from public.submissions where event_id = tests.u('ev');
select tests.as_user(tests.u('a'));
select throws_ok($$select public.disband_team(tests.u('ev'))$$, 'P0001',
  'switching teams is turned off; ask an organizer', 'disbanding can''t get around switching being off');
reset role;

-- organizers can keep starting teams to themselves
select tests.as_user(tests.u('c'));
select throws_ok($$select public.create_team(tests.u('ev'), 'Mine')$$, '42501', null, 'participants can''t start teams then');
reset role;
select tests.as_user(tests.u('own'));
select lives_ok($$insert into public.teams (event_id, name) values (tests.u('ev'), 'Set up')$$, 'organizers still can');
select lives_ok(format('select public.set_team_membership(%L, %L, %L)', tests.u('ev'), tests.u('a'),
  (select id from public.teams where event_id = tests.u('ev') and name = 'Set up')), 'and move anyone, whatever the limits');
reset role;

select * from finish();
rollback;
