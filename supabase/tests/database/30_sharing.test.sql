begin;
select plan(10);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max)
values (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public', 1, 4);
insert into public.event_windows (event_id, key, override) values (tests.u('ev'), 'judging', 'open'), (tests.u('ev'), 'results', 'open');
insert into public.submission_forms (id, event_id, key, title) values (tests.u('form'), tests.u('ev'), 'project', 'Project');
insert into public.criteria (id, event_id, label, max_score) values (tests.u('c1'), tests.u('ev'), 'Impact', 10);
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','j1','j2','pa','pb']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner');
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('j1'), 'judge'), (tests.u('ev'), tests.u('j2'), 'judge'),
  (tests.u('ev'), tests.u('pa'), 'participant'), (tests.u('ev'), tests.u('pb'), 'participant');
insert into public.teams (id, event_id, name) values (tests.u('ta'), tests.u('ev'), 'A'), (tests.u('tb'), tests.u('ev'), 'B');
insert into public.team_members (event_id, team_id, user_id) values (tests.u('ev'), tests.u('ta'), tests.u('pa')), (tests.u('ev'), tests.u('tb'), tests.u('pb'));
insert into public.submissions (id, event_id, form_id, team_id, title, status, submitted_at) values
  (tests.u('sa'), tests.u('ev'), tests.u('form'), tests.u('ta'), 'A', 'submitted', now());

select tests.as_user(tests.u('j1'));
select lives_ok($$insert into public.scores (event_id, submission_id, judge_id, criterion_id, value) values (tests.u('ev'), tests.u('sa'), tests.u('j1'), tests.u('c1'), 8)$$, 'a judge scores');
select lives_ok($$insert into public.feedback (event_id, submission_id, judge_id, body_md, visibility) values (tests.u('ev'), tests.u('sa'), tests.u('j1'), 'Nice demo', 'team')$$, 'and shares a note');
reset role;
select tests.as_user(tests.u('j2'));
select lives_ok($$insert into public.scores (event_id, submission_id, judge_id, criterion_id, value) values (tests.u('ev'), tests.u('sa'), tests.u('j2'), tests.u('c1'), 6)$$, 'another judge scores');
reset role;

select tests.as_user(tests.u('pa'));
select is((select count(*)::integer from public.team_scores(tests.u('sa'))), 0, 'no averages before results are published');
select is((select count(*)::integer from public.feedback), 0, 'and no notes');
reset role;
select tests.as_user(tests.u('own'));
select public.publish_results(tests.u('ev'));
reset role;

select tests.as_user(tests.u('pa'));
select is((select count(*)::integer from public.feedback), 1, 'the shared note shows once published (the default)');
select is((select count(*)::integer from public.team_scores(tests.u('sa'))), 0, 'but not scores, which are off by default');
reset role;
insert into public.settings (scope, event_id, namespace, value) values ('event', tests.u('ev'), 'judging', '{"shareWithTeams":"scores"}');
select tests.as_user(tests.u('pa'));
select is((select average from public.team_scores(tests.u('sa'))), 7.00, 'with scores on, the team sees the average');
reset role;
select tests.as_user(tests.u('pb'));
select is((select count(*)::integer from public.team_scores(tests.u('sa'))), 0, 'and another team does not');
reset role;
update public.settings set value = '{"shareWithTeams":"none"}' where event_id = tests.u('ev') and namespace = 'judging';
select tests.as_user(tests.u('pa'));
select is((select count(*)::integer from public.feedback), 0, 'with sharing off, even a note marked for the team stays private');
reset role;

select * from finish();
rollback;
