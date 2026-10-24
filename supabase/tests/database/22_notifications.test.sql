begin;
select plan(37);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha'), (tests.u('other'), 'beta', 'Beta');
insert into public.events (id, org_id, slug, name, visibility) values
  (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public'),
  (tests.u('ev2'), tests.u('other'), 'ev2', 'Ev2', 'public');
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','p1','p2','p3','stranger','own2']) n;
insert into public.org_members (org_id, user_id, role) values
  (tests.u('org'), tests.u('own'), 'owner'), (tests.u('other'), tests.u('own2'), 'owner');
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('p1'), 'participant'), (tests.u('ev'), tests.u('p2'), 'participant'),
  (tests.u('ev'), tests.u('p3'), 'participant'), (tests.u('ev2'), tests.u('stranger'), 'participant');

select is(private.notification_kind('registration.approved') ->> 'transactional', 'true', 'the registry reaches SQL');
select is(private.notification_kind('someplugin.thing'), null, 'an extension''s kind is unknown to it');

select is(private.notify(array[tests.u('p1'), tests.u('p2')], tests.u('ev'), 'registration.approved', 'You''re in', '', '/events/ev'), 2, 'notify counts the bell rows it wrote');
select is((select count(*)::integer from public.email_outbox where kind = 'registration.approved' and event_id = tests.u('ev')), 2, 'and queues the transactional emails');
select is((select vars ->> 'event' from public.email_outbox where user_id = tests.u('p1') limit 1), 'Ev', 'with the event name for the template');
select is((select to_email from public.email_outbox where user_id = tests.u('p1') limit 1), 'p1@t.test', 'to the account''s address');

insert into public.user_preferences (user_id, namespace, key, value) values
  (tests.u('p1'), 'notifications', 'channels',
   '{"registration.approved":{"email":false,"inApp":false},"judging.assigned":{"email":false}}');
select is(private.notify(array[tests.u('p1')], tests.u('ev'), 'registration.approved', 'Again', '', null), 0, 'a person can turn the bell off for a kind');
select is((select count(*)::integer from public.email_outbox where user_id = tests.u('p1') and kind = 'registration.approved'), 2, 'but a transactional email still goes out');

select private.notify(array[tests.u('p1'), tests.u('p2')], tests.u('ev'), 'judging.assigned', 'Judge these', '', null);
select is((select count(*)::integer from public.email_outbox where kind = 'judging.assigned' and event_id = tests.u('ev')), 1, 'an opt-out stops a non-transactional email; the other person still gets theirs');

select private.notify(array[tests.u('p3')], tests.u('ev'), 'team.joined', 'Hi', '', null);
select is((select count(*)::integer from public.email_outbox where kind = 'team.joined' and event_id = tests.u('ev')), 0, 'a kind that is in-app only by default sends no email');
select private.notify(array[tests.u('p3')], tests.u('ev'), 'team.joined', 'Hi', '', null, '{}', true);
select is((select count(*)::integer from public.email_outbox where kind = 'team.joined' and event_id = tests.u('ev')), 1, 'the sender can ask for the email');
select private.notify(array[tests.u('p1'), tests.u('p3')], tests.u('ev'), 'team.joined', 'Hi', '', null, '{}', false);
select is((select count(*)::integer from public.email_outbox where kind = 'team.joined' and event_id = tests.u('ev')), 1, 'or for none');
select private.notify(array[tests.u('p1')], tests.u('ev'), 'judging.assigned', 'Forced', '', null, '{}', true);
select is((select count(*)::integer from public.email_outbox where kind = 'judging.assigned' and event_id = tests.u('ev')), 1, 'an explicit opt-out beats the sender''s request');

select throws_ok($$select private.notify(array[tests.u('p1')], tests.u('ev'), 'x', 'Bad link', '', 'https://evil.test')$$, '23514', null, 'a link must be a path in this app');
select throws_ok($$select private.notify(array[tests.u('p1')], tests.u('ev'), 'x', 'Bad link', '', '//evil.test')$$, '23514', null, 'including a protocol-relative one');

select tests.as_user(tests.u('p1'));
select ok((select count(*) from public.notifications) > 0, 'a person reads their notifications');
select is((select count(*)::integer from public.notifications where user_id <> tests.u('p1')), 0, 'and nobody else''s');
select lives_ok($$update public.notifications set read_at = now() where read_at is null$$, 'they mark them read');
select throws_ok($$update public.notifications set title = 'Changed'$$, '42501', null, 'but nothing else about one changes');
select throws_ok($$insert into public.notifications (user_id, org_id, kind, title) values (tests.u('p1'), tests.u('org'), 'x.y', 'Self')$$, '42501', null, 'and they can''t write their own');
reset role;
select tests.as_user(tests.u('stranger'));
select is((select count(*)::integer from public.notifications where event_id = tests.u('ev')), 0, 'a member of another org sees none of them');
select is((select count(*)::integer from public.email_outbox), 0, 'the outbox has no client policy');
reset role;

insert into public.settings (scope, event_id, namespace, value) values ('event', tests.u('ev'), 'plugins', '{"enabled":["myplug"]}');
select tests.as_user(tests.u('own'));
select is(public.notify_event(tests.u('ev'), 'myplug', 'ping', array[tests.u('p1'), tests.u('p2'), tests.u('stranger')], 'Ping', 'Hello', '/events/ev', 'event.manage'), 2, 'an organizer notifies event members, and only them');
select is((select count(*)::integer from public.audit_log where event_id = tests.u('ev') and action = 'myplug.notified'), 1, 'and it is audited under the plugin');
select throws_ok($$select public.notify_event(tests.u('ev'), 'myplug', 'ping', array[tests.u('p1')], 'x', '', null, 'event.view')$$, '22023', null, 'the permission has to be the plugin''s own or event.manage');
select throws_ok($$select public.notify_event(tests.u('ev'), 'otherplug', 'ping', array[tests.u('p1')], 'x', '', null, 'event.manage')$$, '42501', null, 'a plugin that is off for the event can''t notify');
reset role;
select tests.as_user(tests.u('p1'));
select throws_ok($$select public.notify_event(tests.u('ev'), 'myplug', 'ping', array[tests.u('p2')], 'x', '', null, 'myplug.ping')$$, '42501', null, 'a participant without the permission can''t');
reset role;
select is((select count(*)::integer from public.notifications where kind = 'myplug.ping' and user_id = tests.u('p1')), 1, 'the bell row has the namespaced kind');
select is((select kind from public.email_outbox where vars ->> 'kind' = 'myplug.ping' limit 1), null, 'and no email unless asked');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is((select count(*)::integer from public.email_outbox_claim(2)), 2, 'the app claims a batch');
select is((select count(*)::integer from public.email_outbox where status = 'sending'), 2, 'claimed rows are leased');
select lives_ok($$select public.email_outbox_finish((select min(id) from public.email_outbox), 'sent')$$, 'finishing one marks it sent');
select lives_ok($$select public.email_outbox_finish((select max(id) from public.email_outbox where status = 'sending'), 'retry', 'SMTP down', 1)$$, 'a retry past the attempt cap');
select is((select status from public.email_outbox where last_error = 'SMTP down'), 'failed', 'gives up');
select tests.as_user(tests.u('own'));
select throws_ok($$select * from public.email_outbox_claim(1)$$, '42501', null, 'people can''t drain the outbox');
select throws_ok($$select public.email_drain_secret()$$, '42501', null, 'or read the drain secret');
reset role;
-- a dev database may have one set
update public.settings set value = value - 'appUrl' where scope = 'instance' and namespace = 'tenancy';
select is(private.drain_email_outbox(), 0, 'with no app address, the database waits');

select * from finish();
rollback;
