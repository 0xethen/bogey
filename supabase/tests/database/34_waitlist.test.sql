begin;
select plan(18);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max)
values (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public', 1, 4);
insert into public.event_windows (event_id, key, override) values (tests.u('ev'), 'registration', 'open');
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','a','b','c','d']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner');
insert into public.settings (scope, event_id, namespace, value)
values ('event', tests.u('ev'), 'registration', '{"mode":"open","capacity":1}');

select tests.as_user(tests.u('a'));
select is((select status::text from public.register_for_event(tests.u('ev'))), 'approved', 'the first registration takes the only place');
reset role;
select tests.as_user(tests.u('b'));
select is((select status::text from public.register_for_event(tests.u('ev'))), 'waitlisted', 'the next one waits');
reset role;
select tests.as_user(tests.u('c'));
select is((select status::text from public.register_for_event(tests.u('ev'))), 'waitlisted', 'and so does the one after');
select is((select count(*)::integer from public.notifications where user_id = tests.u('c') and kind = 'registration.waitlisted'), 1, 'who is told');
reset role;
select is((select count(*)::integer from public.notifications where user_id = tests.u('a') and kind = 'registration.approved'), 1, 'and the first person is told they are in');

update public.registrations set created_at = created_at - interval '1 minute' where event_id = tests.u('ev') and user_id = tests.u('b');
select tests.as_user(tests.u('a'));
select lives_ok($$select public.withdraw_registration(tests.u('ev'))$$, 'the first person withdraws');
reset role;
select is((select status::text from public.registrations where event_id = tests.u('ev') and user_id = tests.u('b')), 'approved', 'the person waiting longest moves in');
select is((select status::text from public.registrations where event_id = tests.u('ev') and user_id = tests.u('c')), 'waitlisted', 'the next keeps waiting');
select ok(exists (select 1 from public.event_members where event_id = tests.u('ev') and user_id = tests.u('b') and status = 'active'), 'and is a member');
select is((select count(*)::integer from public.audit_log where event_id = tests.u('ev') and action = 'registration.promoted'), 1, 'the move is audited');

update public.settings set value = '{"mode":"open","capacity":2}' where event_id = tests.u('ev') and namespace = 'registration';
select is((select status::text from public.registrations where event_id = tests.u('ev') and user_id = tests.u('c')), 'approved', 'raising the limit fills the places');

update public.settings set value = '{"mode":"open","capacity":2,"autoPromote":false}' where event_id = tests.u('ev') and namespace = 'registration';
select tests.as_user(tests.u('d'));
select is((select status::text from public.register_for_event(tests.u('ev'))), 'waitlisted', 'a full event waitlists again');
reset role;
select tests.as_user(tests.u('b'));
select lives_ok($$select public.withdraw_registration(tests.u('ev'))$$, 'someone leaves');
reset role;
select is((select status::text from public.registrations where event_id = tests.u('ev') and user_id = tests.u('d')), 'waitlisted', 'nobody moves up when that is off');

select tests.as_user(tests.u('d'));
select throws_ok($$select public.review_registrations(tests.u('ev'), array[]::uuid[], 'approved')$$, '42501', null, 'participants can''t review');
reset role;
select tests.as_user(tests.u('own'));
select is(public.review_registrations(tests.u('ev'), array[(select id from public.registrations where event_id = tests.u('ev') and user_id = tests.u('d'))], 'approved', 'Welcome!'), 1, 'an organizer approves from the waitlist');
select throws_ok($$select public.review_registrations(tests.u('ev'), array[]::uuid[], 'withdrawn')$$, '22023', null, 'only approve or decline');
reset role;
select is((select body_md from public.notifications where user_id = tests.u('d') and kind = 'registration.approved'), 'Welcome!', 'the note reaches the person');

select * from finish();
rollback;
