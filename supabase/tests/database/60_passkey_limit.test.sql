begin;
select plan(4);

select tests.create_user(tests.u('kim'), 'kim@passkeys.test');
insert into public.settings (scope, namespace, value) values ('instance', 'accounts', '{"maxPasskeys": 2}')
  on conflict (scope, org_id, event_id, namespace)
  do update set value = public.settings.value || excluded.value;

insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
select gen_random_uuid(), tests.u('kim'), 'Passkey ' || n, 'webauthn', 'verified', now(), now()
from generate_series(1, 2) n;
select is((select count(*)::integer from auth.mfa_factors where user_id = tests.u('kim')), 2, 'passkeys up to the limit are added');

select throws_ok(
  $$insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
    values (gen_random_uuid(), tests.u('kim'), 'Passkey 3', 'webauthn', 'unverified', now(), now())$$,
  '42501', null, 'one past the limit is refused');

select lives_ok(
  $$insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
    values (gen_random_uuid(), tests.u('kim'), 'Authenticator app', 'totp', 'verified', now(), now())$$,
  'an authenticator app doesn''t count');

update public.settings set value = value || '{"maxPasskeys": 0}' where scope = 'instance' and namespace = 'accounts';
delete from auth.mfa_factors where user_id = tests.u('kim') and factor_type = 'webauthn';
select throws_ok(
  $$insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
    values (gen_random_uuid(), tests.u('kim'), 'Passkey', 'webauthn', 'unverified', now(), now())$$,
  '42501', null, '0 turns adding passkeys off');

select * from finish();
rollback;
