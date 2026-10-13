begin;
select plan(48);

select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['root','owner','member','stranger']) n;
delete from public.platform_admins;
insert into public.platform_admins (user_id) values (tests.u('root'));
insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha'), (tests.u('other'), 'beta', 'Beta');
insert into public.org_members (org_id, user_id, role) values
  (tests.u('org'), tests.u('owner'), 'owner'), (tests.u('org'), tests.u('member'), 'member');
insert into public.events (id, org_id, slug, name) values (tests.u('ev'), tests.u('org'), 'ev', 'Ev');
insert into public.org_domains (hostname, org_id, is_primary, verified_at) values
  ('alpha.example.test', tests.u('org'), true, now()), ('beta.example.test', tests.u('other'), true, now());
insert into public.settings (scope, namespace, value) values ('instance', 'limits', '{"eventsPerOrg":1,"emailsPerDay":2}')
on conflict (scope, org_id, event_id, namespace) do update set value = excluded.value;

select is(private.org_limit(tests.u('org'), 'eventsPerOrg'), 1::bigint, 'an org follows the instance limit');
select is(private.org_limit(tests.u('org'), 'storageMbPerOrg'), null, 'and has none where the instance sets none');

select is(private.org_limit(tests.u('org'), 'contest.maxMemoryMb'), null, 'a plugin limit is none until set');
insert into public.settings (scope, namespace, value) values ('instance', 'plugin.contest.limits', '{"maxMemoryMb":512}');
select is(private.org_limit(tests.u('org'), 'contest.maxMemoryMb'), 512::bigint, 'a plugin limit follows the instance''s value');
insert into public.org_limit_overrides (org_id, limits) values (tests.u('org'), '{"contest.maxMemoryMb":128}');
select is(private.org_limit(tests.u('org'), 'contest.maxMemoryMb'), 128::bigint, 'and an org''s override');
delete from public.org_limit_overrides where org_id = tests.u('org');

select tests.as_user(tests.u('owner'));
select throws_ok($$insert into public.events (org_id, slug, name) values (tests.u('org'), 'second', 'Second')$$,
  '23514', null, 'a second event goes over the instance limit');
select throws_ok($$select public.set_org_limits(tests.u('org'), '{"eventsPerOrg": 5}')$$,
  '42501', null, 'org owners can''t change their own limits');
select is((public.org_limits(tests.u('org')) -> 'eventsPerOrg' ->> 'used')::int, 1, 'they can read usage');
select throws_ok($$select public.org_limits(tests.u('other'))$$, '42501', null, 'but not another org''s');
reset role;

select tests.as_user(tests.u('root'));
select lives_ok($$select public.set_org_limits(tests.u('org'), '{"eventsPerOrg": 3}')$$, 'platform admins raise one org''s limit');
select throws_ok($$select public.set_org_limits(tests.u('org'), '{"nonsense": 1}')$$, '22023', null, 'only real limits');
select throws_ok($$select public.set_org_limits(tests.u('org'), '{"eventsPerOrg": -1}')$$, '22023', null, 'and whole numbers');
reset role;
select is(private.org_limit(tests.u('org'), 'eventsPerOrg'), 3::bigint, 'the override wins');
select is(private.org_limit(tests.u('other'), 'eventsPerOrg'), 1::bigint, 'other orgs are unaffected');
select tests.as_user(tests.u('owner'));
select lives_ok($$insert into public.events (org_id, slug, name) values (tests.u('org'), 'second', 'Second')$$,
  'the raised limit lets a second event in');
reset role;
select tests.as_user(tests.u('root'));
select lives_ok($$select public.set_org_limits(tests.u('org'), '{"eventsPerOrg": null}')$$, 'a null override lifts the limit');
reset role;
select is(private.org_limit(tests.u('org'), 'eventsPerOrg'), null, 'no limit for that org');
select is((select count(*)::int from public.audit_log where action = 'org.limits_changed'), 2, 'limit changes are audited');

select tests.as_user(tests.u('root'));
select lives_ok($$select public.set_org_status(tests.u('org'), 'restricted', 'under review')$$, 'admins restrict an org');
reset role;
select is((select status_reason from public.orgs where id = tests.u('org')), 'under review', 'with a reason owners can read');
select tests.as_user(tests.u('owner'));
select is((select status::text from public.orgs where id = tests.u('org')), 'restricted', 'owners see the status');
select throws_ok($$insert into public.events (org_id, slug, name) values (tests.u('org'), 'third', 'Third')$$,
  '42501', null, 'a restricted org can''t add an event');
select throws_ok($$update public.events set name = 'Renamed' where id = tests.u('ev')$$,
  '42501', null, 'or edit one');
select ok(exists (select 1 from public.events where id = tests.u('ev')), 'but its members still read');
reset role;
select tests.as_user(tests.u('root'));
select lives_ok($$update public.events set name = 'Fixed by admin' where id = tests.u('ev')$$, 'platform admins are exempt');
select lives_ok($$select public.set_org_status(tests.u('org'), 'active')$$, 'and lift the restriction');
reset role;
select is((select status_reason from public.orgs where id = tests.u('org')), null, 'which clears the reason');
select tests.as_user(tests.u('owner'));
select lives_ok($$update public.events set name = 'Back' where id = tests.u('ev')$$, 'an active org writes again');
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(public.record_email_send('signIn', tests.u('org')), 'ok', 'the first email is counted');
select is(public.record_email_send('signIn', tests.u('org')), 'ok', 'so is the second');
select is(public.record_email_send('signIn', tests.u('org')), 'limit', 'the third is over the daily limit');
select is(public.record_email_send('signIn', null), 'ok', 'mail with no org isn''t limited');

select tests.as_user(tests.u('root'));
select lives_ok($$select public.set_org_status(tests.u('other'), 'suspended', 'abuse')$$, 'admins suspend an org');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(public.record_email_send('signIn', tests.u('other')), 'suspended', 'a suspended org sends no mail');
select tests.as_user(tests.u('owner'));
select throws_ok($$select public.record_email_send('signIn', tests.u('org'))$$, '42501', null, 'only the hook records sends');
reset role;
select tests.as_user(tests.u('root'));
select ok((public.email_hook_status() ->> 'last24h')::int >= 3, 'platform admins see the hook''s recent mail');
reset role;
select tests.as_user(tests.u('owner'));
select throws_ok($$select public.email_hook_status()$$, '42501', null, 'org owners don''t');
reset role;

select tests.as_anon();
select is((select count(*)::int from public.org_for_host('beta.example.test')), 0, 'a suspended org''s host resolves to no org');
select is((select name from public.suspended_org_for_host('beta.example.test')), 'Beta', 'but says who is suspended');
select is((select reason from public.suspended_org_for_host('beta.example.test')), 'abuse', 'and why');
select is((select count(*)::int from public.suspended_org_for_host('alpha.example.test')), 0, 'an active org isn''t reported suspended');
reset role;
select tests.as_user(tests.u('root'));
select lives_ok($$select public.set_org_status(tests.u('org'), 'restricted', null)$$, 'restrict an org again');
reset role;
select is((select status::text from public.org_for_host('alpha.example.test')), 'restricted', 'a restricted org still resolves, with its status');

select tests.as_anon();
select lives_ok($$select public.report_page(tests.u('org'), '/gallery/ev', 'spam')$$, 'anyone can report a public page');
select throws_ok($$select public.instance_reports()$$, '42501', null, 'but reading reports is for platform admins');
reset role;
select tests.as_user(tests.u('root'));
select is((select count(*)::int from public.instance_reports() where path = '/gallery/ev'), 1, 'admins see it with its org');
select lives_ok(format('select public.set_report_handled(%L, true)', (select id from public.instance_reports() limit 1)), 'and close it');
select is((select count(*)::int from public.instance_reports()), 0, 'closed reports leave the open list');
reset role;

select * from finish();
rollback;
