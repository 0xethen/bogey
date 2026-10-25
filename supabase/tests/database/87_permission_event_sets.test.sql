begin;
select plan(9);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'permsets', 'Perm Sets');
insert into public.events (id, org_id, slug, name) values
  (tests.u('ev1'), tests.u('org'), 'ev1', 'Ev 1'),
  (tests.u('ev2'), tests.u('org'), 'ev2', 'Ev 2');
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['boss','part','admin','left']) n;
insert into public.event_members (event_id, user_id, role, status) values
  (tests.u('ev1'), tests.u('boss'), 'organizer', 'active'),
  (tests.u('ev2'), tests.u('boss'), 'participant', 'active'),
  (tests.u('ev1'), tests.u('part'), 'participant', 'active'),
  (tests.u('ev1'), tests.u('left'), 'organizer', 'removed');
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('admin'), 'admin');

select tests.as_user(tests.u('boss'));
select is(private.events_where('event.manage'), array[tests.u('ev1')], 'an organizer manages their own event only');
select ok(tests.u('ev2') = any (private.events_where('event.compete')), 'and competes where they take part');
select is(
  (select count(*) from public.event_members where event_id = tests.u('ev1'))::int, 3,
  'so they see the event''s members');
select set_config('request.headers', '{"x-bogey-view-as":"participant"}', true);
select is(private.events_where('event.manage'), '{}'::uuid[], 'previewing a participant manages nothing');
select set_config('request.headers', '', true);
reset role;

select tests.as_user(tests.u('part'));
select is(private.events_where('event.manage'), '{}'::uuid[], 'a participant manages nothing');
select is(
  (select count(*) from public.event_members where event_id = tests.u('ev1'))::int, 1,
  'and sees only themselves among the members');
reset role;

select tests.as_user(tests.u('admin'));
select is(
  (select array_agg(e order by e) from unnest(private.events_where('event.manage')) e
   where e in (tests.u('ev1'), tests.u('ev2'))),
  (select array_agg(e order by e) from unnest(array[tests.u('ev1'), tests.u('ev2')]) e),
  'an org admin manages every event in the org');
reset role;

select tests.as_user(tests.u('left'));
select is(private.events_where('event.manage'), '{}'::uuid[], 'a removed organizer manages nothing');
reset role;

select is(private.events_where('event.manage'), '{}'::uuid[], 'without a session there''s nothing');

select * from finish();
rollback;
