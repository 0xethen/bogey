begin;
select plan(7);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'kinds-org', 'Kinds');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max)
values (tests.u('ev'), tests.u('org'), 'kinds-ev', 'Kinds', 'public', 1, 4);
select tests.create_user(tests.u(n), n || '@kinds.test') from unnest(array['own','pa','jj','st']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner');
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('pa'), 'participant'), (tests.u('ev'), tests.u('jj'), 'judge'),
  (tests.u('ev'), tests.u('st'), 'staff');
insert into public.checkins (event_id, user_id, method) values (tests.u('ev'), tests.u('pa'), 'desk');

select tests.as_user(tests.u('jj'));
select is((select count(*)::integer from public.my_certificates(tests.u('ev'))), 0, 'certificates are off until the event turns them on');
reset role;

insert into public.settings (scope, event_id, namespace, value)
values ('event', tests.u('ev'), 'certificates', '{"enabled":true,"kinds":["judge"]}');

select tests.as_user(tests.u('jj'));
select is((select array_agg(kind) from public.my_certificates(tests.u('ev'))), array['judge'], 'a kind the event gives can be claimed');
reset role;
select tests.as_user(tests.u('pa'));
select is((select count(*)::integer from public.my_certificates(tests.u('ev'))), 0, 'a kind it doesn''t give isn''t offered');
select throws_ok($$select public.claim_certificate(tests.u('ev'), 'participation')$$, '42501', null, 'or claimable');
reset role;
select tests.as_user(tests.u('own'));
select is(public.issue_certificates(tests.u('ev')), 1, 'issuing everything skips the kinds it doesn''t give');
reset role;

update public.settings set value = '{"enabled":true}'
where scope = 'event' and event_id = tests.u('ev') and namespace = 'certificates';
select tests.as_user(tests.u('st'));
select is((select array_agg(kind) from public.my_certificates(tests.u('ev'))), array['volunteer'], 'with no kinds set, every kind is given');
reset role;
select tests.as_user(tests.u('pa'));
select is((select array_agg(kind) from public.my_certificates(tests.u('ev'))), array['participation'], 'participants included');
reset role;

select * from finish();
rollback;
