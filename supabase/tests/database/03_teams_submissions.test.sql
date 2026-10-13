begin;
select plan(47);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max) values
  (tests.u('hack'), tests.u('org'), 'hack', 'Hack', 'public', 2, 2),
  (tests.u('solo'), tests.u('org'), 'solo', 'Solo', 'public', 1, 1);
insert into public.event_windows (event_id, key, override) values
  (tests.u('hack'), 'teams', 'open'), (tests.u('hack'), 'submissions', 'open'), (tests.u('hack'), 'judging', 'closed');
insert into public.submission_forms (id, event_id, key, title) values (tests.u('form'), tests.u('hack'), 'project', 'Project');
insert into public.submission_items (event_id, form_id, key, label, required) values (tests.u('hack'), tests.u('form'), 'pitch', 'Pitch', true);
insert into public.submission_forms (id, event_id, key, title, window_key) values (tests.u('final'), tests.u('hack'), 'final', 'Final slides', 'final-slides');
insert into public.event_windows (event_id, key, override) values (tests.u('hack'), 'final-slides', 'closed');
insert into public.criteria (id, event_id, label, max_score) values (tests.u('c1'), tests.u('hack'), 'Impact', 10);

select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['p1','p2','p3','j1','s1']) n;
insert into public.event_members (event_id, user_id, role) values
  (tests.u('hack'), tests.u('p1'), 'participant'), (tests.u('hack'), tests.u('p2'), 'participant'),
  (tests.u('hack'), tests.u('p3'), 'participant'), (tests.u('hack'), tests.u('j1'), 'judge'),
  (tests.u('solo'), tests.u('s1'), 'participant');

select is((select count(*)::int from public.team_members where event_id = tests.u('solo') and user_id = tests.u('s1')), 1, 'solo participant gets a team');
select is((select count(*)::int from public.team_members where event_id = tests.u('hack')), 0, 'team events do not');

select tests.as_user(tests.u('p1'));
select lives_ok($$select public.create_team(tests.u('hack'), 'Rockets')$$, 'participant creates a team');
select throws_ok($$select public.create_team(tests.u('hack'), 'Again')$$, 'P0001', null, 'one team per event');
reset role;
select tests.as_user(tests.u('p2'));
select lives_ok(format('select public.join_team(%L)', (select invite_code from public.teams where name = 'Rockets')), 'teammate joins by code');
reset role;
select tests.as_user(tests.u('p3'));
select is(public.team_preview((select invite_code from public.teams where name = 'Rockets'))->'members', '["p1", "p2"]'::jsonb, 'preview lists members, captain first');
select is((public.team_preview((select invite_code from public.teams where name = 'Rockets'))->>'size_max')::int, 2, 'preview says how big a team can be');
reset role;
select tests.as_user(tests.u('s1'));
select throws_ok(format('select public.team_preview(%L)', (select invite_code from public.teams where name = 'Rockets')), 'P0002', null, 'outsiders cannot preview');
reset role;
select tests.as_user(tests.u('p3'));
select throws_ok(format('select public.join_team(%L)', (select invite_code from public.teams where name = 'Rockets')), '23514', null, 'full team rejects');
reset role;
select tests.as_user(tests.u('j1'));
select throws_ok($$select public.create_team(tests.u('hack'), 'Judges')$$, '42501', null, 'judges cannot compete');
reset role;

select tests.as_user(tests.u('p1'));
select lives_ok($$update public.teams set name = 'Rocketz' where name = 'Rockets'$$, 'captain renames');
select throws_ok($$update public.teams set locked_at = now() where name = 'Rocketz'$$, '42501', null, 'captain cannot lock');

select lives_ok($$insert into public.submissions (event_id, form_id, team_id, title) select tests.u('hack'), tests.u('form'), id, 'Moonshot' from public.teams where name = 'Rocketz'$$, 'team starts a draft');
select throws_ok($$update public.submissions set status = 'submitted' where event_id = tests.u('hack')$$, '42501', null, 'status only changes through submit_project');
select throws_ok($$select public.submit_project(id) from public.submissions where event_id = tests.u('hack')$$, '23502', null, 'required fields block submitting');
select throws_ok($$insert into public.submissions (event_id, form_id, team_id, title) select tests.u('hack'), tests.u('final'), id, 'Later' from public.teams where name = 'Rocketz'$$, '42501', null, 'a form whose own window is closed refuses drafts');
update public.submissions set answers = '{"pitch":"to the moon"}' where event_id = tests.u('hack');
select is((select (public.submit_project(id)).status::text from public.submissions where event_id = tests.u('hack')), 'submitted', 'complete submission submits');
reset role;

select tests.as_user(tests.u('p3'));
select is_empty($$select 1 from public.submissions where event_id = tests.u('hack')$$, 'other participants cannot read it before the gallery');
reset role;

select tests.as_user(tests.u('j1'));
select is((select count(*)::int from public.submissions where event_id = tests.u('hack')), 1, 'judges read submitted projects');
select throws_ok($$insert into public.scores (event_id, submission_id, judge_id, criterion_id, value) select tests.u('hack'), id, tests.u('j1'), tests.u('c1'), 5 from public.submissions where event_id = tests.u('hack')$$, '42501', null, 'no scoring while judging is closed');
reset role;
update public.event_windows set override = 'open' where event_id = tests.u('hack') and key = 'judging';
update public.event_windows set override = 'closed' where event_id = tests.u('hack') and key = 'submissions';
select tests.as_user(tests.u('j1'));
select throws_ok($$insert into public.scores (event_id, submission_id, judge_id, criterion_id, value) select tests.u('hack'), id, tests.u('j1'), tests.u('c1'), 11 from public.submissions where event_id = tests.u('hack')$$, '23514', null, 'scores stay within the criterion max');
select lives_ok($$insert into public.scores (event_id, submission_id, judge_id, criterion_id, value) select tests.u('hack'), id, tests.u('p1'), tests.u('c1'), 8 from public.submissions where event_id = tests.u('hack')$$, 'judge scores');
select is((select judge_id from public.scores where event_id = tests.u('hack')), tests.u('j1'), 'judge_id is always the caller');
reset role;

select tests.as_user(tests.u('p1'));
select is_empty($$update public.submissions set title = 'late edit' where event_id = tests.u('hack') returning 1$$, 'no edits after submissions close');
reset role;

select tests.create_user(tests.u('o1'), 'o1@t.test');
insert into public.event_members (event_id, user_id, role) values (tests.u('hack'), tests.u('o1'), 'organizer');
select tests.as_user(tests.u('o1'));
select lives_ok($$update public.submissions set status = 'disqualified' where event_id = tests.u('hack')$$, 'organizers can disqualify');
select is((select count(*)::int from public.audit_log where action = 'submission.disqualified'), 0, 'organizers cannot read the audit log');
reset role;
select is((select count(*)::int from public.audit_log where action = 'submission.disqualified' and event_id = tests.u('hack')), 1, 'disqualifying is audited');
insert into public.settings (scope, event_id, namespace, value) values ('event', tests.u('hack'), 'judging', '{"showRankings":"everyone"}');
select tests.as_user(tests.u('o1'));
update public.submissions set status = 'submitted' where event_id = tests.u('hack');
select is((public.publish_results(tests.u('hack'))).rows -> 0 ->> 'score', '80.00', 'published results rank by weighted score');
reset role;
select tests.as_user(tests.u('p1'));
select is_empty('select 1 from public.result_publications', 'results hidden until the results window opens');
reset role;
insert into public.event_windows (event_id, key, override) values (tests.u('hack'), 'results', 'open');
select tests.as_anon();
select is((select count(*)::int from public.result_publications), 1, 'public event results are public once open');
reset role;

update public.org_members set role = 'admin' where user_id = tests.u('o1');
select tests.as_user(tests.u('o1'));
select lives_ok($$select public.create_event(tests.u('org'), 'fresh', 'Fresh', 'hackathon', 'UTC')$$, 'org admin creates a hackathon');
select is((select count(*)::int from public.submission_items i join public.submission_forms f on f.id = i.form_id
  join public.events e on e.id = f.event_id where e.slug = 'fresh'), 5, 'it starts with the Project form''s items');
reset role;
select is((select count(*)::int from public.submission_forms f join public.events e on e.id = f.event_id where e.slug = 'fresh'), 1, 'exactly one form');

select tests.as_user(tests.u('o1'));
select lives_ok($$select public.save_submission_form(tests.u('hack'), jsonb_build_object('id', tests.u('form'), 'title', 'Project'),
  '[{"key":"pitch","label":"Pitch","kind":"longtext","required":true},{"key":"slides","label":"Slides","kind":"file"}]')$$, 'organizer saves a form');
select results_eq($$select key from public.submission_items where form_id = tests.u('form') order by sort$$, array['pitch', 'slides'], 'items follow the saved order');
reset role;
select tests.as_user(tests.u('p1'));
select throws_ok($$select public.save_submission_form(tests.u('hack'), jsonb_build_object('id', tests.u('form'), 'title', 'Mine'), '[]')$$, '42501', null, 'participants cannot edit forms');
reset role;

select tests.as_user(tests.u('o1'));
select lives_ok($$select public.save_criteria(tests.u('hack'), jsonb_build_array(
  jsonb_build_object('label', 'Design', 'max_score', 5, 'weight', 1),
  jsonb_build_object('id', tests.u('c1'), 'label', 'Impact', 'max_score', 10, 'weight', 2)))$$, 'organizer saves criteria');
select results_eq($$select label from public.criteria where event_id = tests.u('hack') order by sort$$, array['Design', 'Impact'], 'criteria follow the saved order and keep their ids');
reset role;
select tests.as_user(tests.u('p1'));
select throws_ok($$select public.save_criteria(tests.u('hack'), '[]')$$, '42501', null, 'participants cannot edit criteria');
reset role;

select tests.as_user(tests.u('o1'));
select throws_ok($$select public.save_criteria(tests.u('hack'), jsonb_build_array(
  jsonb_build_object('id', tests.u('c1'), 'label', 'Impact', 'min_score', 10, 'max_score', 10, 'weight', 1)))$$, '23514', null, 'the lowest score must be below the top');
select lives_ok($$select public.save_criteria(tests.u('hack'), jsonb_build_array(
  jsonb_build_object('id', tests.u('c1'), 'label', 'Impact', 'min_score', 4, 'max_score', 10, 'weight', 1)))$$, 'organizer sets a range');
select is(public.preview_results(tests.u('hack')) -> 0 ->> 'score', '66.67', 'an 8 from 4 to 10 ranks as two thirds');
reset role;
select tests.as_user(tests.u('j1'));
select throws_ok($$update public.scores set value = 3 where event_id = tests.u('hack')$$, '23514', null, 'scores stay above the criterion min');
reset role;

update public.settings set value = value || '{"blind": true}' where scope = 'event' and event_id = tests.u('hack') and namespace = 'judging';
insert into public.event_windows (event_id, key, override) values (tests.u('hack'), 'gallery', 'open');
select tests.as_user(tests.u('j1'));
select is_empty($$select 1 from public.teams where event_id = tests.u('hack')$$, 'blind judges see no team names');
reset role;
select tests.as_anon();
select isnt_empty($$select 1 from public.teams where event_id = tests.u('hack')$$, 'the open gallery still shows them to everyone else');
select isnt_empty($$select 1 from public.submission_items where event_id = tests.u('hack')$$, 'an open gallery shows forms to the public, to lay out projects');
reset role;
update public.event_windows set override = 'closed' where event_id = tests.u('hack') and key = 'gallery';
select tests.as_anon();
select is_empty($$select 1 from public.submission_forms where event_id = tests.u('hack')$$, 'a closed gallery doesn''t');
reset role;

select * from finish();
rollback;
