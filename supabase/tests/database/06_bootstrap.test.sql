begin;
select plan(8);

select tests.create_user(tests.u('owner'), 'owner@t.test');
select set_config('role', 'service_role', true);
select lives_ok($$select public.bogey_bootstrap('acme', 'Acme', 'acme.localhost', tests.u('owner'))$$, 'bootstrap runs');
select lives_ok($$select public.bogey_seed_demo((select id from public.orgs where slug = 'acme'))$$, 'seed runs');
select lives_ok($$select public.bogey_seed_demo((select id from public.orgs where slug = 'acme'))$$, 'seed is repeatable');
reset role;

select is((select id from public.org_for_host('acme.localhost')), (select id from public.orgs where slug = 'acme'), 'host maps to the org');
select is((select id from public.org_for_host('anything.else')), (select id from public.orgs where slug = 'acme'), 'and it is the default org');
select is((select count(*)::int from public.events e join public.orgs o on o.id = e.org_id where o.slug = 'acme'), 1, 'one demo event');

select tests.as_user(tests.u('owner'));
select ok(private.is_platform_admin(), 'bootstrap owner is a platform admin');
select throws_ok($$select public.bogey_seed_demo((select id from public.orgs where slug = 'acme'))$$, '42501', null, 'seeding is service-role only');
reset role;

select * from finish();
rollback;
