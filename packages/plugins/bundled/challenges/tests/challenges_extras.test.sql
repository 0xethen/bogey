begin;
select plan(18);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, kind, visibility, team_size_max) values
  (tests.u('cup'), tests.u('org'), 'cup', 'Cup', 'contest', 'public', 1);
insert into public.settings (scope, event_id, namespace, value) values
  ('event', tests.u('cup'), 'plugins', '{"enabled":["challenges"]}'),
  ('event', tests.u('cup'), 'plugin.challenges', '{"scoring":"golf"}');
insert into public.event_windows (event_id, key, opens_at, closes_at) values
  (tests.u('cup'), 'challenges.contest', now() - interval '2 hours', now() + interval '1 hour'),
  (tests.u('cup'), 'challenges.scoreboard', now() - interval '2 hours', null);
select tests.create_user(tests.u(n), n || '@t.test', jsonb_build_object('full_name', n)) from unnest(array['amy','ben','jury']) n;
insert into public.event_members (event_id, user_id, role) values
  (tests.u('cup'), tests.u('amy'), 'participant'), (tests.u('cup'), tests.u('ben'), 'participant'),
  (tests.u('cup'), tests.u('jury'), 'judge');
insert into public.event_role_grants (event_id, user_id, role_key) values (tests.u('cup'), tests.u('jury'), 'challenges.jury');

select ok(private.challenges_natural_key('A2') < private.challenges_natural_key('A10'), 'A2 sorts before A10');
select ok(private.challenges_natural_key('2') < private.challenges_natural_key('10'), 'and 2 before 10');
select ok(private.challenges_natural_key('Warm-up') < private.challenges_natural_key('warm-up 2'), 'text compares without case');

select tests.as_user(tests.u('jury'));
select lives_ok($$insert into public.challenges_problems (id, event_id, label, slug, title, points) values (tests.u('pa'), tests.u('cup'), 'Warm-up', 'warm-up', 'Warm-up', 100)$$, 'an ID can be any short text');
select throws_ok($$insert into public.challenges_problems (event_id, label, slug, title) values (tests.u('cup'), ' B', 'b', 'B')$$, '23514', null, 'but not with spaces at its ends');
select throws_ok($$insert into public.challenges_problems (event_id, label, slug, title) values (tests.u('cup'), repeat('x', 17), 'long', 'Long')$$, '23514', null, 'or longer than 16');
select lives_ok($$insert into public.challenges_problems (id, event_id, label, slug, title, points) values (tests.u('pb'), tests.u('cup'), '10', 'ten', 'Ten', 100)$$, 'a number is an ID too');

select lives_ok($$insert into public.challenges_difficulties (event_id, key, label, tone) values (tests.u('cup'), 'warm', 'Warm', 'amber')$$, 'the jury defines a difficulty');
select lives_ok($$update public.challenges_problems set difficulty = 'warm' where id = tests.u('pa')$$, 'and uses it');
select throws_ok($$update public.challenges_problems set difficulty = 'nope' where id = tests.u('pa')$$, '23503', null, 'but only one the event has');
select lives_ok($$delete from public.challenges_difficulties where event_id = tests.u('cup') and key = 'warm'$$, 'removing one');
select is((select difficulty from public.challenges_problems where id = tests.u('pa')), null, 'clears it from the problems that had it');
reset role;

insert into public.settings (scope, namespace, value) values ('instance', 'plugin.challenges.limits', '{"maxMemoryMb":128,"maxProblemsPerEvent":2}');
select tests.as_user(tests.u('jury'));
select throws_ok($$update public.challenges_problems set memory_limit_mb = 256 where id = tests.u('pa')$$, '23514', null, 'a problem can''t ask for more memory than the limit');
select lives_ok($$update public.challenges_problems set memory_limit_mb = 64 where id = tests.u('pa')$$, 'but can ask for less');
select throws_ok($$insert into public.challenges_problems (event_id, label, slug, title) values (tests.u('cup'), 'C', 'c', 'C')$$, '23514', null, 'an event can''t have more problems than the limit');
reset role;

delete from public.settings where namespace = 'plugin.challenges.limits';
with t as (select user_id, team_id from public.team_members where event_id = tests.u('cup')),
s as (
  insert into public.challenges_solutions (event_id, problem_id, team_id, language_key, source, submitted_at)
  select tests.u('cup'), tests.u('pa'), (select team_id from t where user_id = tests.u(who)), 'python', repeat('x', len), now() - interval '1 hour'
  from (values ('amy', 10), ('ben', 40)) as v(who, len)
  returning id
)
insert into public.challenges_judgings (event_id, solution_id, status, verdict, finished_at)
select tests.u('cup'), id, 'done', 'AC', now() from s;

select tests.as_anon();
select is((public.challenges_scoreboard(tests.u('cup')) -> 'rows' -> 0 ->> 'team_name'), 'amy', 'golf: the shortest solution ranks first');
select is((public.challenges_scoreboard(tests.u('cup')) -> 'rows' -> 1 ->> 'score')::numeric, 25.00, 'by ratio the longer one gets points x shortest / yours');
reset role;
update public.settings set value = '{"scoring":"golf","golfPoints":"rank","golfRankStep":30}' where namespace = 'plugin.challenges' and event_id = tests.u('cup');
select tests.as_anon();
select is((public.challenges_scoreboard(tests.u('cup')) -> 'rows' -> 1 ->> 'score')::numeric, 70::numeric, 'by place it loses the step for each place below first');
reset role;

select * from finish();
rollback;
