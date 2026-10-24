begin;
select plan(5);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max)
values (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public', 1, 4);
insert into public.event_windows (event_id, key, override) values
  (tests.u('ev'), 'challenges.contest', 'open'), (tests.u('ev'), 'challenges.scoreboard', 'open');
insert into public.settings (scope, event_id, namespace, value) values
  ('event', tests.u('ev'), 'plugins', '{"enabled":["challenges"]}'),
  ('event', tests.u('ev'), 'plugin.challenges', '{"format":"ctf"}'),
  ('event', tests.u('ev'), 'access',
   '{"allowedNetworks":["168.9.212.0/23"],"networkAreas":["challenges.contest"]}');
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','pa']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner');
insert into public.event_members (event_id, user_id, role) values (tests.u('ev'), tests.u('pa'), 'participant');
insert into public.teams (id, event_id, name) values (tests.u('ta'), tests.u('ev'), 'A');
insert into public.team_members (event_id, team_id, user_id) values (tests.u('ev'), tests.u('ta'), tests.u('pa'));

select tests.as_user(tests.u('own'));
create temp table made (id uuid);
grant all on made to authenticated;
insert into made values (public.ctf_save_challenge(tests.u('ev'), null,
  '{"title":"Web","flag_kind":"static","flag":"flag{web}","points_initial":100,"hints":[{"cost":0,"content_md":"hint"}]}'));
reset role;

select tests.as_user(tests.u('pa'));
select set_config('request.headers', '{"x-forwarded-for":"8.8.8.8"}', true);
select throws_ok($$select public.ctf_submit_flag((select id from made), 'flag{web}')$$, 'P0001',
  'connect to the event''s network to take part', 'a flag from outside the network is refused');
select throws_ok($$select public.ctf_unlock_hint((select id from made), 1::smallint)$$, 'P0001',
  'connect to the event''s network to take part', 'so is a hint');
select set_config('request.headers', '{"x-forwarded-for":"168.9.213.40"}', true);
select is(public.ctf_submit_flag((select id from made), 'flag{web}'), 'correct', 'on the network the flag counts');
reset role;

update public.settings set value = '{"allowedNetworks":["168.9.212.0/23"],"networkAreas":["submissions"]}'
  where scope = 'event' and event_id = tests.u('ev') and namespace = 'access';
select tests.as_user(tests.u('pa'));
select set_config('request.headers', '{"x-forwarded-for":"8.8.8.8"}', true);
select is(public.ctf_submit_flag((select id from made), 'flag{web}'), 'solved', 'an area the event did not choose stays open');
reset role;

select tests.as_user(tests.u('own'));
select set_config('request.headers', '{"x-forwarded-for":"8.8.8.8"}', true);
select ok(private.network_allowed(tests.u('ev'), 'challenges.contest'), 'organizers are exempt');
reset role;

select * from finish();
rollback;
