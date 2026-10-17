begin;
select plan(6);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, kind, visibility, team_size_max) values
  (tests.u('mix'), tests.u('org'), 'mix', 'Mix', 'contest', 'public', 1);
insert into public.settings (scope, event_id, namespace, value) values
  ('event', tests.u('mix'), 'plugins', '{"enabled":["challenges"]}'),
  ('event', tests.u('mix'), 'plugin.challenges', '{"scoring":"ioi"}');
insert into public.event_windows (event_id, key, opens_at, closes_at) values
  (tests.u('mix'), 'challenges.contest', now() - interval '2 hours', now() + interval '1 hour'),
  (tests.u('mix'), 'challenges.scoreboard', now() - interval '2 hours', null);
select tests.create_user(tests.u('amy'), 'amy@t.test', '{"full_name":"amy"}');
insert into public.event_members (event_id, user_id, role) values (tests.u('mix'), tests.u('amy'), 'participant');

insert into public.challenges_problems (id, event_id, label, slug, title, points, visible) values
  (tests.u('pp'), tests.u('mix'), 'A', 'a', 'Partial', 100, true);
select is((select kind from public.challenges_problems where id = tests.u('pp')), 'partial', 'a new problem takes the type that fits the contest');
insert into public.challenges_problems (id, event_id, label, slug, title, points, visible, kind) values
  (tests.u('pf'), tests.u('mix'), 'B', 'b', 'Pass fail', 50, true, 'pass_fail'),
  (tests.u('sh'), tests.u('mix'), 'C', 'c', 'Short', 80, true, 'shortest');
select throws_ok($$update public.challenges_problems set kind = 'fastest' where id = tests.u('pf')$$, '23514', null, 'only known types');

with s as (
  insert into public.challenges_solutions (event_id, problem_id, team_id, language_key, source, submitted_at)
  select tests.u('mix'), p, (select team_id from public.team_members where user_id = tests.u('amy')), 'python', 'print(1)', now() - interval '1 hour'
  from unnest(array[tests.u('pp'), tests.u('pf'), tests.u('sh')]) p
  returning id, problem_id
)
insert into public.challenges_judgings (event_id, solution_id, status, verdict, score, finished_at)
select tests.u('mix'), id, 'done', (case when problem_id = tests.u('pp') then 'WA' else 'AC' end)::public.challenges_verdict,
  case when problem_id = tests.u('pp') then 40 end, now()
from s;

select tests.as_anon();
select is((public.challenges_scoreboard(tests.u('mix')) -> 'rows' -> 0 ->> 'score')::numeric, 170::numeric,
  'a points board adds partial credit (40), a solved pass/fail problem (50) and the shortest solution (80)');
select is((select c ->> 'length' from jsonb_array_elements(public.challenges_scoreboard(tests.u('mix')) -> 'rows' -> 0 -> 'cells') c
  where (c ->> 'problem_id')::uuid = tests.u('sh')), '8', 'a shortest-code cell carries its length');
select is((select p ->> 'kind' from jsonb_array_elements(public.challenges_scoreboard(tests.u('mix')) -> 'problems') p
  where (p ->> 'id')::uuid = tests.u('pf')), 'pass_fail', 'the board names each problem''s type');
reset role;

insert into public.challenges_solutions (event_id, problem_id, team_id, language_key, source)
select tests.u('mix'), tests.u('pp'), (select team_id from public.team_members where user_id = tests.u('amy')), 'python', 'print(2)';
insert into public.challenges_judgings (event_id, solution_id, status)
select tests.u('mix'), id, 'queued' from public.challenges_solutions where source = 'print(2)';
select set_config('role', 'service_role', true);
select is(public.challenges_claim_judging('r1') ->> 'scoring', 'ioi', 'the runner scores a partial-credit problem by its tests');
reset role;

select * from finish();
rollback;
