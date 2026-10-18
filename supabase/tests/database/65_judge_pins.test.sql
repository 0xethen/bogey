begin;
select plan(13);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max)
values (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public', 1, 4);
insert into public.event_windows (event_id, key, override) values (tests.u('ev'), 'judging', 'open');
insert into public.submission_forms (id, event_id, key, title) values (tests.u('form'), tests.u('ev'), 'project', 'Project');
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','g','h','k','p']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner');
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('g'), 'judge'), (tests.u('ev'), tests.u('h'), 'judge'),
  (tests.u('ev'), tests.u('k'), 'judge'), (tests.u('ev'), tests.u('p'), 'participant');
insert into public.teams (id, event_id, name) values
  (tests.u('ta'), tests.u('ev'), 'A'), (tests.u('tb'), tests.u('ev'), 'B'), (tests.u('tc'), tests.u('ev'), 'C');
insert into public.submissions (id, event_id, form_id, team_id, title, status, submitted_at) values
  (tests.u('sa'), tests.u('ev'), tests.u('form'), tests.u('ta'), 'A', 'submitted', now()),
  (tests.u('sb'), tests.u('ev'), tests.u('form'), tests.u('tb'), 'B', 'submitted', now()),
  (tests.u('sc'), tests.u('ev'), tests.u('form'), tests.u('tc'), 'C', 'submitted', now());

select tests.as_user(tests.u('g'));
select throws_ok($$select public.pin_judge(tests.u('ev'), tests.u('g'), tests.u('ta'))$$, '42501', null, 'a judge can''t pin themself');
select lives_ok($$select public.declare_conflict(tests.u('sb'), 'my cousin')$$, 'a judge declares a conflict');
reset role;

select tests.as_user(tests.u('own'));
select is(public.pin_judge(tests.u('ev'), tests.u('k'), tests.u('ta')), 1, 'pinning assigns the judge to the team''s project now');
select is(public.pin_judge(tests.u('ev'), tests.u('k'), tests.u('ta')), 0, 'pinning again changes nothing');
select throws_ok($$select public.pin_judge(tests.u('ev'), tests.u('g'), tests.u('tb'))$$, 'P0001', null, 'a judge with a conflict can''t be pinned to that team');
select throws_ok($$select public.pin_judge(tests.u('ev'), tests.u('p'), tests.u('tc'))$$, '22023', null, 'only judges can be pinned');
select lives_ok($$select public.assign_round_robin(tests.u('ev'), 1)$$, 'auto-assign one judge per project');
select is((select array_agg(judge_id) from public.judge_assignments where submission_id = tests.u('sa')), array[tests.u('k')], 'the pinned judge is the one A gets');
select is((select count(*)::integer from public.judge_pins where event_id = tests.u('ev')), 1, 'organizers read pins');
reset role;

select tests.as_user(tests.u('k'));
select is((select count(*)::integer from public.judge_pins where event_id = tests.u('ev')), 0, 'judges don''t');
select lives_ok($$select public.declare_conflict(tests.u('sa'), 'my team after all')$$, 'the pinned judge declares a conflict with the team');
reset role;
select is((select count(*)::integer from public.judge_pins where event_id = tests.u('ev')), 0, 'which removes the pin');

select tests.as_user(tests.u('own'));
select lives_ok($$select public.unpin_judge(tests.u('ev'), tests.u('h'), tests.u('tc'))$$, 'unpinning a pair that isn''t pinned is harmless');
reset role;

select * from finish();
rollback;
