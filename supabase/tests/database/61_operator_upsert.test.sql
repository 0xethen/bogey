begin;
select plan(3);

select tests.create_user(tests.u('admin'), 'admin@t.test');
insert into public.platform_admins (user_id) values (tests.u('admin'));
delete from public.settings where scope = 'instance' and namespace = 'tenancy';
insert into public.settings (scope, namespace, value) values ('instance', 'tenancy', '{"appUrl":"https://app.t.test"}');
insert into public.orgs (id, slug, name) values (tests.u('org'), 'upsert-org', 'Upsert');

select tests.as_user(tests.u('admin'));
-- what saving one setting sends: the whole row, upserted
select lives_ok($$
  insert into public.settings (scope, namespace, value)
  values ('instance', 'tenancy', jsonb_build_object('appUrl', 'https://app.t.test', 'defaultOrg', tests.u('org')))
  on conflict (scope, org_id, event_id, namespace) do update set value = excluded.value
$$, 'an upsert that keeps an operator key saves the rest');
select is((select value ->> 'defaultOrg' from public.settings where scope = 'instance' and namespace = 'tenancy'),
  tests.u('org')::text, 'the default organization changed');
select throws_ok($$
  insert into public.settings (scope, namespace, value)
  values ('instance', 'tenancy', '{"appUrl":"https://elsewhere.t.test"}')
  on conflict (scope, org_id, event_id, namespace) do update set value = excluded.value
$$, '42501', null, 'an upsert that changes one is still refused');

select * from finish();
rollback;
