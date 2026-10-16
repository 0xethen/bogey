begin;
select plan(10);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['owner','admin2','p1','p2','root']) n;
insert into public.org_members (org_id, user_id, role) values
  (tests.u('org'), tests.u('owner'), 'owner'), (tests.u('org'), tests.u('root'), 'owner');
delete from public.platform_admins;
insert into public.platform_admins (user_id) values (tests.u('root'));
insert into public.events (id, org_id, slug, name) values (tests.u('ev'), tests.u('org'), 'ev', 'Ev');
insert into public.settings (scope, namespace, value) values
  ('instance', 'limits', '{"eventsPerOrg":1,"adminsPerOrg":1,"participantsPerEvent":1}')
on conflict (scope, org_id, event_id, namespace) do update set value = excluded.value;

select tests.as_user(tests.u('owner'));
select throws_ok(
  $$insert into public.events (org_id, slug, name) values (tests.u('org'), 'second', 'Second')$$,
  '23514', 'this organization can have at most 1 events', 'a second event goes over the limit');
select throws_ok(
  $$insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('admin2'), 'admin')$$,
  '23514', null, 'a second admin goes over the limit');
select lives_ok(
  $$insert into public.event_members (event_id, user_id, role) values (tests.u('ev'), tests.u('p1'), 'participant')$$,
  'the first participant fits');
select throws_ok(
  $$insert into public.event_members (event_id, user_id, role) values (tests.u('ev'), tests.u('p2'), 'participant')$$,
  '23514', null, 'the second participant does not');
select lives_ok(
  $$insert into public.event_members (event_id, user_id, role) values (tests.u('ev'), tests.u('admin2'), 'judge')$$,
  'staff roles are not participants');
reset role;

select tests.as_user(tests.u('owner'));
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('p1'), 'member');
select throws_ok(
  $$update public.org_members set role = 'admin' where org_id = tests.u('org') and user_id = tests.u('p1')$$,
  '23514', null, 'promoting a member counts too');
select throws_ok(
  $$update public.event_members set role = 'participant' where event_id = tests.u('ev') and user_id = tests.u('admin2')$$,
  '23514', null, 'and so does turning staff into a participant');
reset role;

select tests.as_user(tests.u('root'));
select throws_ok(
  $$insert into public.events (org_id, slug, name) values (tests.u('org'), 'admin-made', 'Admin made')$$,
  '23514', null, 'platform admins are held to it too');
select throws_ok(
  $$select public.clone_event(tests.u('ev'), 'copy', 'Copy')$$,
  '23514', null, 'and copying an event counts');
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok(
  $$insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('p2'), 'admin')$$,
  '23514', null, 'so is the service role');

select * from finish();
rollback;
