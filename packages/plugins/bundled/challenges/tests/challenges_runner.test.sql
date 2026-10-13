begin;
select plan(13);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, kind, visibility, team_size_max) values
  (tests.u('cup'), tests.u('org'), 'cup', 'Cup', 'contest', 'public', 1);
insert into public.settings (scope, event_id, namespace, value) values
  ('event', tests.u('cup'), 'plugins', '{"enabled":["challenges"]}'),
  ('event', tests.u('cup'), 'plugin.challenges', '{"scoring":"ioi"}');
select tests.create_user(tests.u('amy'), 'amy@t.test', '{"full_name":"amy"}');
insert into public.event_members (event_id, user_id, role) values (tests.u('cup'), tests.u('amy'), 'participant');
delete from public.teams where event_id = tests.u('cup');
insert into public.teams (id, event_id, name) values (tests.u('team'), tests.u('cup'), 'Amy');
insert into public.team_members (event_id, team_id, user_id) values (tests.u('cup'), tests.u('team'), tests.u('amy'));
insert into public.challenges_problems (id, event_id, label, slug, title, points, checker, checker_source, checker_language, test_groups)
values (tests.u('p'), tests.u('cup'), 'A', 'a', 'A', 100, 'custom', 'int main(){}', 'cpp', '{"g1":{"aggregation":"min","stopOnFail":true}}');
insert into public.challenges_testcases (event_id, problem_id, ordinal, is_sample, group_key, points, input, answer) values
  (tests.u('cup'), tests.u('p'), 1, true, null, null, '1 2', '3'),
  (tests.u('cup'), tests.u('p'), 2, false, 'g1', 50, '2 3', '5');
insert into public.challenges_solutions (id, event_id, problem_id, team_id, language_key, source)
values (tests.u('s'), tests.u('cup'), tests.u('p'), tests.u('team'), 'rust', 'fn main(){}');
insert into public.challenges_judgings (id, event_id, solution_id) values (tests.u('j'), tests.u('cup'), tests.u('s'));

select is((select count(*)::integer from public.challenges_languages where key in ('c', 'kotlin', 'rust', 'go')), 4, 'the runner''s four extra languages are seeded');

select tests.as_user(tests.u('amy'));
select throws_ok($$select public.challenges_claim_judging('r1')$$, '42501', null, 'a participant can''t claim a judging');
select throws_ok($$select public.challenges_requeue_judging(tests.u('j'), 'r1', 'x')$$, '42501', null, 'or hand one back');
reset role;

select set_config('role', 'service_role', true);
create temp table claimed as select public.challenges_claim_judging('r1', 120) as c;
select is((select c ->> 'scoring' from claimed), 'ioi', 'carries the event''s scoring setting');
select is((select c -> 'language' ->> 'image' from claimed), 'bogey-runner-rust:1.85', 'and the language''s image and commands');
select is((select c -> 'problem' -> 'checker_language' ->> 'key' from claimed), 'cpp', 'with the checker''s language as a whole row');
select is((select c -> 'problem' -> 'test_groups' -> 'g1' ->> 'aggregation' from claimed), 'min', 'and the problem''s groups');
select is((select c -> 'testcases' -> 0 ->> 'is_sample' from claimed), 'true', 'samples come first');
select is((select c ->> 'attempts' from claimed), '1', 'and how many times it has been tried');

select lives_ok($$select public.challenges_requeue_judging(tests.u('j'), 'r1', 'docker is down')$$, 'a runner hands a judging back');
select is((select status::text from public.challenges_judgings where id = tests.u('j')), 'queued', 'to the queue');
update public.challenges_judgings set status = 'running', runner_id = 'r1', attempts = 3 where id = tests.u('j');
select public.challenges_requeue_judging(tests.u('j'), 'r1', 'still down');
select is((select verdict::text || ':' || compile_output from public.challenges_judgings where id = tests.u('j')), 'JE:still down', 'after three attempts it ends as JE, with the reason');
select is((select count(*)::integer from public.challenges_judgings where id = tests.u('j') and runner_id is not null), 0, 'and is released');

select * from finish();
rollback;
