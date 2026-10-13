begin;
select plan(19);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha'), (tests.u('other'), 'beta', 'Beta');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max)
values (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public', 1, 4);
insert into public.event_windows (event_id, key, override) values (tests.u('ev'), 'judging', 'open');
insert into public.submission_forms (id, event_id, key, title) values (tests.u('form'), tests.u('ev'), 'project', 'Project');
insert into public.criteria (id, event_id, label, max_score) values (tests.u('c1'), tests.u('ev'), 'Impact', 10);
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','g','h','own2']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner'), (tests.u('other'), tests.u('own2'), 'owner');
insert into public.event_members (event_id, user_id, role) values (tests.u('ev'), tests.u('g'), 'judge'), (tests.u('ev'), tests.u('h'), 'judge');
insert into public.teams (id, event_id, name) values
  (tests.u('ta'), tests.u('ev'), 'A'), (tests.u('tb'), tests.u('ev'), 'B'), (tests.u('tc'), tests.u('ev'), 'C');
insert into public.submissions (id, event_id, form_id, team_id, title, status, submitted_at) values
  (tests.u('sa'), tests.u('ev'), tests.u('form'), tests.u('ta'), 'A', 'submitted', now()),
  (tests.u('sb'), tests.u('ev'), tests.u('form'), tests.u('tb'), 'B', 'submitted', now()),
  (tests.u('sc'), tests.u('ev'), tests.u('form'), tests.u('tc'), 'C', 'submitted', now());

select tests.as_user(tests.u('g'));
select lives_ok($$insert into public.scores (event_id, submission_id, judge_id, criterion_id, value) values
  (tests.u('ev'), tests.u('sa'), tests.u('g'), tests.u('c1'), 9), (tests.u('ev'), tests.u('sc'), tests.u('g'), tests.u('c1'), 7)$$, 'the generous judge scores');
reset role;
select tests.as_user(tests.u('h'));
select lives_ok($$insert into public.scores (event_id, submission_id, judge_id, criterion_id, value) values
  (tests.u('ev'), tests.u('sb'), tests.u('h'), tests.u('c1'), 5), (tests.u('ev'), tests.u('sc'), tests.u('h'), tests.u('c1'), 1)$$, 'and the harsh one');
reset role;

select is((select r ->> 'score' from jsonb_array_elements(private.rank_submissions(tests.u('ev'))) r where (r ->> 'submission_id')::uuid = tests.u('sa')), '90.00', 'unevened, A beats B');
select is((select r ->> 'score' from jsonb_array_elements(private.rank_submissions(tests.u('ev'))) r where (r ->> 'submission_id')::uuid = tests.u('sb')), '50.00', 'by a wide margin');
insert into public.settings (scope, event_id, namespace, value) values ('event', tests.u('ev'), 'judging', '{"normalize":"minmax"}');
select is((select r ->> 'score' from jsonb_array_elements(private.rank_submissions(tests.u('ev'))) r where (r ->> 'submission_id')::uuid = tests.u('sb')), '100.00', 'evened out by each judge''s range, B is its judge''s best');
select is((select r ->> 'score' from jsonb_array_elements(private.rank_submissions(tests.u('ev'))) r where (r ->> 'submission_id')::uuid = tests.u('sa')), '100.00', 'as A is its judge''s');
select is((select r ->> 'raw_score' from jsonb_array_elements(private.rank_submissions(tests.u('ev'))) r where (r ->> 'submission_id')::uuid = tests.u('sb')), '50.00', 'and the raw score stays beside it');
update public.settings set value = '{"normalize":"zscore"}' where event_id = tests.u('ev') and namespace = 'judging';
select ok((select (r ->> 'score')::numeric from jsonb_array_elements(private.rank_submissions(tests.u('ev'))) r where (r ->> 'submission_id')::uuid = tests.u('sa')) > 50, 'z-scores put a judge''s better-than-average entry above 50');

select tests.as_user(tests.u('g'));
select lives_ok($$select public.declare_conflict(tests.u('sa'), 'my cousin')$$, 'a judge declares a conflict');
select throws_ok($$insert into public.scores (event_id, submission_id, judge_id, criterion_id, value) values
  (tests.u('ev'), tests.u('sa'), tests.u('g'), tests.u('c1'), 2)$$, '42501', null, 'and can''t score that team after');
reset role;
select is((select (r ->> 'conflicted')::integer from jsonb_array_elements(private.rank_submissions(tests.u('ev'))) r where (r ->> 'submission_id')::uuid = tests.u('sa')), 1, 'their score for it is left out and flagged');
select is((select r ->> 'judges' from jsonb_array_elements(private.rank_submissions(tests.u('ev'))) r where (r ->> 'submission_id')::uuid = tests.u('sa')), '0', 'so A has no judges');

select tests.as_user(tests.u('own'));
select lives_ok($$select public.assign_round_robin(tests.u('ev'), 2)$$, 'an organizer assigns judges');
reset role;
select is((select count(*)::integer from public.judge_assignments where judge_id = tests.u('g') and submission_id = tests.u('sa')), 0, 'the judge with a conflict isn''t given that team');
select is((select count(*)::integer from public.judge_assignments where judge_id = tests.u('h') and submission_id = tests.u('sa')), 1, 'the other judge is');

select tests.as_user(tests.u('own'));
select is((select recorded from public.set_conflicts(tests.u('ev'), '[{"email":"h@t.test","team":"b"},{"email":"nobody@t.test","team":"A"}]')), 1, 'organizers record conflicts by email and team name');
select is((select jsonb_array_length(unmatched) from public.set_conflicts(tests.u('ev'), '[{"email":"nobody@t.test","team":"A"}]')), 1, 'and are told about the ones that match no one');
select lives_ok($$select public.remove_conflict(tests.u('ev'), tests.u('h'), tests.u('tb'))$$, 'a conflict can be lifted');
select is((select count(*)::integer from public.judge_calibration(tests.u('ev'))), 2, 'the calibration view lists both judges');
reset role;

select * from finish();
rollback;
