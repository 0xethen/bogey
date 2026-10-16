begin;
select plan(16);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max)
values (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public', 1, 4);
insert into public.event_windows (event_id, key, override) values (tests.u('ev'), 'judging', 'open');
insert into public.submission_forms (id, event_id, key, title) values (tests.u('form'), tests.u('ev'), 'project', 'Project');
insert into public.criteria (id, event_id, label, max_score) values (tests.u('c1'), tests.u('ev'), 'Impact', 10);
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','p1','p2','p3','j1','w1']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner');
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('p1'), 'participant'), (tests.u('ev'), tests.u('p2'), 'participant'),
  (tests.u('ev'), tests.u('p3'), 'participant'), (tests.u('ev'), tests.u('j1'), 'judge');
insert into public.registrations (event_id, email, user_id, source, status) values
  (tests.u('ev'), 'w1@t.test', tests.u('w1'), 'self', 'pending');
insert into public.teams (id, event_id, name) values (tests.u('ta'), tests.u('ev'), 'A');
insert into public.team_members (event_id, team_id, user_id) values (tests.u('ev'), tests.u('ta'), tests.u('p1'));
insert into public.submissions (id, event_id, form_id, team_id, title, status, submitted_at) values
  (tests.u('sa'), tests.u('ev'), tests.u('form'), tests.u('ta'), 'A', 'submitted', now());
insert into public.checkins (event_id, user_id, method) values (tests.u('ev'), tests.u('p1'), 'desk'), (tests.u('ev'), tests.u('p2'), 'desk');
insert into public.scores (event_id, submission_id, judge_id, criterion_id, value) values
  (tests.u('ev'), tests.u('sa'), tests.u('j1'), tests.u('c1'), 7);

select tests.as_user(tests.u('j1'));
select throws_ok($$select public.clear_event_data(tests.u('ev'), 'judging', null, true)$$, '42501', null, 'judges can''t');
reset role;

select tests.as_user(tests.u('own'));
select is((public.clear_event_data(tests.u('ev'), 'not_checked_in', null, true) ->> 'count')::integer, 1, 'one participant never checked in');
select is((public.clear_event_data(tests.u('ev'), 'no_team', null, true) ->> 'count')::integer, 2, 'two have no team');
select is((public.clear_event_data(tests.u('ev'), 'no_submission', null, true) ->> 'count')::integer, 2, 'two have no submitted project');
select is((select count(*)::integer from public.event_members where event_id = tests.u('ev') and status = 'active'), 4, 'counting changes nothing');
select throws_ok($$select public.clear_event_data(tests.u('ev'), 'not_checked_in', 'wrong')$$, '22023', null, 'doing it takes the address');
select is((public.clear_event_data(tests.u('ev'), 'not_checked_in', 'ev') ->> 'count')::integer, 1, 'pruned');
select is((select status::text from public.event_members where event_id = tests.u('ev') and user_id = tests.u('p3')), 'removed', 'the no-show is removed');
select is((select count(*)::integer from public.audit_log where event_id = tests.u('ev') and action = 'event.cleared'), 1, 'and it''s audited');

select is((public.clear_event_data(tests.u('ev'), 'waiting', 'ev') ->> 'count')::integer, 1, 'everyone waiting is declined');
select is((select status::text from public.registrations where event_id = tests.u('ev') and user_id = tests.u('w1')), 'rejected', 'their registration says so');

select is((public.clear_event_data(tests.u('ev'), 'judging', 'ev') ->> 'count')::integer, 1, 'judging resets for the one judged project');
select is((select count(*)::integer from public.scores where event_id = tests.u('ev')), 0, 'its scores are gone');
select is((select count(*)::integer from public.submissions where event_id = tests.u('ev')), 1, 'the project stays');

select lives_ok($$select public.clear_event_data(tests.u('ev'), 'participants', 'ev')$$, 'removing every participant');
reset role;
select is((select count(*)::integer from public.event_members where event_id = tests.u('ev')), 1, 'leaves only the judge, and takes teams and projects with them');

select * from finish();
rollback;
