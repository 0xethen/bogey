begin;
select plan(11);

select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['root','nobody']) n;
delete from public.platform_admins;
insert into public.platform_admins (user_id) values (tests.u('root'));
delete from public.settings where scope = 'instance' and namespace = 'accounts';

select tests.as_user(tests.u('root'));
select lives_ok($$select public.instance_overview()$$, 'an admin with a second factor is an admin');
select is((public.admin_mfa_status() ->> 'aal'), 'aal2', 'and the status says so');
reset role;

select tests.as_user(tests.u('root'), 'aal1');
select throws_ok($$select public.instance_overview()$$, '42501', null, 'without one, the database doesn''t treat them as an admin');
select throws_ok($$select public.create_org('x', 'X')$$, '42501', null, 'in any admin function');
select is((public.admin_mfa_status() ->> 'admin')::boolean, true, 'though the status shows they hold the role');
select is((public.admin_mfa_status() ->> 'required')::boolean, true, 'that a second factor is required');
select is((public.admin_mfa_status() ->> 'aal'), 'aal1', 'and where this session stands');
reset role;

insert into public.settings (scope, namespace, value) values ('instance', 'accounts', '{"requireAdminMfa": false}');
select tests.as_user(tests.u('root'), 'aal1');
select lives_ok($$select public.instance_overview()$$, 'with the requirement off, the role is enough');
reset role;

select tests.as_user(tests.u('nobody'));
select throws_ok($$select public.instance_overview()$$, '42501', null, 'no second factor makes anyone else an admin');
select is((public.admin_mfa_status() ->> 'admin')::boolean, false, 'the status shows they aren''t one');
reset role;

delete from public.settings where scope = 'instance' and namespace = 'accounts';
select tests.as_user(tests.u('root'), 'aal1');
select throws_ok($$select public.instance_overview()$$, '42501', null, 'removing the setting brings the requirement back');
reset role;

select * from finish();
rollback;
