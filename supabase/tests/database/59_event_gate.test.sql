begin;
select plan(11);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'gate-org', 'Gate');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max) values
  (tests.u('ev'), tests.u('org'), 'gate-ev', 'Gate', 'unlisted', 1, 4);
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['p1','org1','judge1']) n;
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('p1'), 'participant'),
  (tests.u('ev'), tests.u('org1'), 'organizer'),
  (tests.u('ev'), tests.u('judge1'), 'judge');
insert into public.settings (scope, event_id, namespace, value) values
  ('event', tests.u('ev'), 'plugins', '{"enabled":["gatetest"]}'),
  ('event', tests.u('ev'), 'plugin.gatetest', '{"on":true}');

-- a plugin's gate: closed while the session setting says so
create function private.gatetest_gate(p_event uuid) returns text language sql stable as $$
  select case when current_setting('tests.gate', true) = 'closed' then 'covered' end;
$$;

select tests.as_user(tests.u('p1'));
select ok(private.has_permission(tests.u('ev'), 'event.view'), 'an open gate leaves permissions alone');
select is(public.event_gate(tests.u('ev')), null, 'and the route hears nothing');

select set_config('tests.gate', 'closed', true);
select is(public.event_gate(tests.u('ev')), 'gatetest.covered', 'a closed gate names the plugin and its reason');
select ok(not private.has_permission(tests.u('ev'), 'event.view'), 'a gated participant holds no permission');
select ok(private.holds_permission(tests.u('ev'), 'event.view'), 'though their role still grants it');
select ok(public.settings_for(array['plugins', 'plugin.gatetest', 'chat'], null, tests.u('ev')) ? 'plugin.gatetest',
  'they still read the plugin''s settings');
select ok(not (public.settings_for(array['chat'], null, tests.u('ev')) ? 'chat'), 'but not the event''s own');
select is((select count(*) from public.settings where event_id = tests.u('ev') and namespace = 'plugins'), 1::bigint,
  'and can select which plugins are on');

reset role;
select tests.as_user(tests.u('org1'));
select ok(private.has_permission(tests.u('ev'), 'event.manage'), 'organizers are never gated');
reset role;
select tests.as_user(tests.u('judge1'));
select is(public.event_gate(tests.u('ev')), null, 'nor are judges');

reset role;
update public.settings set value = '{"enabled":[]}' where event_id = tests.u('ev') and namespace = 'plugins';
select tests.as_user(tests.u('p1'));
select ok(private.has_permission(tests.u('ev'), 'event.view'), 'a plugin that is off gates no one');

select * from finish();
rollback;
