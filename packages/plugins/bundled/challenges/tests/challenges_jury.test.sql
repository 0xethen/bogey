begin;
select plan(37);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, kind, visibility, team_size_max) values
  (tests.u('cup'), tests.u('org'), 'cup', 'Cup', 'contest', 'public', 1);
insert into public.settings (scope, event_id, namespace, value) values
  ('event', tests.u('cup'), 'plugins', '{"enabled":["challenges"]}'),
  ('event', tests.u('cup'), 'plugin.challenges', '{"scoring":"icpc","penaltyMinutes":20,"freezeMinutes":0}');
insert into public.event_windows (event_id, key, opens_at, closes_at) values
  (tests.u('cup'), 'challenges.contest', now() - interval '2 hours', now() + interval '1 hour'),
  (tests.u('cup'), 'challenges.scoreboard', now() - interval '2 hours', null);
select tests.create_user(tests.u(n), n || '@t.test', jsonb_build_object('full_name', n)) from unnest(array['amy','ben','jury']) n;
insert into public.event_members (event_id, user_id, role) values
  (tests.u('cup'), tests.u('amy'), 'participant'), (tests.u('cup'), tests.u('ben'), 'participant'),
  (tests.u('cup'), tests.u('jury'), 'judge');
insert into public.event_role_grants (event_id, user_id, role_key) values (tests.u('cup'), tests.u('jury'), 'challenges.jury');
delete from public.teams where event_id = tests.u('cup');
insert into public.teams (id, event_id, name) values (tests.u('ta'), tests.u('cup'), 'amy'), (tests.u('tb'), tests.u('cup'), 'ben');
insert into public.team_members (event_id, team_id, user_id) values
  (tests.u('cup'), tests.u('ta'), tests.u('amy')), (tests.u('cup'), tests.u('tb'), tests.u('ben'));
insert into public.challenges_problems (id, event_id, label, slug, title, points) values (tests.u('p'), tests.u('cup'), 'A', 'a', 'A', 100);
insert into public.challenges_testcases (event_id, problem_id, ordinal, input, answer) values (tests.u('cup'), tests.u('p'), 1, '1', '1');

insert into public.challenges_solutions (id, event_id, problem_id, team_id, language_key, source, submitted_at)
select tests.u('sa'), tests.u('cup'), tests.u('p'), tests.u('ta'), 'python', 'print(1)', now() - interval '1 hour';
insert into public.challenges_solutions (id, event_id, problem_id, team_id, language_key, source, submitted_at)
select tests.u('sb'), tests.u('cup'), tests.u('p'), tests.u('tb'), 'python', 'print(2)', now() - interval '30 minutes';
insert into public.challenges_judgings (id, event_id, solution_id, status, verdict, score, finished_at) values
  (tests.u('ja'), tests.u('cup'), tests.u('sa'), 'done', 'AC', null, now()),
  (tests.u('jb'), tests.u('cup'), tests.u('sb'), 'done', 'WA', null, now());

select is((public.challenges_scoreboard(tests.u('cup')) -> 'rows' -> 0 ->> 'team_name'), 'amy', 'amy leads the scoreboard');

select tests.as_user(tests.u('amy'));
select throws_ok($$select public.challenges_rejudge(tests.u('cup'), 'because')$$, '42501', null, 'participants can''t rejudge');
reset role;
select tests.as_user(tests.u('jury'));
select throws_ok($$select public.challenges_rejudge(tests.u('cup'), '  ')$$, '22023', null, 'a rejudging needs a reason');
select throws_ok($$select public.challenges_rejudge(tests.u('cup'), 'because', null, null, null, 'rust')$$, 'P0002', null, 'and some solutions to judge again');
create temp table made as select public.challenges_rejudge(tests.u('cup'), 'tests were wrong', null, tests.u('p'), null, null) as r;
select is((select r ->> 'count' from made), '2', 'a rejudging queues every matching solution');
select is((select count(*)::integer from public.challenges_judgings where rejudging_id = (select (r ->> 'id')::uuid from made) and not valid), 2, 'as judgings that don''t count yet');
reset role;
update public.challenges_judgings set status = 'done', verdict = 'AC', finished_at = now()
where rejudging_id = (select (r ->> 'id')::uuid from made) and solution_id = tests.u('sb');
select is((public.challenges_scoreboard(tests.u('cup')) -> 'rows' -> 0 ->> 'team_name'), 'amy', 'the scoreboard is unchanged until the set is applied');
select tests.as_user(tests.u('jury'));
select is((select new_verdict::text from public.challenges_rejudging_diff((select (r ->> 'id')::uuid from made)) where solution_id = tests.u('sb')), 'AC', 'the diff shows the new verdict');
select is((select old_verdict::text from public.challenges_rejudging_diff((select (r ->> 'id')::uuid from made)) where solution_id = tests.u('sb')), 'WA', 'beside the old');
select throws_ok($$select public.challenges_apply_rejudging((select (r ->> 'id')::uuid from made))$$, 'P0001', null, 'it can''t be applied while a judging is still queued');
reset role;
update public.challenges_judgings set status = 'done', verdict = 'AC', finished_at = now()
where rejudging_id = (select (r ->> 'id')::uuid from made) and solution_id = tests.u('sa');
select tests.as_user(tests.u('jury'));
select is(public.challenges_apply_rejudging((select (r ->> 'id')::uuid from made)), 2, 'applying makes both new verdicts count');
reset role;
select is((select verdict::text from public.challenges_judgings where id = tests.u('jb')), 'WA', 'the old judging is kept');
select is((select valid from public.challenges_judgings where id = tests.u('jb')), false, 'but no longer counts');
select is((select status::text from public.challenges_rejudgings where id = (select (r ->> 'id')::uuid from made)), 'applied', 'the set is applied');
select is((public.challenges_scoreboard(tests.u('cup')) -> 'rows' -> 1 ->> 'solved'), '1', 'and both teams solved it');

select tests.as_user(tests.u('jury'));
create temp table second as select public.challenges_rejudge(tests.u('cup'), 'one more', tests.u('sa')) as r;
select lives_ok($$select public.challenges_cancel_rejudging((select (r ->> 'id')::uuid from second))$$, 'a pending set can be cancelled');
select throws_ok($$select public.challenges_cancel_rejudging((select (r ->> 'id')::uuid from second))$$, 'P0001', null, 'once');
reset role;
select is((select count(*)::integer from public.challenges_judgings where rejudging_id = (select (r ->> 'id')::uuid from second)), 0, 'and its queued judgings are dropped');

select tests.as_user(tests.u('jury'));
select lives_ok($$select public.challenges_set_ignored(tests.u('sa'), true, 'cheated')$$, 'the jury ignores a solution');
reset role;
select is((public.challenges_scoreboard(tests.u('cup')) -> 'rows' -> 0 ->> 'team_name'), 'ben', 'it leaves the scoreboard');

update public.settings set value = value || '{"verificationRequired":true}' where namespace = 'plugin.challenges' and event_id = tests.u('cup');
select is((select r -> 'cells' -> 0 ->> 'solved' from jsonb_array_elements(public.challenges_scoreboard(tests.u('cup')) -> 'rows') r where r ->> 'team_name' = 'ben'), 'false', 'unverified results show as pending');
select tests.as_user(tests.u('ben'));
select is((select count(*)::integer from public.challenges_judgings where solution_id = tests.u('sb')), 0, 'and a team can''t read them');
reset role;
select tests.as_user(tests.u('jury'));
select cmp_ok(public.challenges_verify_judgings(tests.u('cup')), '>', 0, 'the jury verifies');
reset role;
select is((select r -> 'cells' -> 0 ->> 'solved' from jsonb_array_elements(public.challenges_scoreboard(tests.u('cup')) -> 'rows') r where r ->> 'team_name' = 'ben'), 'true', 'now they count');

select tests.as_user(tests.u('jury'));
select lives_ok($$select public.challenges_add_jury_solution(tests.u('p'), 'python', 'print(3)', 'WA', 'wrong on purpose')$$, 'the jury adds a solution with an expected verdict');
select is(public.challenges_verify_problem(tests.u('p')), 1, 'verifying a problem queues its jury solutions');
reset role;
select is((public.challenges_scoreboard(tests.u('cup')) -> 'rows' -> 0 ->> 'team_name'), 'ben', 'jury solutions never score');

update public.challenges_problems set checker = 'custom', checker_source = 'int main(){}', checker_language = 'cpp',
  test_groups = '{"g":{"aggregation":"min","stopOnFail":false}}' where id = tests.u('p');
select tests.as_user(tests.u('amy'));
select throws_ok($$select * from public.challenges_checker_source(tests.u('p'))$$, '42501', null, 'a participant can''t read a checker');
select throws_ok($$select public.challenges_log_package(tests.u('p'), true, 3)$$, '42501', null, 'or log a package');
reset role;
select tests.as_user(tests.u('jury'));
select is((select checker_source from public.challenges_checker_source(tests.u('p'))), 'int main(){}', 'the jury reads the checker source');
select is((select checker_language from public.challenges_checker_source(tests.u('p'))), 'cpp', 'its language');
select is((select test_groups -> 'g' ->> 'aggregation' from public.challenges_checker_source(tests.u('p'))), 'min', 'and the groups');
select lives_ok($$select public.challenges_log_package(tests.u('p'), false, 3)$$, 'the jury logs an export');
reset role;
select is((select count(*)::integer from public.audit_log where event_id = tests.u('cup') and action = 'challenges.package_exported'), 1, 'which is in the audit log');

select tests.as_user(tests.u('amy'));
select throws_ok($$select public.challenges_log_ccs_export(tests.u('cup'))$$, '42501', null, 'a participant can''t log a contest export');
reset role;
select tests.as_user(tests.u('jury'));
select lives_ok($$select public.challenges_log_ccs_export(tests.u('cup'))$$, 'the jury logs one');
reset role;
select is((select count(*)::integer from public.audit_log where event_id = tests.u('cup') and action = 'challenges.ccs_exported'), 1, 'which is in the audit log');

select * from finish();
rollback;
