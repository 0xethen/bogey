begin;
select plan(6);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha'), (tests.u('other'), 'beta', 'Beta');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max)
values (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public', 1, 4);
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','staff','pa','own2']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner'), (tests.u('other'), tests.u('own2'), 'owner');
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('staff'), 'staff'), (tests.u('ev'), tests.u('pa'), 'participant');

select tests.as_user(tests.u('pa'));
select throws_ok($$select public.log_export(tests.u('ev'), 'members')$$, '42501', null, 'participants can''t record an export');
reset role;
select tests.as_user(tests.u('staff'));
select throws_ok($$select public.log_export(tests.u('ev'), 'members')$$, '42501', null, 'nor can staff');
reset role;
select tests.as_user(tests.u('own2'));
select throws_ok($$select public.log_export(tests.u('ev'), 'members')$$, '42501', null, 'nor an owner of another org');
reset role;

select tests.as_user(tests.u('own'));
select lives_ok($$select public.log_export(tests.u('ev'), 'submission-files')$$, 'an organizer records an export');
select throws_ok($$select public.log_export(tests.u('ev'), 'Bad Kind!')$$, '22023', null, 'a kind must look like one');
reset role;
select is((select meta ->> 'kind' from public.audit_log where event_id = tests.u('ev') and action = 'export.downloaded'), 'submission-files', 'the kind is in the log');

select * from finish();
rollback;
