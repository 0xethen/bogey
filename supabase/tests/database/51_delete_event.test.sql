begin;
select plan(8);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'del-org', 'Del Org');
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['owner','organizer','p1']) n;
insert into public.org_members (org_id, user_id, role) values
  (tests.u('org'), tests.u('owner'), 'owner'), (tests.u('org'), tests.u('organizer'), 'member');
insert into public.events (id, org_id, slug, name) values (tests.u('ev'), tests.u('org'), 'doomed', 'Doomed');
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('organizer'), 'organizer'), (tests.u('ev'), tests.u('p1'), 'participant');
insert into storage.objects (bucket_id, name) values ('event-assets', tests.u('ev') || '/logo.png');

select tests.as_user(tests.u('organizer'));
select throws_ok($$select public.delete_event(tests.u('ev'), 'doomed')$$,
  '42501', null, 'event organizers who aren''t org admins can''t delete it');
reset role;

select tests.as_user(tests.u('owner'));
select throws_ok($$select public.delete_event(tests.u('ev'), 'Doomed event')$$,
  '22023', null, 'the web address has to be typed');
select is(public.delete_event(tests.u('ev'), 'doomed') -> 0 ->> 'bucket', 'event-assets',
  'org admins delete it and get its files back');
reset role;

select is((select count(*) from public.events where id = tests.u('ev')), 0::bigint, 'the event is gone');
select is((select count(*) from public.event_members where event_id = tests.u('ev')), 0::bigint,
  'and its members');
select is((select action from public.audit_log where org_id = tests.u('org') and target_id = tests.u('ev')),
  'event.deleted', 'the org audit keeps a record');
select throws_ok($$select public.delete_event(tests.u('ev'), 'doomed')$$,
  '42501', null, 'a missing event looks the same as a forbidden one');

insert into public.events (id, org_id, slug, name) values (tests.u('ev2'), tests.u('org'), 'cli', 'Cli');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select lives_ok($$select public.delete_event(tests.u('ev2'), 'cli')$$, 'the CLI deletes with the service key');

select * from finish();
rollback;
