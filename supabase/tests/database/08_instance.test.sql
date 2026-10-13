begin;
select plan(14);

select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['root','orgowner','nobody']) n;
delete from public.platform_admins;
insert into public.platform_admins (user_id) values (tests.u('root'));
insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('orgowner'), 'owner');

select tests.as_user(tests.u('root'));
select ok((public.instance_overview() ->> 'orgs')::int >= 1, 'admins see instance counts');
select ok(exists (select 1 from public.instance_orgs() where slug = 'alpha' and members = 1), 'admins list every org with counts');
select is((select owners from public.instance_orgs() where slug = 'alpha'), array['orgowner'], 'with its owners');
select is((select orgs from public.instance_people('orgowner@t') where email = 'orgowner@t.test'), array['Alpha'], 'admins find anyone by email, with their orgs');
select lives_ok($$select public.create_org('beta', 'Beta', 'beta.example.test', 'orgowner@t.test')$$, 'admins create an org with an owner');
select is((select role::text from public.org_members m join public.orgs o on o.id = m.org_id where o.slug = 'beta' and m.user_id = tests.u('orgowner')), 'owner', 'the named account owns it');
select throws_ok($$select public.create_org('gamma', 'Gamma', null, 'ghost@t.test')$$, 'P0002', null, 'an owner must already have an account');
select lives_ok(format('select public.set_org_status(%L, %L)', tests.u('org'), 'suspended'), 'admins suspend an org');
reset role;
select is((select count(*)::int from public.audit_log where action = 'org.suspended' and target_id = tests.u('org')), 1, 'suspending is audited');
select tests.as_user(tests.u('root'));
select lives_ok($$select public.set_platform_admin('nobody@t.test', true)$$, 'admins grant admin');
select lives_ok($$select public.set_platform_admin('nobody@t.test', false)$$, 'and revoke it');
select throws_ok($$select public.set_platform_admin('root@t.test', false)$$, '23514', null, 'the last admin stays');
reset role;

select tests.as_user(tests.u('orgowner'));
select throws_ok($$select public.instance_orgs()$$, '42501', null, 'org owners are not platform admins');
select throws_ok($$select public.instance_people()$$, '42501', null, 'nor can they list people');
reset role;

select * from finish();
rollback;
