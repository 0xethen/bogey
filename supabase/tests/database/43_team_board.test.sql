begin;
select plan(24);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha'), (tests.u('other'), 'beta', 'Beta');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max) values
  (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public', 1, 2),
  (tests.u('ev2'), tests.u('other'), 'ev2', 'Ev2', 'public', 1, 4);
insert into public.event_windows (event_id, key, override) values (tests.u('ev'), 'teams', 'open');
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','cap','amy','bob','cat','eve']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner');
insert into public.event_members (event_id, user_id, role)
select tests.u('ev'), tests.u(n), 'participant' from unnest(array['cap','amy','bob','cat']) n;
insert into public.event_members (event_id, user_id, role) values (tests.u('ev2'), tests.u('eve'), 'participant');
insert into public.teams (id, event_id, name) values (tests.u('t1'), tests.u('ev'), 'Owls');
insert into public.team_members (event_id, team_id, user_id, role) values (tests.u('ev'), tests.u('t1'), tests.u('cap'), 'captain');

select tests.as_user(tests.u('amy'));
select lives_ok($$select public.save_team_seeker(tests.u('ev'), array[' React ', 'react', 'ML'], array['games'], 'UTC', 'hi', true)$$, 'a participant saves a card');
reset role;
select tests.as_user(tests.u('bob'));
select lives_ok($$select public.save_team_seeker(tests.u('ev'), array['design'], array[]::text[], null, '', false)$$, 'another, not looking');
select is((select count(*)::integer from public.team_board_people(tests.u('ev')) where not mine), 1, 'others see only people who are looking');
select is((select count(*)::integer from public.team_board_people(tests.u('ev')) where mine), 1, 'and their own card whatever it says');
select is((select skills from public.team_board_people(tests.u('ev')) where not mine), array['react', 'ml'], 'labels are cleaned up');
select is((select count(*)::integer from public.team_seekers where event_id = tests.u('ev')), 1, 'cards are not readable directly');
reset role;

select tests.as_user(tests.u('eve'));
select throws_ok($$select public.save_team_seeker(tests.u('ev'), array[]::text[], array[]::text[], null, '', true)$$, '42501', null, 'only the event''s participants make cards');
reset role;

select tests.as_user(tests.u('cap'));
select lives_ok($$select public.save_team_opening(tests.u('ev'), 'we build maps', array['design'], true)$$, 'a team member posts');
reset role;
select tests.as_user(tests.u('amy'));
select is((select count(*)::integer from public.team_board_openings(tests.u('ev'))), 1, 'the post lists');
select lives_ok($$select public.request_to_join_team(tests.u('ev'), tests.u('t1'), 'can I join?')$$, 'a person asks to join');
select throws_ok($$select public.request_to_join_team(tests.u('ev'), tests.u('t1'), 'again')$$, '23505', null, 'only one pending request per team');
select throws_ok($$select public.answer_team_request((select id from public.team_requests limit 1), true)$$, '42501', null, 'the asker can''t answer their own request');
reset role;
select is((select count(*)::integer from public.notifications where user_id = tests.u('cap') and kind = 'team.request'), 1, 'the captain is told');
select tests.as_user(tests.u('cap'));
select is((select count(*)::integer from public.team_requests_inbox(tests.u('ev')) where decide), 1, 'the captain has one to decide');
select lives_ok($$select public.answer_team_request((select id from public.team_requests limit 1), true)$$, 'and accepts');
reset role;
select is((select team_id from public.team_members where user_id = tests.u('amy')), tests.u('t1'), 'amy is on the team');
select is((select status from public.team_requests limit 1), 'accepted', 'the request is settled');
select is((select count(*)::integer from public.audit_log where event_id = tests.u('ev') and action = 'team.request_accepted'), 1, 'and audited');

insert into public.settings (scope, event_id, namespace, value) values ('event', tests.u('ev'), 'teams', '{"board":false}');
select tests.as_user(tests.u('bob'));
select throws_ok($$select * from public.team_board_people(tests.u('ev'))$$, '42501', null, 'an event can turn the board off');
reset role;
delete from public.settings where scope = 'event' and event_id = tests.u('ev') and namespace = 'teams';

select tests.as_user(tests.u('own'));
select is(jsonb_array_length(public.team_matching_overview(tests.u('ev')) -> 'people'), 2, 'the overview lists people without a team');
select is(public.apply_team_matching(tests.u('ev'), format('[{"name":"Foxes","members":["%s","%s"]}]', tests.u('bob'), tests.u('cat'))::jsonb), 2, 'applying makes the team and moves people');
reset role;
select is((select count(distinct team_id)::integer from public.team_members where user_id in (tests.u('bob'), tests.u('cat'))), 1, 'both are on the same new team');

select tests.as_user(tests.u('eve'));
select throws_ok($$select * from public.team_board_openings(tests.u('ev'))$$, '42501', null, 'another org can''t read the board');
select throws_ok($$select public.team_matching_overview(tests.u('ev'))$$, '42501', null, 'or match its teams');
reset role;

select * from finish();
rollback;
