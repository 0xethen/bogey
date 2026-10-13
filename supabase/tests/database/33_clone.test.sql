begin;
select plan(25);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha'), (tests.u('other'), 'beta', 'Beta');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max, starts_at, ends_at, location)
values (tests.u('src'), tests.u('org'), 'src', 'Source', 'public', 2, 5, '2030-01-10 10:00+00', '2030-01-11 10:00+00', 'Hall');
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','staff','host','own2','pa']) n;
insert into public.org_members (org_id, user_id, role) values
  (tests.u('org'), tests.u('own'), 'owner'), (tests.u('org'), tests.u('host'), 'member'), (tests.u('other'), tests.u('own2'), 'owner');
insert into public.event_members (event_id, user_id, role) values
  (tests.u('src'), tests.u('staff'), 'staff'), (tests.u('src'), tests.u('host'), 'staff'), (tests.u('src'), tests.u('pa'), 'participant');
insert into public.event_windows (event_id, key, opens_at, closes_at, override) values
  (tests.u('src'), 'registration', '2030-01-01 00:00+00', '2030-01-09 00:00+00', 'open');
insert into public.divisions (event_id, name) values (tests.u('src'), 'Open');
select private.add_default_submission_form(tests.u('src'));
insert into public.criteria (event_id, label) values (tests.u('src'), 'Impact');
insert into public.tracks (event_id, name, form_id)
select tests.u('src'), 'Best hack', id from public.submission_forms where event_id = tests.u('src');
insert into public.invite_links (event_id, label) values (tests.u('src'), 'Friends');
insert into public.settings (scope, event_id, namespace, value) values
  ('event', tests.u('src'), 'home', '{"layout":{"main":[],"aside":[]}}'),
  ('event', tests.u('src'), 'checkin', '{"selfCheckIn":true}');
insert into public.teams (event_id, name) values (tests.u('src'), 'Team A');
insert into public.session_slots (id, event_id, starts_at) values (tests.u('slot'), tests.u('src'), '2030-01-10 12:00+00');
insert into public.event_sessions (id, event_id, slot_id, name) values (tests.u('sess'), tests.u('src'), tests.u('slot'), 'Kickoff');
insert into public.session_hosts (event_id, session_id, user_id) values (tests.u('src'), tests.u('sess'), tests.u('host'));

select tests.as_user(tests.u('staff'));
select throws_ok($$select public.clone_event(tests.u('src'), 'copy', 'Copy')$$, '42501', null, 'event staff can''t copy an event');
reset role;
select tests.as_user(tests.u('own2'));
select throws_ok($$select public.clone_event(tests.u('src'), 'copy', 'Copy')$$, '42501', null, 'nor can another org''s owner');
reset role;

select tests.as_user(tests.u('own'));
select throws_ok($$select public.clone_event(tests.u('src'), 'bad', 'Bad', null, array['nope'])$$, '22023', null, 'an unknown section is refused');
select throws_ok($$select public.clone_event(tests.u('src'), 'bad', 'Bad', null, array['judging'])$$, '22023', null, 'judging needs forms');
select lives_ok($$select public.clone_event(tests.u('src'), 'copy', 'Copy', '2030-02-10 10:00+00')$$, 'an org admin copies an event');
reset role;

select is((select e.starts_at from public.events e where e.slug = 'copy' and e.org_id = tests.u('org')), '2030-02-10 10:00+00'::timestamptz, 'the copy starts when asked');
select is((select ends_at from public.events where slug = 'copy' and org_id = tests.u('org')), '2030-02-11 10:00+00'::timestamptz, 'and keeps the length');
select is((select visibility::text from public.events where slug = 'copy' and org_id = tests.u('org')), 'draft', 'it is a draft');
select is((select opens_at from public.event_windows w join public.events e on e.id = w.event_id where e.slug = 'copy' and w.key = 'registration'), '2030-02-01 00:00+00'::timestamptz, 'windows move by the same amount');
select is((select override::text from public.event_windows w join public.events e on e.id = w.event_id where e.slug = 'copy' and w.key = 'registration'), null, 'without their overrides');
select is((select count(*)::integer from public.submission_items i join public.events e on e.id = i.event_id where e.slug = 'copy'), 5, 'forms come with their items');
select is((select count(*)::integer from public.judging_rounds r join public.events e on e.id = r.event_id where e.slug = 'copy'), 1, 'and one round, not two');
select is((select count(*)::integer from public.tracks t join public.events e on e.id = t.event_id join public.submission_forms f on f.id = t.form_id and f.event_id = e.id where e.slug = 'copy'), 1, 'tracks point at the copied form');
select is((select count(*)::integer from public.settings s join public.events e on e.id = s.event_id where e.slug = 'copy' and s.namespace in ('home', 'checkin')), 2, 'settings and the homepage come across');
select ok((select disabled_at is not null and token <> (select token from public.invite_links where event_id = tests.u('src')) from public.invite_links l join public.events e on e.id = l.event_id where e.slug = 'copy'), 'invite links are new and switched off');
select is((select count(*)::integer from public.teams t join public.events e on e.id = t.event_id where e.slug = 'copy'), 0, 'no teams');
select is((select count(*)::integer from public.event_members m join public.events e on e.id = m.event_id where e.slug = 'copy' and m.role = 'participant'), 0, 'and no participants');
select is((select role::text from public.event_members m join public.events e on e.id = m.event_id where e.slug = 'copy' and m.user_id = tests.u('host')), 'staff', 'a host from the org joins as staff');

select tests.as_user(tests.u('own'));
select throws_ok($$select public.clone_event(tests.u('src'), 'bad', 'Bad', '2030-03-10 10:00+00', p_ends_at => '2030-03-10 09:00+00')$$, '22023', null, 'a chosen end before the start is refused');
select lives_ok($$select public.clone_event(tests.u('src'), 'longer', 'Longer', '2030-03-10 10:00+00', p_ends_at => '2030-03-13 10:00+00')$$, 'a copy can end when chosen');
reset role;
select is((select ends_at from public.events where slug = 'longer' and org_id = tests.u('org')), '2030-03-13 10:00+00'::timestamptz, 'its end is the one chosen');
select is((select opens_at from public.event_windows w join public.events e on e.id = w.event_id where e.slug = 'longer' and w.key = 'registration'), '2030-03-01 00:00+00'::timestamptz, 'while everything else still moves with the start');

select tests.as_user(tests.u('own'));
select is((select (public.clone_event(tests.u('src'), 'tpl', 'Template', null, array['details'], true) ->> 'slug')), 'tpl', 'an organizer can save a template');
reset role;
select ok((select is_template and visibility = 'draft' from public.events where slug = 'tpl' and org_id = tests.u('org')), 'which is a private template');
select is((select count(*)::integer from public.audit_log where action = 'event.cloned' and org_id = tests.u('org')), 3, 'every copy is audited');

select * from finish();
rollback;
