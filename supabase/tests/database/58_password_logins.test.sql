begin;
select plan(11);

select tests.create_user(tests.u(n), n || '@pw.test') from unnest(array['boss','pat','sam']) n;
insert into public.platform_admins (user_id) values (tests.u('boss')) on conflict do nothing;

select tests.as_user(tests.u('pat'));
select throws_ok($$select public.set_password_login(tests.u('sam'), true)$$, '42501', null, 'only platform admins turn on password sign-in');
reset role;

update auth.users set encrypted_password = 'hash' where id = tests.u('sam');
select is((select encrypted_password from auth.users where id = tests.u('sam')), null, 'without password sign-in, a password is stripped');

select set_config('request.jwt.claims', json_build_object('sub', tests.u('boss'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select tests.as_user(tests.u('boss'));
select lives_ok($$select public.set_password_login(tests.u('pat'), true)$$, 'a platform admin turns it on');
select is((select password_login from public.instance_people('pat@pw.test') where id = tests.u('pat')), true, 'the people list says so');
reset role;

update auth.users set encrypted_password = 'hash' where id = tests.u('pat');
select is((select encrypted_password from auth.users where id = tests.u('pat')), 'hash', 'with it, the password is kept');

select set_config('request.jwt.claims', json_build_object('sub', tests.u('boss'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select tests.as_user(tests.u('boss'));
select lives_ok($$select public.set_password_login(tests.u('pat'), false)$$, 'and turns it off');
reset role;
select is((select encrypted_password from auth.users where id = tests.u('pat')), null, 'which clears the password');

select tests.as_user(tests.u('boss'));
select throws_ok($$select public.set_password_login(tests.u('boss'), true)$$, '22023', null, 'instance admins manage their own password');
reset role;
select is((select count(*)::integer from public.instance_audit where target_id = tests.u('pat')), 2, 'turning it on and off is recorded');
select tests.as_user(tests.u('pat'));
select throws_ok($$select public.end_my_session(gen_random_uuid())$$, '42501', null, 'signing out one device is off by default');
reset role;
insert into public.settings (scope, namespace, value) values ('instance', 'accounts', '{"deviceSignOut": true}')
  on conflict (scope, org_id, event_id, namespace)
  do update set value = public.settings.value || excluded.value;
select tests.as_user(tests.u('pat'));
select is(public.end_my_session(gen_random_uuid()), false, 'once the operator allows it, a session that isn''t yours is left alone');
reset role;

select * from finish();
rollback;
