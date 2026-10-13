begin;
select plan(26);

insert into public.orgs (id, slug, name) values (tests.u('a'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, visibility) values (tests.u('e1'), tests.u('a'), 'hack', 'Hack', 'public');
insert into public.event_windows (event_id, key, override) values (tests.u('e1'), 'registration', 'open');
insert into public.onboarding_forms (event_id, fields) values
  (tests.u('e1'), '[{"key":"school","label":"School","kind":"text","required":true}]');
insert into public.invite_links (id, event_id, token, auto_approve, capacity) values
  (tests.u('l1'), tests.u('e1'), 'tok-auto', true, 1);

select is(private.before_user_created('{"user":{"email":"x@y.test","user_metadata":{"org":"alpha"},"app_metadata":{}}}') -> 'error' ->> 'http_code', '403', 'invite-only org rejects unknown emails');
select is(private.before_user_created('{"user":{"email":"new@y.test","user_metadata":{"org":"alpha","invite":"tok-auto"},"app_metadata":{}}}'), '{}'::jsonb, 'an open invite link token lets a new address sign up');
insert into public.registrations (event_id, email, source, status) values (tests.u('e1'), 'imported@y.test', 'import', 'approved');
select is(private.before_user_created('{"user":{"email":"imported@y.test","user_metadata":{"org":"alpha"},"app_metadata":{}}}'), '{}'::jsonb, 'an imported email may sign up');
select is(private.before_user_created('{"user":{"email":"z@y.test","user_metadata":{"org":"nope"},"app_metadata":{}}}') -> 'error' ->> 'http_code', '403', 'unknown org is rejected');
insert into public.settings (scope, org_id, namespace, value) values ('org', tests.u('a'), 'registration', '{"signup":"open"}');
select is(private.before_user_created('{"user":{"email":"x@y.test","user_metadata":{"org":"alpha"},"app_metadata":{}}}'), '{}'::jsonb, 'open org accepts anyone');

select tests.create_user(tests.u('p1'), 'imported@y.test', '{"org":"alpha","full_name":"Imp Orted"}');
select is((select role::text from public.event_members where user_id = tests.u('p1')), 'participant', 'approved import becomes a participant on sign-up');
select is((select display_name from public.profiles where id = tests.u('p1')), 'Imp Orted', 'profile uses full_name');
select ok(exists (select 1 from public.org_members where user_id = tests.u('p1') and org_id = tests.u('a')), 'and an org member');
select is((select encrypted_password from auth.users where id = tests.u('p1')), null, 'passwords are stripped');

select tests.create_user(tests.u('p2'), 'self@y.test', '{"org":"alpha"}');
select tests.as_user(tests.u('p2'));
select throws_ok($$select public.register_for_event(tests.u('e1'), '{}')$$, '23502', null, 'required answers are enforced');
select is((public.register_for_event(tests.u('e1'), '{"school":"GHS"}')).status::text, 'pending', 'review mode leaves self-registration pending');
select is_empty($$select 1 from public.event_members where user_id = tests.u('p2')$$, 'pending registration is not membership');
reset role;

select tests.create_user(tests.u('p3'), 'link@y.test', '{"org":"alpha"}');
select tests.create_user(tests.u('p4'), 'late@y.test', '{"org":"alpha"}');
select tests.as_user(tests.u('p3'));
select is((public.register_for_event(tests.u('e1'), '{"school":"GHS"}', 'tok-auto')).status::text, 'approved', 'auto-approve link approves');
reset role;
select tests.as_user(tests.u('p4'));
select throws_ok($$select public.register_for_event(tests.u('e1'), '{"school":"GHS"}', 'tok-auto')$$, 'P0001', null, 'full link is closed');
select is_empty($$select 1 from public.registrations where user_id = tests.u('p3')$$, 'participants cannot read others'' registrations');
reset role;

select tests.create_user(tests.u('j1'), 'judge@y.test');
insert into public.event_members (event_id, user_id, role) values (tests.u('e1'), tests.u('j1'), 'judge');
select tests.as_user(tests.u('j1'));
select ok(private.has_permission(tests.u('e1'), 'judging.score'), 'judge can score');
select ok(not private.has_permission(tests.u('e1'), 'event.compete'), 'judge cannot compete');
select ok(not private.has_permission(tests.u('e1'), 'checkin.mark'), 'judge cannot check people in');
reset role;
insert into public.roles (key, label, source) values ('checkin.desk', 'Desk', 'checkin');
insert into public.role_permissions (role_key, permission) values ('checkin.desk', 'checkin.mark');
insert into public.event_role_grants (event_id, user_id, role_key) values (tests.u('e1'), tests.u('j1'), 'checkin.desk');
select tests.as_user(tests.u('j1'));
select ok(private.has_permission(tests.u('e1'), 'checkin.mark'), 'a plugin role grant adds its permissions');
select is_empty($$update public.event_members set role = 'organizer' where user_id = tests.u('j1') returning 1$$, 'members cannot promote themselves');
reset role;

insert into public.registrations (event_id, email, source, role, status) values (tests.u('e1'), 'newjudge@y.test', 'invite', 'judge', 'approved');
select tests.create_user(tests.u('j2'), 'newjudge@y.test', '{"org":"alpha"}');
select is((select role::text from public.event_members where user_id = tests.u('j2')), 'judge', 'an approved judge invite becomes a judge on sign-up');
select tests.as_user(tests.u('p2'));
select is((public.register_for_event(tests.u('e1'), '{"school":"GHS"}')).role::text, 'participant', 'self-registration is always participant');
reset role;

select tests.as_user(tests.u('p3'));
select lives_ok($$select public.complete_identity_setup(tests.u('e1'))$$, 'a member finishes identity setup');
select isnt((select identity_setup_at from public.event_members where user_id = tests.u('p3')), null, 'identity_setup_at is set');
reset role;
select tests.as_user(tests.u('p2'));
select throws_ok($$select public.complete_identity_setup(tests.u('e1'))$$, '42501', null, 'someone still pending cannot onboard');
reset role;

update public.registrations set status = 'rejected' where user_id = tests.u('p1');
select is((select status::text from public.event_members where user_id = tests.u('p1')), 'removed', 'un-approving removes the participant');

select * from finish();
rollback;
