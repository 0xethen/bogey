begin;
select plan(6);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name) values (tests.u('ev'), tests.u('org'), 'ev', 'Ev');
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['owner','organizer','member']) n;
insert into public.org_members (org_id, user_id, role) values
  (tests.u('org'), tests.u('owner'), 'owner'), (tests.u('org'), tests.u('member'), 'member');
insert into public.event_members (event_id, user_id, role) values (tests.u('ev'), tests.u('organizer'), 'organizer');
delete from public.settings where namespace = 'submissions';
insert into public.settings (scope, namespace, value, locked_keys) values ('instance', 'submissions', '{"deletion":"request"}', '{deletion}');
insert into public.settings (scope, org_id, namespace, value) values ('org', tests.u('org'), 'submissions', '{"autoSubmit":true}');

select tests.as_user(tests.u('owner'));
select is(public.inherited_settings('org', 'submissions', tests.u('org')) -> 'defaults' ->> 'deletion', 'allow', 'defaults come from the registry');
select is(public.inherited_settings('org', 'submissions', tests.u('org')) -> 'instance' ->> 'deletion', 'request', 'orgs see the instance value');
select is(public.inherited_settings('org', 'submissions', tests.u('org')) -> 'instanceLocked', '["deletion"]'::jsonb, 'and its locks');
reset role;

select tests.as_user(tests.u('organizer'));
select is(public.inherited_settings('event', 'submissions', null, tests.u('ev')) -> 'org' ->> 'autoSubmit', 'true', 'event organizers see the org value');
reset role;

select tests.as_user(tests.u('member'));
select throws_ok(format('select public.inherited_settings(%L, %L, %L)', 'org', 'submissions', tests.u('org')), '42501', null, 'members who can''t edit can''t ask');
reset role;

insert into public.settings (scope, event_id, namespace, value) values ('event', tests.u('ev'), 'submissions', '{"deletion":"allow"}');
select is(private.event_setting(tests.u('ev'), 'submissions') ->> 'deletion', 'request', 'a locked instance key wins');

select * from finish();
rollback;
