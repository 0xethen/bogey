begin;
select plan(11);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max)
values (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public', 1, 4);
insert into public.event_windows (event_id, key, override) values (tests.u('ev'), 'judging', 'open');
insert into public.divisions (id, event_id, name, sort) values
  (tests.u('jr'), tests.u('ev'), 'Juniors', 0),
  (tests.u('sr'), tests.u('ev'), 'Seniors', 1),
  (tests.u('ai'), tests.u('ev'), 'AI', 2);
insert into public.submission_forms (id, event_id, key, title) values
  (tests.u('form'), tests.u('ev'), 'project', 'Project'),
  (tests.u('school'), tests.u('ev'), 'school', 'School');
insert into public.submission_form_divisions (event_id, form_id, division_id) values
  (tests.u('ev'), tests.u('school'), tests.u('jr')), (tests.u('ev'), tests.u('school'), tests.u('sr'));
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','p1','p2','j1','j2']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner');
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('p1'), 'participant'), (tests.u('ev'), tests.u('p2'), 'participant'),
  (tests.u('ev'), tests.u('j1'), 'judge'), (tests.u('ev'), tests.u('j2'), 'judge');
insert into public.teams (id, event_id, name, division_id) values (tests.u('ta'), tests.u('ev'), 'A', tests.u('jr'));
insert into public.team_members (event_id, team_id, user_id) values
  (tests.u('ev'), tests.u('ta'), tests.u('p1')), (tests.u('ev'), tests.u('ta'), tests.u('p2'));
insert into public.submissions (id, event_id, form_id, team_id, title, status, submitted_at) values
  (tests.u('sa'), tests.u('ev'), tests.u('form'), tests.u('ta'), 'A', 'submitted', now());
insert into public.judge_conflicts (event_id, judge_id, team_id)
values (tests.u('ev'), tests.u('j2'), tests.u('ta'));

select tests.as_user(tests.u('p1'));
select throws_ok($$select public.set_submission_division(tests.u('sa'), tests.u('sr'))$$, '42501', null,
  'a team can''t move itself this way');
reset role;

select tests.as_user(tests.u('j1'));
select lives_ok($$select public.set_submission_division(tests.u('sa'), tests.u('sr'))$$, 'a judge moves a project');
reset role;
select is((select division_id from public.teams where id = tests.u('ta')), tests.u('sr'), 'its team moves');
select is((select count(*)::integer from public.event_members where event_id = tests.u('ev') and division_id = tests.u('sr')),
  2, 'and so do its members');
select is((select count(*)::integer from public.audit_log where event_id = tests.u('ev') and action = 'judging.division_set'),
  1, 'audited');
select is((select count(*)::integer from public.notifications where event_id = tests.u('ev') and kind = 'judging.division_set'),
  2, 'and each member is told');

select tests.as_user(tests.u('j2'));
select throws_ok($$select public.set_submission_division(tests.u('sa'), tests.u('jr'))$$, '42501', null,
  'a conflicted judge can''t');
reset role;

select tests.as_user(tests.u('j1'));
select throws_ok($$select public.set_submission_division(tests.u('sa'), gen_random_uuid())$$, 'P0002', null,
  'the division must be in the event');
reset role;

insert into public.submissions (id, event_id, form_id, team_id, title, status, submitted_at) values
  (tests.u('sa2'), tests.u('ev'), tests.u('school'), tests.u('ta'), 'A school', 'submitted', now());
select tests.as_user(tests.u('j1'));
select throws_ok($$select public.set_submission_division(tests.u('sa'), tests.u('ai'))$$, '22023', null,
  'not into a division one of the team''s forms isn''t open to');
reset role;

insert into public.settings (scope, event_id, namespace, value)
values ('event', tests.u('ev'), 'judging', '{"judgeDivision":false}');
select tests.as_user(tests.u('j1'));
select throws_ok($$select public.set_submission_division(tests.u('sa'), tests.u('jr'))$$, '42501', null,
  'without judgeDivision, judges can''t');
reset role;
select tests.as_user(tests.u('own'));
select lives_ok($$select public.set_submission_division(tests.u('sa'), tests.u('jr'))$$, 'organizers still can');
reset role;

select * from finish();
rollback;
