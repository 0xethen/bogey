begin;
select plan(17);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max)
values (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public', 1, 4);
insert into public.event_windows (event_id, key, override) values (tests.u('ev'), 'judging', 'open');
insert into public.submission_forms (id, event_id, key, title) values (tests.u('form'), tests.u('ev'), 'project', 'Project');
insert into public.criteria (id, event_id, label, max_score) values (tests.u('c1'), tests.u('ev'), 'Impact', 10);
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','j1','j2','j3']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner');
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('j1'), 'judge'), (tests.u('ev'), tests.u('j2'), 'judge'), (tests.u('ev'), tests.u('j3'), 'judge');
insert into public.teams (id, event_id, name) values (tests.u('ta'), tests.u('ev'), 'A'), (tests.u('tb'), tests.u('ev'), 'B');
insert into public.submissions (id, event_id, form_id, team_id, title, status, submitted_at) values
  (tests.u('sa'), tests.u('ev'), tests.u('form'), tests.u('ta'), 'A', 'submitted', now()),
  (tests.u('sb'), tests.u('ev'), tests.u('form'), tests.u('tb'), 'B', 'submitted', now());
insert into public.judge_assignments (event_id, judge_id, submission_id) values
  (tests.u('ev'), tests.u('j1'), tests.u('sa')), (tests.u('ev'), tests.u('j2'), tests.u('sa'));
insert into public.scores (event_id, submission_id, judge_id, criterion_id, value) values
  (tests.u('ev'), tests.u('sa'), tests.u('j1'), tests.u('c1'), 9), (tests.u('ev'), tests.u('sa'), tests.u('j2'), tests.u('c1'), 2);

select is((select count(*)::integer from public.judging_flags where event_id = tests.u('ev')), 0, 'no flag on a gap without flagGap');
select tests.as_user(tests.u('j1'));
select is((select count(*)::integer from public.scores where submission_id = tests.u('sa')), 1, 'a judge sees only their own scores');
reset role;
select tests.as_user(tests.u('j3'));
select throws_ok($$select public.flag_submission(tests.u('sa'), 'odd')$$, '42501', null, 'a judge who isn''t on it can''t flag it');
reset role;
select tests.as_user(tests.u('j1'));
select lives_ok($$select public.flag_submission(tests.u('sa'), 'Looks like last year''s project')$$, 'its judge flags it');
select throws_ok($$select public.flag_submission(tests.u('sa'), 'again')$$, '23505', null, 'once at a time');
select is((select count(*)::integer from public.scores where submission_id = tests.u('sa')), 2, 'deliberating, they see each other''s scores');
select lives_ok($$select public.add_deliberation_note((select id from public.judging_flags where submission_id = tests.u('sa')), 'Check the repo dates')$$, 'and add notes');
reset role;
select tests.as_user(tests.u('j2'));
select is((select body_md from public.deliberation_notes where event_id = tests.u('ev')), 'Check the repo dates', 'the other judge reads it');
reset role;
select tests.as_user(tests.u('j3'));
select is_empty($$select 1 from public.judging_flags where event_id = tests.u('ev')$$, 'judges off the project don''t see the flag');
select is((select count(*)::integer from public.scores where submission_id = tests.u('sa')), 0, 'or its scores');
reset role;

select tests.as_user(tests.u('own'));
select throws_ok($$select public.publish_results(tests.u('ev'))$$, '55000', null, 'results wait for open flags');
reset role;
select tests.as_user(tests.u('j2'));
select lives_ok($$select public.resolve_flag((select id from public.judging_flags where submission_id = tests.u('sa')), 'Built this weekend')$$, 'a judge resolves it');
reset role;
select tests.as_user(tests.u('j1'));
select is((select count(*)::integer from public.scores where submission_id = tests.u('sa')), 1, 'once resolved, scores are private again');
reset role;
select tests.as_user(tests.u('own'));
select lives_ok($$select public.publish_results(tests.u('ev'))$$, 'and results publish');
reset role;

insert into public.settings (scope, event_id, namespace, value) values ('event', tests.u('ev'), 'judging', '{"flagGap":30,"deliberation":"all"}');
insert into public.scores (event_id, submission_id, judge_id, criterion_id, value) values
  (tests.u('ev'), tests.u('sb'), tests.u('j1'), tests.u('c1'), 9), (tests.u('ev'), tests.u('sb'), tests.u('j2'), tests.u('c1'), 2);
select is((select gap from public.judging_flags where submission_id = tests.u('sb') and resolved_at is null), 70.00, 'judges 70 points apart flag it on their own');
select tests.as_user(tests.u('j3'));
select is((select count(*)::integer from public.judging_flags where event_id = tests.u('ev')), 2, 'with deliberation "all", every judge sees flags');
select is((select count(*)::integer from public.scores where submission_id = tests.u('sb')), 2, 'and joins open ones');
reset role;

select * from finish();
rollback;
