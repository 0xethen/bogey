begin;
select plan(35);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha'), (tests.u('other'), 'beta', 'Beta');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max, starts_at)
values (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public', 1, 4, now() + interval '1 day');
insert into public.event_windows (event_id, key, override) values
  (tests.u('ev'), 'checkin', 'open'), (tests.u('ev'), 'teams', 'open');
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','desk','pa','pb','late','own2']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner'), (tests.u('other'), tests.u('own2'), 'owner');
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('desk'), 'staff'), (tests.u('ev'), tests.u('pa'), 'participant'), (tests.u('ev'), tests.u('pb'), 'participant');

select tests.as_user(tests.u('pb'));
select lives_ok($$select public.my_badge(tests.u('ev'))$$, 'another participant has a badge too');
reset role;
select set_config('t.other', (select code from public.member_codes where event_id = tests.u('ev') and user_id = tests.u('pb')), true);

select tests.as_user(tests.u('pa'));
select ok((select length(code) = 8 from public.my_badge(tests.u('ev'))), 'a member has an eight character badge code');
select is((select code from public.my_badge(tests.u('ev'))), (select code from public.my_badge(tests.u('ev'))), 'which stays the same');
select is_empty($$select 1 from public.member_codes$$, 'and no one can list the codes');
select throws_ok($$select public.check_in(tests.u('ev'), tests.u('pb'))$$, '42501', null, 'participants can''t check others in');
select throws_ok($$select public.check_in(tests.u('ev'), null, current_setting('t.other'), 'qr')$$, '42501', null, 'or with someone''s badge code');
select throws_ok($$select public.check_in(tests.u('ev'), null, current_setting('t.other'), 'self')$$, '42501', null, 'which isn''t a venue code either');
select throws_ok($$select * from public.venue_code(tests.u('ev'))$$, '42501', null, 'or see the venue code');
select throws_ok($$select public.undo_check_in(tests.u('ev'), tests.u('pb'))$$, '42501', null, 'or undo someone''s check-in');
select throws_ok($$select public.check_out(tests.u('ev'), tests.u('pb'))$$, '42501', null, 'or check them out');
select throws_ok($$select * from public.checkin_roster(tests.u('ev'))$$, '42501', null, 'or read the roster');
reset role;

select set_config('t.code', (select code from public.member_codes where event_id = tests.u('ev') and user_id = tests.u('pa')), true);
select tests.as_user(tests.u('desk'));
select is((select already from public.check_in(tests.u('ev'), tests.u('pb'))), false, 'staff check someone in');
select is((select already from public.check_in(tests.u('ev'), tests.u('pb'))), true, 'and are told when they already were');
select is((select user_id from public.check_in(tests.u('ev'), null, current_setting('t.code'), 'qr')), tests.u('pa'), 'a badge code finds its owner');
select throws_ok($$select public.check_in(tests.u('ev'), null, 'NOSUCHCD')$$, 'P0002', null, 'an unknown code finds no one');
select is((select count(*)::integer from public.checkin_roster(tests.u('ev')) where checked_in_at is not null), 2, 'the roster shows who is in');
select lives_ok($$select public.check_out(tests.u('ev'), tests.u('pb'))$$, 'staff mark someone as left');
select ok(not private.checked_in(tests.u('ev'), tests.u('pb')), 'who is then not checked in');
select lives_ok($$select public.undo_check_in(tests.u('ev'), tests.u('pa'))$$, 'and undo a mistake');
reset role;
select is((select count(*)::integer from public.audit_log where event_id = tests.u('ev') and action like 'checkin.%'), 4, 'all of it is audited');

select tests.as_user(tests.u('pb'));
select throws_ok($$select public.check_in(tests.u('ev'), null, 'ABCDEF', 'self')$$, '42501', null, 'self check-in is off until the event turns it on');
reset role;
insert into public.settings (scope, event_id, namespace, value) values ('event', tests.u('ev'), 'checkin', '{"selfCheckIn":true}');
select set_config('t.venue', private.venue_code(tests.u('ev')), true);
select tests.as_user(tests.u('pb'));
select throws_ok($$select public.check_in(tests.u('ev'), null, 'ABCDEF', 'self')$$, '42501', null, 'a wrong venue code is refused');
select lives_ok($$select public.check_in(tests.u('ev'), null, current_setting('t.venue'), 'self')$$, 'the venue code checks a person in');
reset role;

update public.settings set value = '{"selfCheckIn":true,"requiredToCompete":true}' where event_id = tests.u('ev') and namespace = 'checkin';
select tests.as_user(tests.u('pa'));
select throws_ok($$select public.create_team(tests.u('ev'), 'Rockets')$$, 'P0001', null, 'participants who haven''t checked in can''t make a team');
reset role;
select tests.as_user(tests.u('pb'));
select lives_ok($$select public.create_team(tests.u('ev'), 'Comets')$$, 'checked-in participants can');
reset role;

select tests.as_user(tests.u('desk'));
select throws_ok($$select * from public.check_in_walk_in(tests.u('ev'), 'late@t.test')$$, '42501', null, 'walk-ins need the setting');
reset role;
update public.settings set value = '{"allowWalkIns":true}' where event_id = tests.u('ev') and namespace = 'checkin';
select tests.as_user(tests.u('desk'));
select is((select registered from public.check_in_walk_in(tests.u('ev'), 'someone-new@t.test', 'New Person')), true, 'staff register someone off the roster');
reset role;
create temp table pa_email as select email from auth.users where id = tests.u('pa');
grant select on pa_email to authenticated;
select tests.as_user(tests.u('desk'));
select is((select checked_in from public.check_in_walk_in(tests.u('ev'), (select email from pa_email), '', '{}', false)), false, 'register only leaves a member checked out');
select is((select checked_in from public.check_in_walk_in(tests.u('ev'), (select email from pa_email))), true, 'register and check in checks a member in');
reset role;
select tests.as_user(tests.u('own2'));
select throws_ok($$select * from public.badge_sheet(tests.u('ev'))$$, '42501', null, 'another org''s owner can''t print the badges');
reset role;

-- checkin.requiredToEnter: a participant who isn't checked in is gated out of the whole event
select tests.create_user(tests.u('gated'), 'gated@t.test');
insert into public.event_members (event_id, user_id, role) values (tests.u('ev'), tests.u('gated'), 'participant');
update public.settings set value = '{"requiredToEnter":true}' where event_id = tests.u('ev') and namespace = 'checkin';
select tests.as_user(tests.u('gated'));
select is(public.event_gate(tests.u('ev')), 'checkin.required', 'a participant who hasn''t checked in is gated');
select lives_ok($$select public.my_badge(tests.u('ev'))$$, 'but still has their badge to show at the desk');
select throws_ok($$select public.create_team(tests.u('ev'), 'Gated')$$, null, null, 'and can''t make a team');
reset role;
select tests.as_user(tests.u('desk'));
select lives_ok($$select public.check_in(tests.u('ev'), tests.u('gated'))$$, 'staff check them in');
reset role;
select tests.as_user(tests.u('gated'));
select is(public.event_gate(tests.u('ev')), null, 'which opens the event to them');
reset role;

select * from finish();
rollback;
