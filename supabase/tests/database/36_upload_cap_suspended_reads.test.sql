begin;
select plan(13);

select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['root','own','own2','pa']) n;
delete from public.platform_admins;
insert into public.platform_admins (user_id) values (tests.u('root'));
insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha'), (tests.u('other'), 'beta', 'Beta');
insert into public.org_members (org_id, user_id, role) values
  (tests.u('org'), tests.u('own'), 'owner'), (tests.u('other'), tests.u('own2'), 'owner');
insert into public.events (id, org_id, slug, name, visibility) values
  (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public'), (tests.u('ev2'), tests.u('other'), 'ev2', 'Ev2', 'public');
insert into public.event_members (event_id, user_id, role) values (tests.u('ev2'), tests.u('pa'), 'participant');
insert into public.divisions (event_id, name) values (tests.u('ev'), 'Open'), (tests.u('ev2'), 'Open');

select is(private.org_limit(tests.u('org'), 'maxUploadMb'), null, 'no cap until one is set');
insert into public.org_limit_overrides (org_id, limits) values (tests.u('org'), '{"maxUploadMb":1}');
select is(private.org_limit(tests.u('org'), 'maxUploadMb'), 1::bigint, 'a platform admin can cap one org');
select tests.as_user(tests.u('own'));
select throws_ok(format($$insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('event-assets', %L, %L, '{"size": 2097152}')$$, tests.u('ev') || '/big.png', tests.u('own')),
  '23514', null, 'a file over the cap is refused');
select lives_ok(format($$insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('event-assets', %L, %L, '{"size": 524288}')$$, tests.u('ev') || '/small.png', tests.u('own')),
  'one under it goes in');
select is(public.upload_limit_mb(tests.u('ev')), 1::bigint, 'people read the cap their org sets');
reset role;
select is((public.org_limits(tests.u('org')) -> 'maxUploadMb' ->> 'used') is not null, true, 'the limits page shows the largest file so far');

select tests.as_anon();
select is((select count(*)::int from public.divisions where event_id = tests.u('ev2')), 1, 'anyone reads a public event''s rows while its org is active');
reset role;
select tests.as_user(tests.u('root'));
select lives_ok($$select public.set_org_status(tests.u('other'), 'suspended', 'abuse')$$, 'a platform admin suspends an org');
reset role;
select tests.as_anon();
select is((select count(*)::int from public.divisions where event_id = tests.u('ev2')), 0, 'nobody reads its rows after');
select is((select count(*)::int from public.events where org_id = tests.u('other')), 0, 'or its events');
select is((select count(*)::int from public.divisions where event_id = tests.u('ev')), 1, 'other orgs are unaffected');
reset role;
select tests.as_user(tests.u('pa'));
select is((select count(*)::int from public.event_members where event_id = tests.u('ev2')), 0, 'its own members can''t read it either');
reset role;
select tests.as_user(tests.u('root'));
select is((select count(*)::int from public.divisions where event_id = tests.u('ev2')), 1, 'platform admins still can');
reset role;

select * from finish();
rollback;
