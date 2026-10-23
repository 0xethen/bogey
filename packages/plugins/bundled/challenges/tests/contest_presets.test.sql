begin;
select plan(6);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, kind, visibility, team_size_max) values
  (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'contest', 'public', 1);
insert into public.settings (scope, event_id, namespace, value) values
  ('event', tests.u('ev'), 'plugins', '{"enabled":["challenges"]}'),
  ('event', tests.u('ev'), 'plugin.challenges', '{"scoring":"icpc","defaultKind":"partial"}');
insert into public.event_windows (event_id, key, opens_at, closes_at) values
  (tests.u('ev'), 'challenges.contest', now() - interval '2 hours', now() + interval '1 hour'),
  (tests.u('ev'), 'challenges.scoreboard', now() - interval '2 hours', null);
select tests.create_user(tests.u('amy'), 'amy@t.test', '{"full_name":"amy"}');
insert into public.event_members (event_id, user_id, role) values (tests.u('ev'), tests.u('amy'), 'participant');

insert into public.challenges_problems (id, event_id, label, slug, title, points, visible) values
  (tests.u('pp'), tests.u('ev'), 'A', 'a', 'Partial', 100, true);
select is((select kind from public.challenges_problems where id = tests.u('pp')), 'partial',
  'a new problem takes the contest''s default type over the one its scoring suggests');

update public.settings set value = '{"scoring":"golf","defaultKind":"style"}'
  where event_id = tests.u('ev') and namespace = 'plugin.challenges';
insert into public.challenges_problems (id, event_id, label, slug, title, points, visible) values
  (tests.u('sh'), tests.u('ev'), 'B', 'b', 'Short', 100, true);
select is((select kind from public.challenges_problems where id = tests.u('sh')), 'shortest',
  '"style" follows the scoring');
delete from public.challenges_problems where id = tests.u('sh');

select is(private.challenges_settings(tests.u('ev')) ->> 'scoreFrom', 'best', 'the best solution counts by default');

-- 70 points an hour ago, 30 points later, and a compile error last
with s as (
  insert into public.challenges_solutions (event_id, problem_id, team_id, language_key, source, submitted_at)
  select tests.u('ev'), tests.u('pp'), (select team_id from public.team_members where user_id = tests.u('amy')),
    'python', v.source, now() - v.ago
  from (values ('print(1)', interval '60 minutes'), ('print(2)', interval '30 minutes'),
    ('print(', interval '10 minutes')) v (source, ago)
  returning id, source
)
insert into public.challenges_judgings (event_id, solution_id, status, verdict, score, finished_at)
select tests.u('ev'), id, 'done',
  (case source when 'print(' then 'CE' else 'WA' end)::public.challenges_verdict,
  case source when 'print(1)' then 70 when 'print(2)' then 30 else 0 end, now()
from s;

update public.settings set value = '{"scoring":"ioi"}'
  where event_id = tests.u('ev') and namespace = 'plugin.challenges';
select tests.as_anon();
select is((public.challenges_scoreboard(tests.u('ev')) -> 'rows' -> 0 ->> 'score')::numeric, 70::numeric,
  'scored by the best solution');
reset role;

update public.settings set value = '{"scoring":"ioi","scoreFrom":"last"}'
  where event_id = tests.u('ev') and namespace = 'plugin.challenges';
select tests.as_anon();
select is((public.challenges_scoreboard(tests.u('ev')) -> 'rows' -> 0 ->> 'score')::numeric, 30::numeric,
  'scored by the last judged solution, a compile error aside');
reset role;

insert into public.challenges_solutions (event_id, problem_id, team_id, language_key, source, submitted_at)
select tests.u('ev'), tests.u('pp'), (select team_id from public.team_members where user_id = tests.u('amy')),
  'python', 'print(3)', now() - interval '5 minutes';
insert into public.challenges_judgings (event_id, solution_id, status)
select tests.u('ev'), id, 'queued' from public.challenges_solutions where source = 'print(3)';
select tests.as_anon();
select is((public.challenges_scoreboard(tests.u('ev')) -> 'rows' -> 0 ->> 'score')::numeric, 30::numeric,
  'a solution still waiting for its verdict doesn''t replace the last judged one');
reset role;

select * from finish();
rollback;
