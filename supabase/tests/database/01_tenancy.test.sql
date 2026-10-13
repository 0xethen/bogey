begin;
select plan(30);

insert into public.orgs (id, slug, name) values (tests.u('a'), 'alpha', 'Alpha'), (tests.u('b'), 'beta', 'Beta');
insert into public.org_domains (hostname, org_id, is_primary) values ('alpha.bogey.test', tests.u('a'), true);
insert into public.settings (scope, namespace, value) values ('instance', 'tenancy', jsonb_build_object('defaultOrg', tests.u('b')))
  on conflict (scope, org_id, event_id, namespace) do update set value = excluded.value;
select tests.create_user(tests.u('a1'), 'ann@alpha.test');
select tests.create_user(tests.u('b1'), 'bob@beta.test');
insert into public.org_members (org_id, user_id, role) values (tests.u('a'), tests.u('a1'), 'owner'), (tests.u('b'), tests.u('b1'), 'owner');
insert into public.events (id, org_id, slug, name, visibility) values
  (tests.u('ae1'), tests.u('a'), 'alpha-public', 'Alpha Public', 'public'),
  (tests.u('ae2'), tests.u('a'), 'alpha-draft', 'Alpha Draft', 'draft'),
  (tests.u('be1'), tests.u('b'), 'beta-unlisted', 'Beta Unlisted', 'unlisted');
insert into public.settings (scope, org_id, namespace, value) values
  ('org', tests.u('a'), 'branding', '{"name":"Alpha Co"}'),
  ('org', tests.u('a'), 'audit', '{"retentionDays":30}');

select is((select id from public.org_for_host('alpha.bogey.test')), tests.u('a'), 'host resolves to its org');
select is((select id from public.org_for_host('unknown.example')), tests.u('b'), 'unknown host falls back to tenancy.defaultOrg');
select is((select id from public.org_for_host('alpha.bogey.test:3000')), tests.u('a'), 'a port falls back to the bare hostname');

select tests.as_user(tests.u('a1'));
select is((public.create_event(tests.u('a'), 'new-hack', 'New Hack', 'hackathon', 'America/New_York')).slug::text, 'new-hack', 'org admin creates an event');
select is((select count(*)::int from public.event_windows w join public.events e on e.id = w.event_id where e.slug = 'new-hack'), 7, 'a hackathon starts with its windows');
select throws_ok($$select public.remove_window((select id from public.events where slug = 'new-hack'), 'submissions')$$, '23503', null, 'a window a form opens with stays');
select lives_ok($$select public.remove_window((select id from public.events where slug = 'new-hack'), 'teams')$$, 'organizers remove an unused window');
select is((select count(*)::int from public.event_windows w join public.events e on e.id = w.event_id where e.slug = 'new-hack'), 6, 'and it is gone');
select throws_ok($$select public.create_event(tests.u('b'), 'x-hack', 'X', 'hackathon', 'UTC')$$, '42501', null, 'no events in another org');
select is((public.create_event(tests.u('a'), 'new-contest', 'New Contest', 'contest', 'UTC', p_plugin => 'challenges')).slug::text, 'new-contest', 'an event can start with an org-scoped plugin');
select is((select value -> 'enabled' from public.settings where scope = 'event' and event_id = (select id from public.events where slug = 'new-contest') and namespace = 'plugins'), '["challenges"]'::jsonb, 'and has it switched on');
select throws_ok($$select public.create_event(tests.u('a'), 'bad-plugin', 'Bad', 'custom', 'UTC', p_plugin => 'Not A Key')$$, '22023', null, 'a plugin must be a key');
insert into public.settings (scope, org_id, namespace, value) values ('org', tests.u('a'), 'plugins', '{"available":["other"]}');
select throws_ok($$select public.create_event(tests.u('a'), 'not-offered', 'Not offered', 'contest', 'UTC', p_plugin => 'challenges')$$, '42501', null, 'an org that does not offer the plugin cannot create its events');
select results_eq($$select slug::text from public.events where org_id in (tests.u('a'), tests.u('b')) order by slug$$, array['alpha-draft', 'alpha-public', 'new-contest', 'new-hack'], 'alpha owner sees only alpha events');
select is_empty($$select 1 from public.org_members where org_id = tests.u('b')$$, 'alpha owner cannot list beta members');
select is_empty($$select 1 from public.profiles where id = tests.u('b1')$$, 'alpha owner cannot read beta profiles');
select throws_ok($$insert into public.events (org_id, slug, name) values (tests.u('b'), 'sneaky', 'Sneaky')$$, '42501', null, 'cannot create events in another org');
select is_empty($$update public.events set name = 'pwned' where id = tests.u('be1') returning 1$$, 'cannot update another org''s event');
select is_empty($$select 1 from public.settings where org_id = tests.u('b')$$, 'cannot read beta settings');
select throws_ok($$select public.log_event(tests.u('be1'), 'ac.blur')$$, '42501', null, 'cannot write another org''s audit log');
select throws_ok($$insert into public.orgs (slug, name) values ('mine', 'Mine')$$, '42501', null, 'only platform admins create orgs');
select throws_ok($$update public.events set org_id = tests.u('b') where id = tests.u('ae1')$$, '23514', null, 'events never move between orgs');
reset role;

select tests.as_user(tests.u('b1'));
select throws_ok($$select public.remove_window((select id from public.events where slug = 'alpha-public'), 'teams')$$, '42501', null, 'no removing another org''s windows');
select results_eq($$select slug::text from public.events where org_id in (tests.u('a'), tests.u('b')) order by slug$$, array['alpha-public', 'beta-unlisted'], 'beta owner sees beta events plus public ones');
select is_empty($$select 1 from public.audit_log where org_id = tests.u('a')$$, 'beta owner cannot read alpha audit log');
reset role;

select tests.as_anon();
select results_eq($$select slug::text from public.events where org_id in (tests.u('a'), tests.u('b'))$$, array['alpha-public'], 'anon sees public events only');
select results_eq($$select namespace from public.settings where org_id = tests.u('a')$$, array['branding'], 'anon sees only public setting namespaces');
select is_empty('select 1 from public.org_members', 'anon sees no memberships');
reset role;

select tests.as_user(tests.u('a1'));
select throws_ok($$delete from public.org_members where user_id = tests.u('a1')$$, '23514', null, 'the last owner cannot leave');
reset role;
select is((select count(*)::int from public.orgs where id in (tests.u('a'), tests.u('b'))), 2, 'fixtures intact');

select * from finish();
rollback;
