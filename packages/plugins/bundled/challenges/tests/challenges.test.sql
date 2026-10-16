begin;
select plan(37);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, kind, visibility, team_size_max) values
  (tests.u('cup'), tests.u('org'), 'cup', 'Cup', 'contest', 'public', 1);
insert into public.settings (scope, event_id, namespace, value) values
  ('event', tests.u('cup'), 'plugins', '{"enabled":["challenges"]}'),
  ('event', tests.u('cup'), 'plugin.challenges', '{"languages":"python","attemptLimit":5,"freezeMinutes":120}');
insert into public.event_windows (event_id, key, opens_at, closes_at) values
  (tests.u('cup'), 'challenges.contest', now() - interval '2 hours', now() + interval '1 hour'),
  (tests.u('cup'), 'challenges.scoreboard', now() - interval '2 hours', null);
insert into public.challenges_problems (id, event_id, label, slug, title) values
  (tests.u('pa'), tests.u('cup'), 'A', 'a', 'Add'), (tests.u('pb'), tests.u('cup'), 'B', 'b', 'Bits');
insert into public.challenges_testcases (id, event_id, problem_id, ordinal, is_sample, input, answer) values
  (tests.u('ta1'), tests.u('cup'), tests.u('pa'), 1, true, '1 2', '3'),
  (tests.u('ta2'), tests.u('cup'), tests.u('pa'), 2, false, 'SECRET', '42');

select tests.create_user(tests.u(n), n || '@t.test', jsonb_build_object('full_name', n)) from unnest(array['amy','ben','jury']) n;
insert into public.event_members (event_id, user_id, role) values
  (tests.u('cup'), tests.u('amy'), 'participant'), (tests.u('cup'), tests.u('ben'), 'participant'),
  (tests.u('cup'), tests.u('jury'), 'judge');
insert into public.event_role_grants (event_id, user_id, role_key) values (tests.u('cup'), tests.u('jury'), 'challenges.jury');

select tests.as_user(tests.u('amy'));
select results_eq('select label from public.challenges_problems order by label', array['A', 'B'], 'problems visible during the contest');
select is_empty('select 1 from public.challenges_testcases', 'test cases are never readable by participants');
select results_eq($$select input from public.challenges_problem_samples(tests.u('pa'))$$, array['1 2'], 'samples come through the RPC');
select throws_ok($$insert into public.challenges_solutions (event_id, problem_id, team_id, language_key, source) values (tests.u('cup'), tests.u('pa'), private.my_team(tests.u('cup')), 'python', 'x')$$, '42501', null, 'solutions cannot be inserted directly');
select throws_ok($$select public.challenges_submit(tests.u('pa'), 'cpp', 'int main(){}')$$, '22023', null, 'disallowed language rejected');
select lives_ok($$select public.challenges_submit(tests.u('pa'), 'python', 'print(3)')$$, 'valid submission accepted');
select is_empty($$update public.challenges_judgings set verdict = 'AC', status = 'done' returning 1$$, 'participants cannot write verdicts');
select throws_ok($$select public.challenges_claim_judging('evil')$$, '42501', null, 'participants cannot claim judgings');
reset role;

select set_config('role', 'service_role', true);
select is((public.challenges_claim_judging('r1') -> 'problem' ->> 'label'), 'A', 'runner claims the queued judging');
select ok(not public.challenges_record_judging((select id from public.challenges_judgings limit 1), 'r2', 'AC', null, 10, 1000, null, '[]'), 'a runner without the lease cannot record');
select ok(public.challenges_record_judging((select id from public.challenges_judgings limit 1), 'r1', 'WA', null, 10, 1000, null,
  jsonb_build_array(
    jsonb_build_object('testcase_id', tests.u('ta1'), 'verdict', 'AC', 'output_excerpt', '3'),
    jsonb_build_object('testcase_id', tests.u('ta2'), 'verdict', 'WA', 'output_excerpt', 'SECRET', 'stderr_excerpt', 'SECRET'))), 'lease holder records');
select is((select output_excerpt from public.challenges_judging_runs where testcase_id = tests.u('ta2')), 'SECRET', 'hidden test output is kept, for the jury');
reset role;

select tests.as_user(tests.u('amy'));
select is((select verdict::text from public.challenges_judgings), 'WA', 'team sees its verdict');
select results_eq('select testcase_id from public.challenges_judging_runs', array[tests.u('ta1')], 'team sees sample runs only');
select set_config('t.sol', (select id::text from public.challenges_solutions limit 1), true);
select is((select count(*)::int from public.challenges_attempt_tests(current_setting('t.sol')::uuid)), 2, 'team gets each test''s result');
select is((select input from public.challenges_attempt_tests(current_setting('t.sol')::uuid) where not is_sample), null, 'but not a hidden test''s input');
select is((select output from public.challenges_attempt_tests(current_setting('t.sol')::uuid) where not is_sample), null, 'or its output');
select is((select input from public.challenges_attempt_tests(current_setting('t.sol')::uuid) where is_sample), '1 2', 'samples come with their input');
select throws_ok($$select checker_source from public.challenges_problems$$, '42501', null, 'checker source is not readable');
select throws_ok($$select public.challenges_set_testcases(tests.u('pa'), '[]')$$, '42501', null, 'participants cannot replace tests');
select throws_ok($$select public.challenges_submit(tests.u('pb'), 'python', 'print(1)')$$, 'P0001', 'wait a few seconds between solutions', 'a team waits between solutions');
reset role;
update public.challenges_judging_runs set stderr_excerpt = 'NameError: x' where testcase_id = tests.u('ta1');
select tests.as_user(tests.u('amy'));
select is((select stderr from public.challenges_attempt_tests(current_setting('t.sol')::uuid) where is_sample), 'NameError: x', 'a sample''s error message shows by default');
reset role;
update public.settings set value = value || '{"showErrors":false}' where event_id = tests.u('cup') and namespace = 'plugin.challenges';
select tests.as_user(tests.u('amy'));
select is((select stderr from public.challenges_attempt_tests(current_setting('t.sol')::uuid) where is_sample),
  'There was an error. This contest doesn''t show error messages.', 'with showErrors off, it only says there was one');
reset role;
update public.settings set value = value || '{"resultDetail":"verdict"}' where event_id = tests.u('cup') and namespace = 'plugin.challenges';
select tests.as_user(tests.u('amy'));
select is_empty($$select 1 from public.challenges_attempt_tests(current_setting('t.sol')::uuid)$$, 'with resultDetail verdict, teams see no tests');
reset role;
select tests.as_user(tests.u('ben'));
select is_empty('select 1 from public.challenges_solutions', 'other teams cannot read the source');
select throws_ok($$select * from public.challenges_attempt_tests(current_setting('t.sol')::uuid)$$, '42501', null, 'or another team''s tests');
reset role;
select tests.as_user(tests.u('jury'));
select is((select input from public.challenges_attempt_tests(current_setting('t.sol')::uuid) where not is_sample), 'SECRET', 'the jury sees hidden tests');
select is(public.challenges_set_testcases(tests.u('pb'), '[{"is_sample":true,"input":"1","answer":"1"},{"input":"2","answer":"2"}]'), 2, 'the jury replaces tests');
reset role;

update public.event_windows set opens_at = now() + interval '1 day', closes_at = now() + interval '2 days' where event_id = tests.u('cup') and key = 'challenges.contest';
select tests.as_user(tests.u('amy'));
select is_empty('select 1 from public.challenges_problems', 'an early scoreboard does not show the problems');
reset role;
update public.event_windows set opens_at = now() - interval '2 hours', closes_at = now() + interval '1 hour' where event_id = tests.u('cup') and key = 'challenges.contest';

insert into public.challenges_solutions (id, event_id, problem_id, team_id, language_key, source)
  select tests.u('s-stuck'), tests.u('cup'), tests.u('pb'), team_id, 'python', 'x' from public.team_members where user_id = tests.u('ben');
insert into public.challenges_judgings (event_id, solution_id, status, runner_id, lease_expires_at, attempts)
  values (tests.u('cup'), tests.u('s-stuck'), 'running', 'dead', now() - interval '1 minute', 3);
select is(private.challenges_expire_leases(), 1, 'expired lease is swept');
select is((select verdict::text from public.challenges_judgings where solution_id = tests.u('s-stuck')), 'JE', 'after 3 attempts it becomes JE');

delete from public.challenges_judgings; delete from public.challenges_solutions;
with t as (select user_id, team_id from public.team_members where event_id = tests.u('cup')),
s as (
  insert into public.challenges_solutions (event_id, problem_id, team_id, language_key, source, submitted_at)
  select tests.u('cup'), p, (select team_id from t where user_id = tests.u(who)), 'python', 'x', now() - interval '2 hours' + m * interval '1 minute'
  from (values ('amy', tests.u('pa'), 10, 'WA'), ('amy', tests.u('pa'), 30, 'AC'), ('ben', tests.u('pa'), 20, 'AC'), ('amy', tests.u('pb'), 70, 'AC'))
    as v(who, p, m, verdict)
  returning id, submitted_at
)
insert into public.challenges_judgings (event_id, solution_id, status, verdict, finished_at)
select tests.u('cup'), s.id, 'done', v.verdict::public.challenges_verdict, now()
from s join (values (10, 'WA'), (30, 'AC'), (20, 'AC'), (70, 'AC')) v(m, verdict)
  on s.submitted_at = now() - interval '2 hours' + v.m * interval '1 minute';

select tests.as_anon();
select is((public.challenges_scoreboard(tests.u('cup')) -> 'rows' -> 0 ->> 'team_name'), 'ben', 'ICPC: fewer penalty minutes rank first');
select is((public.challenges_scoreboard(tests.u('cup')) -> 'rows' -> 1 ->> 'penalty')::int, 50, 'penalty = solve minute + 20 per wrong try');
select is((public.challenges_scoreboard(tests.u('cup')) -> 'rows' -> 1 ->> 'solved')::int, 1, 'post-freeze solve is hidden publicly');
select is((public.challenges_scoreboard(tests.u('cup')) ->> 'frozen')::boolean, true, 'board reports frozen');
select throws_ok($$select public.challenges_scoreboard(tests.u('cup'), true)$$, '42501', null, 'jury view is jury-only');
reset role;
select tests.as_user(tests.u('jury'));
select is((public.challenges_scoreboard(tests.u('cup'), true) -> 'rows' -> 0 ->> 'team_name'), 'amy', 'jury view includes post-freeze solves');
reset role;

select * from finish();
rollback;
