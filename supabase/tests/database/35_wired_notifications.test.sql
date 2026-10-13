begin;
select plan(15);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max, timezone)
values (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public', 1, 4, 'UTC');
insert into public.event_windows (event_id, key, override) values
  (tests.u('ev'), 'teams', 'open'), (tests.u('ev'), 'submissions', 'open');
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','cap','mate','judge','late']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner');
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('cap'), 'participant'), (tests.u('ev'), tests.u('mate'), 'participant'),
  (tests.u('ev'), tests.u('judge'), 'judge'), (tests.u('ev'), tests.u('late'), 'participant');
select private.add_default_submission_form(tests.u('ev'));

select tests.as_user(tests.u('cap'));
select lives_ok($$select public.create_team(tests.u('ev'), 'Alpha team')$$, 'a captain starts a team');
reset role;
select tests.as_user(tests.u('mate'));
select lives_ok($$select public.join_team((select invite_code from public.teams where event_id = tests.u('ev')))$$, 'a teammate joins by code');
reset role;
select is((select count(*)::integer from public.notifications where user_id = tests.u('cap') and kind = 'team.joined'), 1, 'the captain is told');
select is((select count(*)::integer from public.notifications where user_id = tests.u('mate') and kind = 'team.joined'), 0, 'the new member is not');

insert into public.submissions (event_id, form_id, team_id, title, answers, status)
select tests.u('ev'), f.id, t.id, 'Trailmix', '{"description":"x"}', 'draft'
from public.submission_forms f, public.teams t where f.event_id = tests.u('ev') and t.event_id = tests.u('ev');
select tests.as_user(tests.u('cap'));
select lives_ok($$select public.submit_project((select id from public.submissions where event_id = tests.u('ev')))$$, 'the team submits');
reset role;
select is((select count(*)::integer from public.notifications where kind = 'submission.received' and event_id = tests.u('ev')), 2, 'both teammates are told');

select tests.as_user(tests.u('own'));
select is(public.assign_round_robin(tests.u('ev'), 1), 1, 'an organizer assigns the project');
reset role;
select is((select count(*)::integer from public.notifications where user_id = tests.u('judge') and kind = 'judging.assigned'), 1, 'the judge gets one message');

select tests.as_user(tests.u('own'));
select lives_ok($$select public.post_announcement(tests.u('ev'), 'Lunch', 'In the hall', 'info', null, '{}', '{}', '{}', false, true)$$, 'an organizer posts and notifies');
reset role;
select is((select count(*)::integer from public.notifications where kind = 'announcement' and event_id = tests.u('ev')), 4, 'every active member is told');
select is((select count(*)::integer from public.email_outbox where kind = 'announcement' and event_id = tests.u('ev')), 4, 'with an email each');

update public.submissions set status = 'draft' where event_id = tests.u('ev');
update public.event_windows set override = null, opens_at = now() - interval '1 day', closes_at = now() + interval '5 hours'
where event_id = tests.u('ev') and key = 'submissions';
select ok(private.remind_submission_deadlines() >= 2, 'the team is reminded of a draft before the deadline');
select is(private.remind_submission_deadlines(), 0, 'and only once');

select tests.as_user(tests.u('own'));
select lives_ok($$select public.import_roster(tests.u('ev'), '[{"email":"new@x.test"}]', true)$$, 'an import can invite');
reset role;
select is((select count(*)::integer from public.email_outbox where to_email = 'new@x.test' and kind = 'event.invite'), 1, 'someone without an account gets an invitation');

select * from finish();
rollback;
