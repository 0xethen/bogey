begin;
select plan(21);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max) values
  (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public', 1, 4);
insert into public.event_windows (event_id, key, override) values
  (tests.u('ev'), 'teams', 'open'), (tests.u('ev'), 'submissions', 'open');
insert into public.submission_forms (id, event_id, key, title) values (tests.u('form'), tests.u('ev'), 'project', 'Project');
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['p1','org1']) n;
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('p1'), 'participant'), (tests.u('ev'), tests.u('org1'), 'organizer');
delete from public.settings where namespace in ('network', 'access');

create function pg_temp.from_ip(p_forwarded text, p_client text default null) returns void language sql as $$
  select set_config('request.headers',
    jsonb_strip_nulls(jsonb_build_object('x-forwarded-for', p_forwarded, 'x-bogey-client-ip', p_client))::text, true);
$$;
grant execute on function pg_temp.from_ip(text, text) to authenticated;

select tests.as_user(tests.u('p1'));
select pg_temp.from_ip('8.8.8.8');
select ok(private.network_allowed(tests.u('ev')), 'no allowlist allows any network');
select public.create_team(tests.u('ev'), 'Rockets');
insert into public.submissions (id, event_id, form_id, team_id, title)
  select tests.u('sub'), tests.u('ev'), tests.u('form'), id, 'Moonshot' from public.teams where name = 'Rockets';
reset role;

insert into public.settings (scope, event_id, namespace, value)
  values ('event', tests.u('ev'), 'access', '{"allowedNetworks":["168.9.212.0/23","199.119.28.0/22"]}');

select tests.as_user(tests.u('p1'));
select pg_temp.from_ip('168.9.213.40');
select ok(private.network_allowed(tests.u('ev')), 'an address inside a range is allowed');
select pg_temp.from_ip('8.8.8.8');
select ok(not private.network_allowed(tests.u('ev')), 'one outside is not');
select pg_temp.from_ip('168.9.212.5, 8.8.8.8');
select ok(not private.network_allowed(tests.u('ev')), 'a spoofed entry left of the proxy''s is ignored');
select is((public.event_network_status(tests.u('ev')) ->> 'ip'), '8.8.8.8', 'status reports the address the database saw');
select is_empty($$update public.submissions set title = 'Off-site' where id = tests.u('sub') returning id$$, 'writes from outside change nothing');
select throws_ok(format('select public.submit_project(%L)', tests.u('sub')), 'P0001', 'connect to the event''s network to submit', 'submitting says why');
select ok(public.record_blocked_access(tests.u('ev')), 'a refused write from outside is recorded');
select ok(public.record_blocked_access(tests.u('ev')), 'and still reported the next time');
select pg_temp.from_ip('8.8.8.8', '168.9.212.9');
select ok(not private.network_allowed(tests.u('ev')), 'a forwarded client IP from an untrusted proxy is ignored');
select pg_temp.from_ip('168.9.213.40');
select ok(not public.record_blocked_access(tests.u('ev')), 'nothing is recorded from an allowed network');
reset role;
select results_eq(
  $$select action, meta ->> 'ip' from public.audit_log where event_id = tests.u('ev') and action = 'access.denied'$$,
  $$values ('access.denied', '8.8.8.8')$$,
  'one entry per person per 10 minutes, with the address');

insert into public.settings (scope, namespace, value) values ('instance', 'network', '{"trustedProxies":["10.0.0.0/8"]}');
select tests.as_user(tests.u('p1'));
select pg_temp.from_ip('10.1.2.3', '168.9.212.9');
select ok(private.network_allowed(tests.u('ev')), 'the app server''s forwarded client IP is trusted');
reset role;

select tests.as_user(tests.u('org1'));
select pg_temp.from_ip('8.8.8.8');
select ok(private.network_allowed(tests.u('ev')), 'organizers are exempt');
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select ok(private.network_allowed(tests.u('ev')), 'so is the service role');

update public.settings set value = jsonb_build_object('allowedNetworks', jsonb_build_array('168.9.212.0/23'),
  'onlyUsers', jsonb_build_array(tests.u('org1')))
  where scope = 'event' and event_id = tests.u('ev') and namespace = 'access';
select tests.as_user(tests.u('p1'));
select pg_temp.from_ip('8.8.8.8');
select ok(private.network_allowed(tests.u('ev')), 'someone the limit doesn''t name is not limited');
select is((public.event_network_status(tests.u('ev')) ->> 'restricted')::boolean, false, 'and status says so');
reset role;
update public.settings set value = jsonb_build_object('allowedNetworks', jsonb_build_array('168.9.212.0/23'),
  'onlyUsers', jsonb_build_array(tests.u('p1')))
  where scope = 'event' and event_id = tests.u('ev') and namespace = 'access';
select tests.as_user(tests.u('p1'));
select pg_temp.from_ip('8.8.8.8');
select ok(not private.network_allowed(tests.u('ev')), 'someone it names is limited');
select throws_ok(format('select public.leave_team(%L)', tests.u('ev')), 'P0001', 'connect to the event''s network to take part', 'and cannot change their team');
reset role;
update public.settings set value = jsonb_build_object('allowedNetworks', jsonb_build_array('168.9.212.0/23'),
  'onlyTeams', jsonb_build_array((select id from public.teams where event_id = tests.u('ev') and name = 'Rockets')))
  where scope = 'event' and event_id = tests.u('ev') and namespace = 'access';
select tests.as_user(tests.u('p1'));
select pg_temp.from_ip('8.8.8.8');
select ok(not private.network_allowed(tests.u('ev')), 'a named team''s members are limited');
select pg_temp.from_ip('168.9.213.40');
select ok(private.network_allowed(tests.u('ev')), 'unless they are on the network');
reset role;

select * from finish();
rollback;
