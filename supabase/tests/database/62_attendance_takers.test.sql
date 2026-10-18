begin;
select plan(8);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'takers-org', 'Takers');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max) values
  (tests.u('ev'), tests.u('org'), 'takers', 'Takers', 'unlisted', 1, 4);
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['staff1','judge1','p1']) n;
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('staff1'), 'staff'),
  (tests.u('ev'), tests.u('judge1'), 'judge'),
  (tests.u('ev'), tests.u('p1'), 'participant');

select tests.as_user(tests.u('staff1'));
select ok(private.has_permission(tests.u('ev'), 'people.checkin'), 'staff take attendance by default');
select ok(private.has_permission(tests.u('ev'), 'sessions.attendance'), 'at the desk and in sessions');
reset role;
select tests.as_user(tests.u('judge1'));
select ok(not private.has_permission(tests.u('ev'), 'people.checkin'), 'judges don''t');
reset role;

insert into public.settings (scope, event_id, namespace, value)
  values ('event', tests.u('ev'), 'checkin', '{"takers":["organizer","judge"]}');
select tests.as_user(tests.u('judge1'));
select ok(private.has_permission(tests.u('ev'), 'people.checkin'), 'until the event picks them');
reset role;
select tests.as_user(tests.u('staff1'));
select ok(not private.has_permission(tests.u('ev'), 'sessions.attendance'), 'and staff stop when left out');
reset role;
select tests.as_user(tests.u('p1'));
select ok(not private.has_permission(tests.u('ev'), 'people.checkin'), 'participants don''t by role');
reset role;

-- a tag in the list lets whoever holds it take attendance, whatever their role
insert into public.tags (id, org_id, event_id, name) values (tests.u('volunteer'), tests.u('org'), tests.u('ev'), 'Volunteer');
insert into public.tag_holders (tag_id, user_id, org_id, event_id)
  values (tests.u('volunteer'), tests.u('p1'), tests.u('org'), tests.u('ev'));
update public.settings set value = jsonb_build_object('takers', jsonb_build_array('organizer', 'tag:' || tests.u('volunteer')))
  where event_id = tests.u('ev') and namespace = 'checkin';
select tests.as_user(tests.u('p1'));
select ok(private.has_permission(tests.u('ev'), 'sessions.attendance'), 'a tagged participant takes attendance');
reset role;
select tests.as_user(tests.u('judge1'));
select ok(not private.has_permission(tests.u('ev'), 'people.checkin'), 'untagged judges don''t');

select * from finish();
rollback;
