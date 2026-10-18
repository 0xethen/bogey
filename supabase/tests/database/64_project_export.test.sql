begin;
select plan(11);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'export-org', 'Export');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max) values
  (tests.u('ev'), tests.u('org'), 'export', 'Export', 'unlisted', 1, 4);
insert into public.submission_forms (id, event_id, key, title) values (tests.u('form'), tests.u('ev'), 'project', 'Project');
insert into public.criteria (id, event_id, label, max_score) values (tests.u('impact'), tests.u('ev'), 'Impact', 10);
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['org1','j1','p1']) n;
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('org1'), 'organizer'),
  (tests.u('ev'), tests.u('j1'), 'judge'),
  (tests.u('ev'), tests.u('p1'), 'participant');
insert into public.teams (id, event_id, name) values (tests.u('t1'), tests.u('ev'), 'Team 1');
insert into public.submissions (id, event_id, form_id, team_id, title, status, submitted_at) values
  (tests.u('s1'), tests.u('ev'), tests.u('form'), tests.u('t1'), 'P1', 'submitted', now());
insert into public.scores (event_id, submission_id, judge_id, criterion_id, value, round_id)
select tests.u('ev'), tests.u('s1'), tests.u('j1'), tests.u('impact'), 8,
  (select id from public.judging_rounds where event_id = tests.u('ev') and ordinal = 1);

select tests.as_user(tests.u('org1'));
select is(public.project_export_access(tests.u('ev')), 'all', 'organizers can export everything');
select is((public.project_export_results(tests.u('ev')) -> 0 -> 'criteria' ->> tests.u('impact')::text)::numeric, 8.00,
  'results carry the average per criterion');
select ok(not (public.project_export_results(tests.u('ev')) -> 0) ? 'team_name', 'but no team names');
reset role;

select tests.as_user(tests.u('j1'));
select is(public.project_export_access(tests.u('ev')), 'off', 'judges get nothing by default');
select throws_ok($$select public.log_export(tests.u('ev'), 'submissions')$$, '42501', null, 'so they can''t download it');
reset role;

insert into public.settings (scope, event_id, namespace, value)
values ('event', tests.u('ev'), 'judging', '{"judgeExport": "projects"}');
select tests.as_user(tests.u('j1'));
select lives_ok($$select public.log_export(tests.u('ev'), 'submissions')$$, 'with projects, judges download the spreadsheet');
select throws_ok($$select public.log_export(tests.u('ev'), 'scores')$$, '42501', null, 'and no other export');
select throws_ok($$select public.project_export_results(tests.u('ev'))$$, '42501', null, 'without judging results');
reset role;

update public.settings set value = '{"judgeExport": "results"}' where event_id = tests.u('ev') and namespace = 'judging';
select tests.as_user(tests.u('j1'));
select is(jsonb_array_length(public.project_export_results(tests.u('ev'))), 1, 'with results, judges get them too');
reset role;

select tests.as_user(tests.u('p1'));
select is(public.project_export_access(tests.u('ev')), 'off', 'participants never export projects');
select throws_ok($$select public.log_export(tests.u('ev'), 'submissions')$$, '42501', null, 'even when judges can');
reset role;

select * from finish();
rollback;
