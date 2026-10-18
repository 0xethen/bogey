begin;
select plan(18);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'formats-org', 'Formats');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max)
values (tests.u('ev'), tests.u('org'), 'formats', 'Formats', 'public', 1, 4);
insert into public.event_windows (event_id, key, override) values (tests.u('ev'), 'judging', 'open');
insert into public.submission_forms (id, event_id, key, title) values (tests.u('form'), tests.u('ev'), 'project', 'Project');
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','g','h','k','pa','pc']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner');
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('g'), 'judge'), (tests.u('ev'), tests.u('h'), 'judge'),
  (tests.u('ev'), tests.u('k'), 'judge'), (tests.u('ev'), tests.u('pa'), 'participant'),
  (tests.u('ev'), tests.u('pc'), 'participant');
insert into public.teams (id, event_id, name) values
  (tests.u('ta'), tests.u('ev'), 'A'), (tests.u('tb'), tests.u('ev'), 'B'), (tests.u('tc'), tests.u('ev'), 'C');
insert into public.team_members (event_id, team_id, user_id, role) values
  (tests.u('ev'), tests.u('ta'), tests.u('pa'), 'captain'),
  (tests.u('ev'), tests.u('tc'), tests.u('pc'), 'captain');
insert into public.submissions (id, event_id, form_id, team_id, title, status, submitted_at) values
  (tests.u('sa'), tests.u('ev'), tests.u('form'), tests.u('ta'), 'A', 'submitted', now()),
  (tests.u('sb'), tests.u('ev'), tests.u('form'), tests.u('tb'), 'B', 'submitted', now()),
  (tests.u('sc'), tests.u('ev'), tests.u('form'), tests.u('tc'), 'C', 'submitted', now());
insert into public.judge_conflicts (event_id, judge_id, team_id) values (tests.u('ev'), tests.u('g'), tests.u('tc'));

select tests.as_user(tests.u('own'));
create temp table r as select id from public.judging_rounds where form_id = tests.u('form');
grant select on r to authenticated;
select throws_ok($$select public.save_panels((select id from r), '[]')$$, '22023', null,
  'panels need a demo round');
update public.judging_rounds set format = 'demos' where id = (select id from r);
select throws_ok($$select public.schedule_demos((select id from r))$$, 'P0001', null, 'and a panel');
select is(public.save_panels((select id from r), jsonb_build_array(
  jsonb_build_object('name', 'Room 1', 'location', 'Hall', 'startsAt', '2026-10-18T14:00:00Z', 'slotMinutes', 10,
    'judges', jsonb_build_array(tests.u('g'), tests.u('h'))),
  jsonb_build_object('name', 'Room 2', 'slotMinutes', 5, 'judges', jsonb_build_array(tests.u('k'))))), 2,
  'two panels');
select throws_ok($$select public.save_panels((select id from r), jsonb_build_array(
  jsonb_build_object('name', 'Kids', 'judges', jsonb_build_array(tests.u('pa')))))$$, '22023', null,
  'only judges sit on a panel');
select is(public.schedule_demos((select id from r)), 3, 'every entry gets a slot');
select is((select p.name from public.panel_slots sl join public.judging_panels p on p.id = sl.panel_id
  where sl.submission_id = tests.u('sc')), 'Room 2', 'C goes where no judge has a conflict with it');
select is((select count(*)::integer from public.judge_assignments where submission_id = tests.u('sc')), 1,
  'and gets that panel''s judge');
select is(public.schedule_demos((select id from r)), 0, 'scheduling again leaves placed entries be');
select throws_ok($$select public.assign_round_robin(tests.u('ev'), 1, (select id from r))$$, 'P0001', null,
  'auto-assign leaves a demo round to its panels');

-- moving A onto Room 2 swaps its judges for Room 2's
select lives_ok($$select public.move_demo((select id from r), tests.u('sa'),
  (select id from public.judging_panels where name = 'Room 2'), 0)$$, 'move A to the front of Room 2');
select is((select array_agg(judge_id) from public.judge_assignments where submission_id = tests.u('sa')),
  array[tests.u('k')], 'A has Room 2''s judge now');
select is((select position::integer from public.panel_slots where submission_id = tests.u('sc')), 2,
  'B and C moved down one');
reset role;

select tests.as_user(tests.u('k'));
select lives_ok($$select public.set_panel_now((select id from public.judging_panels where name = 'Room 2'), 2)$$,
  'a panel''s judge moves its presenter along');
reset role;
select tests.as_user(tests.u('g'));
select throws_ok($$select public.set_panel_now((select id from public.judging_panels where name = 'Room 2'), 0)$$,
  '42501', null, 'but not another panel''s');
reset role;

select tests.as_user(tests.u('pc'));
select is((select (public.my_demo_slots(tests.u('ev')) -> 0 ->> 'ahead')::integer), 0,
  'a team sees it''s up now');
reset role;

-- offline: organizers type the scores in and they rank
select tests.as_user(tests.u('own'));
update public.judging_rounds set format = 'offline' where id = (select id from r);
select is(public.save_offline_scores((select id from r), jsonb_build_array(
  jsonb_build_object('submission', tests.u('sa'), 'score', 70),
  jsonb_build_object('submission', tests.u('sb'), 'score', 90))), 2, 'two scores entered');
select is((select (e ->> 'title') from jsonb_array_elements(public.preview_results(tests.u('ev'))) e
  where (e ->> 'rank')::integer = 1), 'B', 'the higher score ranks first');
select is((select count(*)::integer from public.audit_log
  where event_id = tests.u('ev') and action in ('judging.panels_saved', 'judging.demos_scheduled',
    'judging.demo_moved', 'judging.offline_scores', 'judging.format_set')), 7, 'each change is audited');
reset role;

select * from finish();
rollback;
