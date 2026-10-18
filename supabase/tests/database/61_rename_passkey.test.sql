begin;
select plan(5);

select tests.create_user(tests.u('kim'), 'kim@rename-passkey.test');
select tests.create_user(tests.u('lee'), 'lee@rename-passkey.test');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at) values
  (tests.u('kim-1'), tests.u('kim'), 'Passkey 1', 'webauthn', 'verified', now(), now()),
  (tests.u('kim-2'), tests.u('kim'), 'Passkey 2', 'webauthn', 'verified', now(), now());

select tests.as_user(tests.u('kim'));
select lives_ok($$select public.rename_passkey(tests.u('kim-1'), '  Work laptop ')$$, 'renames your own passkey');
reset role;
select is((select friendly_name from auth.mfa_factors where id = tests.u('kim-1')), 'Work laptop', 'the name is trimmed');

select tests.as_user(tests.u('kim'));
select throws_ok($$select public.rename_passkey(tests.u('kim-2'), 'Work laptop')$$, '23505', null, 'two passkeys can''t share a name');
select throws_ok($$select public.rename_passkey(tests.u('kim-2'), '   ')$$, '22023', null, 'a blank name is refused');

reset role;
select tests.as_user(tests.u('lee'));
select throws_ok($$select public.rename_passkey(tests.u('kim-1'), 'Mine now')$$, '42501', null, 'someone else''s passkey is refused');

select * from finish();
rollback;
