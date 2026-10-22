begin;
select plan(16);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max)
values (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public', 1, 4);
insert into public.event_windows (event_id, key, override) values
  (tests.u('ev'), 'judging', 'open'), (tests.u('ev'), 'submissions', 'open');
insert into public.submission_forms (id, event_id, key, title) values (tests.u('form'), tests.u('ev'), 'project', 'Project');
insert into public.divisions (id, event_id, name) values
  (tests.u('hs'), tests.u('ev'), 'High school'), (tests.u('ms'), tests.u('ev'), 'Middle school');
insert into public.rubrics (id, event_id, name) values
  (tests.u('health'), tests.u('ev'), 'Health'), (tests.u('climate'), tests.u('ev'), 'Climate'),
  (tests.u('open'), tests.u('ev'), 'Open');
insert into public.criteria (id, event_id, label, max_score, rubric_id) values
  (tests.u('build'), tests.u('ev'), 'Build', 10, null),
  (tests.u('ch'), tests.u('ev'), 'Health impact', 10, tests.u('health')),
  (tests.u('cc'), tests.u('ev'), 'Climate impact', 10, tests.u('climate'));
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','p1','j1']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner');
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('p1'), 'participant'), (tests.u('ev'), tests.u('j1'), 'judge');
insert into public.teams (id, event_id, name, division_id) values
  (tests.u('ta'), tests.u('ev'), 'A', tests.u('hs')), (tests.u('tb'), tests.u('ev'), 'B', tests.u('ms'));
insert into public.team_members (event_id, team_id, user_id) values (tests.u('ev'), tests.u('ta'), tests.u('p1'));
insert into public.submissions (id, event_id, form_id, team_id, title, status, submitted_at) values
  (tests.u('sa'), tests.u('ev'), tests.u('form'), tests.u('ta'), 'A', 'submitted', now()),
  (tests.u('sb'), tests.u('ev'), tests.u('form'), tests.u('tb'), 'B', 'submitted', now());

-- guidance
select lives_ok($$update public.criteria set guidance = '[{"min":0,"max":4,"body":"Slides"},{"min":5,"max":10,"body":"Works"}]'
  where id = tests.u('build')$$, 'guidance bands inside the range save');
select throws_ok($$update public.criteria set guidance = '[{"min":0,"max":11,"body":"Too far"}]' where id = tests.u('build')$$,
  '23514', null, 'a band past the top score is refused');
select throws_ok($$update public.criteria set guidance = '[{"min":1.5,"max":3,"body":"Half"}]' where id = tests.u('build')$$,
  '23514', null, 'bands are whole numbers');
select throws_ok($$update public.criteria set guidance = '{"min":1}' where id = tests.u('build')$$,
  '23514', null, 'guidance is a list');
select throws_ok($$update public.criteria set max_score = 3 where id = tests.u('build')$$,
  '23514', null, 'shrinking the range under its bands is refused');

select tests.as_user(tests.u('own'));
select public.save_criteria(tests.u('ev'),
  jsonb_build_array(
    jsonb_build_object('id', tests.u('build'), 'label', 'Build', 'max_score', 10, 'weight', 1,
      'guidance', '[{"min":0,"max":10,"body":"Anything"}]'::jsonb),
    jsonb_build_object('id', tests.u('ch'), 'label', 'Health impact', 'max_score', 10, 'weight', 1, 'rubric_id', tests.u('health')),
    jsonb_build_object('id', tests.u('cc'), 'label', 'Climate impact', 'max_score', 10, 'weight', 1, 'rubric_id', tests.u('climate'))),
  jsonb_build_array(
    jsonb_build_object('id', tests.u('health'), 'name', 'Health', 'division_ids', jsonb_build_array(tests.u('hs'))),
    jsonb_build_object('id', tests.u('climate'), 'name', 'Climate', 'division_ids', jsonb_build_array(tests.u('ms'))),
    jsonb_build_object('id', tests.u('open'), 'name', 'Open')));
reset role;
select is((select guidance -> 0 ->> 'body' from public.criteria where id = tests.u('build')), 'Anything', 'save_criteria stores guidance');
select is((select count(*)::integer from public.rubric_divisions where event_id = tests.u('ev')), 2, 'and rubric divisions');

-- division rubrics
select is(private.submission_rubric(tests.u('sa')), tests.u('health'), 'without a pick, a project gets its division''s only rubric');
select is((public.project_rubric(tests.u('sa')) ->> 'fallback')::uuid, tests.u('health'), 'project_rubric names the fallback');

select tests.as_user(tests.u('j1'));
select is(jsonb_array_length(public.project_rubric(tests.u('sa')) -> 'allowed'), 2, 'judges see its rubric and the open one as choices');
select throws_ok($$select public.set_submission_rubric(tests.u('sa'), tests.u('climate'))$$, '22023', null,
  'a rubric meant for other divisions can''t be picked');
select lives_ok($$select public.set_submission_rubric(tests.u('sa'), tests.u('open'))$$, 'an open rubric can');
select lives_ok($$insert into public.scores (event_id, submission_id, judge_id, criterion_id, value) values
  (tests.u('ev'), tests.u('sb'), tests.u('j1'), tests.u('build'), 10), (tests.u('ev'), tests.u('sb'), tests.u('j1'), tests.u('cc'), 0),
  (tests.u('ev'), tests.u('sb'), tests.u('j1'), tests.u('ch'), 10)$$, 'judge scores B');
select throws_ok($$select public.set_division_rubrics(tests.u('ev'), '[]')$$, '42501', null, 'only organizers set division rubrics');
reset role;

select is((select r ->> 'score' from jsonb_array_elements(private.rank_submissions(tests.u('ev'))) r
  where (r ->> 'submission_id')::uuid = tests.u('sb')), '50.00', 'the ranking counts the division''s rubric');

select tests.as_user(tests.u('own'));
select public.set_division_rubrics(tests.u('ev'),
  jsonb_build_array(jsonb_build_object('division_id', tests.u('ms'), 'rubric_ids', jsonb_build_array(tests.u('climate'), tests.u('open')))));
reset role;
select is(private.submission_rubric(tests.u('sb')), null, 'with two rubrics, a division''s projects pick one');

select * from finish();
rollback;
