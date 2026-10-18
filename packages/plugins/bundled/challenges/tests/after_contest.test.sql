begin;
select plan(6);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, kind, visibility, team_size_max) values
  (tests.u('cup'), tests.u('org'), 'cup', 'Cup', 'contest', 'public', 1);
insert into public.settings (scope, event_id, namespace, value) values
  ('event', tests.u('cup'), 'plugins', '{"enabled":["challenges"]}'),
  ('event', tests.u('cup'), 'plugin.challenges', '{}');
insert into public.event_windows (event_id, key, opens_at, closes_at) values
  (tests.u('cup'), 'challenges.contest', now() - interval '2 hours', now() + interval '1 hour'),
  (tests.u('cup'), 'challenges.scoreboard', now() - interval '2 hours', null);
insert into public.challenges_problems (id, event_id, label, slug, title) values
  (tests.u('pa'), tests.u('cup'), 'A', 'a', 'Add');
select tests.create_user(tests.u('amy'), 'amy@t.test', '{"full_name":"amy"}');
insert into public.event_members (event_id, user_id, role) values (tests.u('cup'), tests.u('amy'), 'participant');

select tests.as_user(tests.u('amy'));
select lives_ok($$select public.challenges_submit(tests.u('pa'), 'python', 'print(3)')$$, 'a first solution goes in');
reset role;
update public.challenges_solutions set submitted_at = now() - interval '1 minute';

select tests.as_user(tests.u('amy'));
select throws_ok($$select public.challenges_submit(tests.u('pa'), 'python', 'print(4)')$$, 'P0001',
  'wait for your last solution to this problem to be judged', 'by default a team waits for its last solution to be judged');
reset role;

update public.settings set value = '{"waitForJudging":false}' where event_id = tests.u('cup') and namespace = 'plugin.challenges';
select tests.as_user(tests.u('amy'));
select lives_ok($$select public.challenges_submit(tests.u('pa'), 'python', 'print(4)')$$, 'with waiting off it doesn''t');
reset role;

update public.event_windows set closes_at = now() - interval '1 minute' where event_id = tests.u('cup') and key = 'challenges.contest';
select tests.as_user(tests.u('amy'));
select is_empty('select 1 from public.challenges_problems', 'problems are hidden once the contest is over');
select throws_ok($$select public.challenges_problem_samples(tests.u('pa'))$$, 'problem not available', 'and so are their samples');
reset role;

update public.settings set value = '{"problemsAfterContest":true}' where event_id = tests.u('cup') and namespace = 'plugin.challenges';
select tests.as_user(tests.u('amy'));
select results_eq('select label from public.challenges_problems', array['A'], 'unless the organizers keep them up');
reset role;

select * from finish();
rollback;
