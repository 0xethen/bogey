begin;
select plan(9);

select tests.create_user(tests.u('root'), 'root@t.test');
delete from public.platform_admins;
insert into public.platform_admins (user_id) values (tests.u('root'));
delete from public.settings where scope = 'instance' and namespace in ('network', 'accounts', 'tenancy');
insert into public.settings (scope, namespace, value) values
  ('instance', 'network', '{"trustedProxies":["10.0.0.0/8"]}'),
  ('instance', 'accounts', '{"requireAdminMfa":true}');

select tests.as_user(tests.u('root'));
select throws_ok(
  $$update public.settings set value = '{"trustedProxies":["0.0.0.0/0"]}'
    where scope = 'instance' and namespace = 'network'$$,
  '42501', null, 'an admin session can''t widen the trusted proxies');
select throws_ok(
  $$update public.settings set value = '{"requireAdminMfa":false}'
    where scope = 'instance' and namespace = 'accounts'$$,
  '42501', null, 'or turn off the second factor for admins');
select throws_ok(
  $$insert into public.settings (scope, namespace, value)
    values ('instance', 'tenancy', '{"appUrl":"http://169.254.169.254"}')$$,
  '42501', null, 'or point the database''s outgoing calls somewhere else');
select throws_ok(
  $$delete from public.settings where scope = 'instance' and namespace = 'network'$$,
  '42501', null, 'or clear them by deleting the row');
select lives_ok(
  $$update public.settings set value = '{"requireAdminMfa":true,"portfolios":true}'
    where scope = 'instance' and namespace = 'accounts'$$,
  'the other keys in the namespace stay editable');
select is(
  (select count(*)::int from public.settings where scope = 'instance' and namespace = 'network'),
  1, 'admins can read the network settings');
reset role;

select tests.as_anon();
select is(
  (select count(*)::int from public.settings where scope = 'instance' and namespace = 'network'),
  0, 'visitors can''t');
select is(
  (select count(*)::int from public.settings where scope = 'instance' and namespace = 'accounts'),
  1, 'but still read the instance''s other settings');
reset role;

set local role service_role;
select lives_ok(
  $$update public.settings set value = '{"trustedProxies":["10.1.0.0/16"]}'
    where scope = 'instance' and namespace = 'network'$$,
  'the service role (bogey.config.ts and the CLI) can change them');
reset role;

select * from finish();
rollback;
