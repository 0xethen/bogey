begin;
select plan(9);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'grants', 'Grants');
insert into public.events (id, org_id, slug, name) values (tests.u('ev'), tests.u('org'), 'grants', 'Grants');
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own', 'amy', 'bob']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner');
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('amy'), 'participant'),
  (tests.u('ev'), tests.u('bob'), 'participant');
insert into public.roles (key, label, source) values ('tstgrants.helper', 'Helper', 'tstgrants');
insert into public.role_permissions (role_key, permission) values ('tstgrants.helper', 'tstgrants.help');

select tests.as_user(tests.u('amy'));
select ok(not private.has_permission(tests.u('ev'), 'tstgrants.help'), 'a participant lacks the extension permission');
select throws_ok($$select public.set_role_grants(tests.u('ev'), tests.u('bob'), array['tstgrants.helper'])$$,
  '42501', null, 'participants can''t hand out roles');
reset role;

select tests.as_user(tests.u('own'));
select lives_ok($$select public.set_role_grants(tests.u('ev'), tests.u('amy'), array['tstgrants.helper', 'tstgrants.helper'])$$,
  'an organizer grants an extension role');
select lives_ok($$select public.set_role_grants(tests.u('ev'), tests.u('amy'), array['tstgrants.helper'])$$,
  'granting it again changes nothing');
select throws_ok($$select public.set_role_grants(tests.u('ev'), tests.u('amy'), array['judge'])$$,
  '23514', null, 'core roles aren''t grants');
reset role;

select tests.as_user(tests.u('amy'));
select ok(private.has_permission(tests.u('ev'), 'tstgrants.help'), 'the role grants its permission');
reset role;

select tests.as_user(tests.u('own'));
select lives_ok($$select public.set_role_grants(tests.u('ev'), tests.u('amy'), array[]::text[])$$, 'an empty list removes them');
reset role;

select is(
  (select array_agg(action order by created_at, action) from public.audit_log where event_id = tests.u('ev')),
  array['member.role_granted', 'member.role_revoked'],
  'each grant and removal is audited once'
);
select is((select count(*)::integer from public.event_role_grants where event_id = tests.u('ev')), 0, 'nothing is left');

select * from finish();
rollback;
