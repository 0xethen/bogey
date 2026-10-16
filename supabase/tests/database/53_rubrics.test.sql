begin;
select plan(12);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max)
values (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public', 1, 4);
insert into public.event_windows (event_id, key, override) values
  (tests.u('ev'), 'judging', 'open'), (tests.u('ev'), 'submissions', 'open');
insert into public.submission_forms (id, event_id, key, title) values (tests.u('form'), tests.u('ev'), 'project', 'Project');
insert into public.rubrics (id, event_id, name) values (tests.u('health'), tests.u('ev'), 'Health'), (tests.u('climate'), tests.u('ev'), 'Climate');
insert into public.criteria (id, event_id, label, max_score, rubric_id) values
  (tests.u('build'), tests.u('ev'), 'Build', 10, null),
  (tests.u('ch'), tests.u('ev'), 'Health impact', 10, tests.u('health')),
  (tests.u('cc'), tests.u('ev'), 'Climate impact', 10, tests.u('climate'));
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','p1','p2','j1']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner');
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('p1'), 'participant'), (tests.u('ev'), tests.u('p2'), 'participant'), (tests.u('ev'), tests.u('j1'), 'judge');
insert into public.teams (id, event_id, name) values (tests.u('ta'), tests.u('ev'), 'A'), (tests.u('tb'), tests.u('ev'), 'B');
insert into public.team_members (event_id, team_id, user_id) values
  (tests.u('ev'), tests.u('ta'), tests.u('p1')), (tests.u('ev'), tests.u('tb'), tests.u('p2'));
insert into public.submissions (id, event_id, form_id, team_id, title, status, submitted_at) values
  (tests.u('sa'), tests.u('ev'), tests.u('form'), tests.u('ta'), 'A', 'submitted', now()),
  (tests.u('sb'), tests.u('ev'), tests.u('form'), tests.u('tb'), 'B', 'submitted', now());

select tests.as_user(tests.u('p1'));
select throws_ok($$select public.set_submission_rubric(tests.u('sa'), tests.u('health'))$$, '42501', null, 'teams can''t pick by default');
reset role;
select tests.as_user(tests.u('j1'));
select lives_ok($$select public.set_submission_rubric(tests.u('sa'), tests.u('health'))$$, 'judges can');
reset role;
select is((select rubric_id from public.submission_rubrics where submission_id = tests.u('sa')), tests.u('health'), 'the pick is stored');
select is((select count(*)::integer from public.audit_log where event_id = tests.u('ev') and action = 'judging.rubric_set'), 1, 'and audited');

insert into public.settings (scope, event_id, namespace, value) values ('event', tests.u('ev'), 'judging', '{"teamRubric":true,"judgeRubric":false}');
select tests.as_user(tests.u('p1'));
select lives_ok($$select public.set_submission_rubric(tests.u('sa'), tests.u('climate'))$$, 'with teamRubric, a team picks its own');
select throws_ok($$select public.set_submission_rubric(tests.u('sb'), tests.u('climate'))$$, '42501', null, 'but not another team''s');
reset role;
select tests.as_user(tests.u('j1'));
select throws_ok($$select public.set_submission_rubric(tests.u('sa'), tests.u('health'))$$, '42501', null, 'without judgeRubric, judges can''t');
select lives_ok($$insert into public.scores (event_id, submission_id, judge_id, criterion_id, value) values
  (tests.u('ev'), tests.u('sa'), tests.u('j1'), tests.u('build'), 10), (tests.u('ev'), tests.u('sa'), tests.u('j1'), tests.u('ch'), 0),
  (tests.u('ev'), tests.u('sa'), tests.u('j1'), tests.u('cc'), 10), (tests.u('ev'), tests.u('sb'), tests.u('j1'), tests.u('build'), 5),
  (tests.u('ev'), tests.u('sb'), tests.u('j1'), tests.u('ch'), 10)$$, 'judge scores both');
reset role;

select is((select r ->> 'score' from jsonb_array_elements(private.rank_submissions(tests.u('ev'))) r where (r ->> 'submission_id')::uuid = tests.u('sa')), '100.00', 'a project counts shared criteria and its rubric''s only');
select is((select r ->> 'rubric' from jsonb_array_elements(private.rank_submissions(tests.u('ev'))) r where (r ->> 'submission_id')::uuid = tests.u('sa')), 'Climate', 'the ranking names the rubric');
select is((select r ->> 'score' from jsonb_array_elements(private.rank_submissions(tests.u('ev'))) r where (r ->> 'submission_id')::uuid = tests.u('sb')), '50.00', 'without a pick, only shared criteria count');

select tests.as_user(tests.u('own'));
select public.save_criteria(tests.u('ev'),
  jsonb_build_array(jsonb_build_object('id', tests.u('build'), 'label', 'Build', 'max_score', 10, 'weight', 1)),
  jsonb_build_array(jsonb_build_object('id', tests.u('health'), 'name', 'Health')));
reset role;
select is((select count(*)::integer from public.submission_rubrics where event_id = tests.u('ev')), 0, 'removing a rubric drops the picks of it');

select * from finish();
rollback;
