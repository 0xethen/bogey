begin;
select plan(4);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, visibility) values (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public');
insert into public.event_windows (event_id, key, override) values (tests.u('ev'), 'registration', 'open');
select tests.create_user(tests.u('p'), 'p@t.test', '{"org":"alpha"}');

select is(private.setting_defaults('registration') ->> 'mode', 'invite', 'new events are invite-only by default');
select is(private.event_setting(tests.u('ev'), 'registration') ->> 'mode', 'invite', 'an event that chose nothing is invite-only');

select tests.as_user(tests.u('p'));
select throws_ok($$select public.register_for_event(tests.u('ev'))$$, 'P0001', 'this event is invite-only', 'self-registration is refused');
reset role;

insert into public.settings (scope, event_id, namespace, value) values ('event', tests.u('ev'), 'registration', '{"mode":"open"}');
select is(private.event_setting(tests.u('ev'), 'registration') ->> 'mode', 'open', 'an event keeps the mode it stored');

select * from finish();
rollback;
