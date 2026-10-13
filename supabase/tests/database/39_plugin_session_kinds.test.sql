begin;
select plan(5);

select tests.create_user(tests.u('own'), 'own@t.test');
insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner');
insert into public.events (id, org_id, slug, name, visibility) values (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public');

select tests.as_user(tests.u('own'));
select throws_ok(format($$select public.save_agenda(%L, '{"slots":[{"name":"S","kind":"everyone","starts_at":"2026-10-10T10:00:00Z","ends_at":"2026-10-10T11:00:00Z",
  "sessions":[{"name":"Duel","kind":"duel.match","starts_at":"2026-10-10T10:00:00Z","ends_at":"2026-10-10T11:00:00Z"}]}]}')$$, tests.u('ev')),
  '22023', null, 'a plugin''s session type needs the plugin on');
reset role;

insert into public.settings (scope, event_id, namespace, value) values ('event', tests.u('ev'), 'plugins', '{"enabled":["duel"]}');
select tests.as_user(tests.u('own'));
select lives_ok(format($$select public.save_agenda(%L, '{"slots":[{"name":"S","kind":"everyone","starts_at":"2026-10-10T10:00:00Z","ends_at":"2026-10-10T11:00:00Z",
  "sessions":[{"name":"Duel","kind":"duel.match","starts_at":"2026-10-10T10:00:00Z","ends_at":"2026-10-10T11:00:00Z"}]}]}')$$, tests.u('ev')),
  'it saves once the plugin is on');
reset role;
select is((select kind from public.event_sessions where event_id = tests.u('ev')), 'duel.match', 'with the kind as written');

update public.settings set value = '{"enabled":[]}' where scope = 'event' and event_id = tests.u('ev') and namespace = 'plugins';
select tests.as_user(tests.u('own'));
select lives_ok(format($$select public.save_agenda(%L, jsonb_build_object('slots', jsonb_build_array(jsonb_build_object('id', (select slot_id from public.event_sessions where event_id = %L),
  'name', 'S', 'kind', 'everyone', 'starts_at', '2026-10-10T10:00:00Z', 'ends_at', '2026-10-10T11:00:00Z',
  'sessions', jsonb_build_array(jsonb_build_object('id', (select id from public.event_sessions where event_id = %L), 'name', 'Duel 2', 'kind', 'duel.match',
    'starts_at', '2026-10-10T10:00:00Z', 'ends_at', '2026-10-10T11:00:00Z'))))))$$, tests.u('ev'), tests.u('ev'), tests.u('ev')),
  'a session that already has it can be edited');
reset role;
select is((select name from public.event_sessions where event_id = tests.u('ev')), 'Duel 2', 'and was');

select * from finish();
rollback;
