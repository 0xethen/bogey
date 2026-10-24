begin;
select plan(13);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, kind, visibility, team_size_max) values
  (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'contest', 'public', 1);
insert into public.settings (scope, event_id, namespace, value) values
  ('event', tests.u('ev'), 'plugins', '{"enabled":["challenges"]}'),
  ('event', tests.u('ev'), 'plugin.challenges', '{"scoring":"ioi","scoreFrom":"subtasks","testRun":"all"}');
insert into public.event_windows (event_id, key, opens_at, closes_at) values
  (tests.u('ev'), 'challenges.contest', now() - interval '2 hours', now() + interval '1 hour'),
  (tests.u('ev'), 'challenges.scoreboard', now() - interval '2 hours', null);
select tests.create_user(tests.u('amy'), 'amy@t.test', '{"full_name":"amy"}');
insert into public.event_members (event_id, user_id, role) values (tests.u('ev'), tests.u('amy'), 'participant');
delete from public.teams where event_id = tests.u('ev');
insert into public.teams (id, event_id, name) values (tests.u('team'), tests.u('ev'), 'Amy');
insert into public.team_members (event_id, team_id, user_id) values (tests.u('ev'), tests.u('team'), tests.u('amy'));

insert into public.challenges_problems (id, event_id, label, slug, title, points, visible, kind) values
  (tests.u('a'), tests.u('ev'), 'A', 'a', 'Subtasks', 100, true, 'partial'),
  (tests.u('b'), tests.u('ev'), 'B', 'b', 'Pass/fail', 100, true, 'pass_fail');
insert into public.challenges_testcases (event_id, problem_id, ordinal, is_sample, group_key, points, input, answer) values
  (tests.u('ev'), tests.u('a'), 1, false, 'g1', 50, '1', '1'),
  (tests.u('ev'), tests.u('a'), 2, false, 'g2', 50, '2', '2');

select is(
  (select jsonb_build_object('testRun', s ->> 'testRun', 'penaltyUnit', s ->> 'penaltyUnit', 'showPending', s -> 'showPending')
   from private.challenges_settings(tests.u('ev2')) s),
  '{"testRun":"first_fail","penaltyUnit":"minutes","showPending":true}'::jsonb,
  'by default the runner stops at the first failure, penalty counts minutes and pending tries show');

-- the first solution passes subtask 1, judged through the runner
insert into public.challenges_solutions (id, event_id, problem_id, team_id, language_key, source, submitted_at)
values (tests.u('s1'), tests.u('ev'), tests.u('a'), tests.u('team'), 'python', 'print(1)', now() - interval '50 minutes');
insert into public.challenges_judgings (id, event_id, solution_id) values (tests.u('j1'), tests.u('ev'), tests.u('s1'));

select set_config('role', 'service_role', true);
create temp table claimed as select public.challenges_claim_judging('r1', 120) as c;
select is((select c ->> 'run_all' from claimed), 'true', 'a contest that runs every test says so in the claim');
select ok(public.challenges_record_judging(tests.u('j1'), 'r1', 'WA', 50, 10, null, '', '[]', '{"g1":50,"g2":0}'),
  'the runner records each group''s points');
reset role;
select is((select group_scores from public.challenges_judgings where id = tests.u('j1')), '{"g1":50,"g2":0}'::jsonb,
  'and they are kept with the judging');

-- the second passes only subtask 2
insert into public.challenges_solutions (id, event_id, problem_id, team_id, language_key, source, submitted_at)
values (tests.u('s2'), tests.u('ev'), tests.u('a'), tests.u('team'), 'python', 'print(2)', now() - interval '40 minutes');
insert into public.challenges_judgings (event_id, solution_id, status, verdict, score, group_scores, finished_at)
values (tests.u('ev'), tests.u('s2'), 'done', 'WA', 30, '{"g1":0,"g2":30}', now());

select tests.as_anon();
select is((public.challenges_scoreboard(tests.u('ev')) -> 'rows' -> 0 ->> 'score')::numeric, 80::numeric,
  'with subtask scoring each subtask counts its best result across solutions');
reset role;

update public.settings set value = '{"scoring":"ioi","scoreFrom":"best"}'
  where event_id = tests.u('ev') and namespace = 'plugin.challenges';
select tests.as_anon();
select is((public.challenges_scoreboard(tests.u('ev')) -> 'rows' -> 0 ->> 'score')::numeric, 50::numeric,
  'with the best solution only one solution counts');
reset role;

-- a judging from before group points were kept counts as a whole
update public.challenges_judgings set group_scores = null, score = 90 where id = tests.u('j1');
update public.settings set value = '{"scoring":"ioi","scoreFrom":"subtasks"}'
  where event_id = tests.u('ev') and namespace = 'plugin.challenges';
select tests.as_anon();
select is((public.challenges_scoreboard(tests.u('ev')) -> 'rows' -> 0 ->> 'score')::numeric, 90::numeric,
  'a judging without group points still counts by its score');
reset role;

-- B: wrong 90 minutes in, solved an hour in
insert into public.challenges_solutions (id, event_id, problem_id, team_id, language_key, source, submitted_at) values
  (tests.u('b1'), tests.u('ev'), tests.u('b'), tests.u('team'), 'python', 'x', now() - interval '90 minutes'),
  (tests.u('b2'), tests.u('ev'), tests.u('b'), tests.u('team'), 'python', 'y', now() - interval '60 minutes');
insert into public.challenges_judgings (event_id, solution_id, status, verdict, finished_at) values
  (tests.u('ev'), tests.u('b1'), 'done', 'WA', now()),
  (tests.u('ev'), tests.u('b2'), 'done', 'AC', now());

update public.settings set value = '{"scoring":"icpc","penaltyMinutes":30}'
  where event_id = tests.u('ev') and namespace = 'plugin.challenges';
select tests.as_anon();
select is((public.challenges_scoreboard(tests.u('ev')) -> 'rows' -> 0 ->> 'penalty')::integer, 90,
  'in minutes: 60 to the solve and 30 for the wrong try');
reset role;

update public.settings set value = '{"scoring":"icpc","penaltyMinutes":30,"penaltyUnit":"seconds"}'
  where event_id = tests.u('ev') and namespace = 'plugin.challenges';
create temp table board as select public.challenges_scoreboard(tests.u('ev')) as b;
select is((select (b -> 'rows' -> 0 ->> 'penalty')::integer from board), 3630,
  'in seconds: 3600 to the solve and 30 for the wrong try');
select is((select b ->> 'penaltyUnit' from board), 'seconds', 'the board says which unit it counts');
select is(
  (select (c ->> 'seconds')::integer from board, jsonb_array_elements(b -> 'rows' -> 0 -> 'cells') c
   where c ->> 'problem_id' = tests.u('b')::text),
  3600, 'and each solve has its seconds');

-- a try still waiting for its verdict
insert into public.challenges_solutions (id, event_id, problem_id, team_id, language_key, source, submitted_at)
values (tests.u('s3'), tests.u('ev'), tests.u('a'), tests.u('team'), 'python', 'print(3)', now() - interval '5 minutes');
insert into public.challenges_judgings (event_id, solution_id, status) values (tests.u('ev'), tests.u('s3'), 'queued');

select tests.as_anon();
select is(
  (select (c ->> 'pending')::integer from jsonb_array_elements(public.challenges_scoreboard(tests.u('ev')) -> 'rows' -> 0 -> 'cells') c
   where c ->> 'problem_id' = tests.u('a')::text),
  1, 'pending tries show by default');
reset role;

update public.settings set value = '{"scoring":"icpc","showPending":false}'
  where event_id = tests.u('ev') and namespace = 'plugin.challenges';
select tests.as_anon();
select is(
  (select (c ->> 'pending')::integer from jsonb_array_elements(public.challenges_scoreboard(tests.u('ev')) -> 'rows' -> 0 -> 'cells') c
   where c ->> 'problem_id' = tests.u('a')::text),
  0, 'and the public board hides them when showPending is off');
reset role;

select * from finish();
rollback;
