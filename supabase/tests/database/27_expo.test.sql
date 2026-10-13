begin;
select plan(14);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha'), (tests.u('other'), 'beta', 'Beta');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max)
values (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public', 1, 4);
insert into public.event_windows (event_id, key, override) values (tests.u('ev'), 'judging', 'open'), (tests.u('ev'), 'submissions', 'open');
insert into public.submission_forms (id, event_id, key, title) values (tests.u('form'), tests.u('ev'), 'project', 'Project');
insert into public.divisions (id, event_id, name, sort) values (tests.u('hs'), tests.u('ev'), 'High school', 1), (tests.u('ms'), tests.u('ev'), 'Middle school', 0);
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','j1','pa','own2']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner'), (tests.u('other'), tests.u('own2'), 'owner');
insert into public.event_members (event_id, user_id, role) values (tests.u('ev'), tests.u('j1'), 'judge'), (tests.u('ev'), tests.u('pa'), 'participant');
insert into public.teams (id, event_id, name, division_id) values
  (tests.u('ta'), tests.u('ev'), 'Alpha', tests.u('hs')), (tests.u('tb'), tests.u('ev'), 'Bravo', tests.u('ms')), (tests.u('tc'), tests.u('ev'), 'Charlie', tests.u('hs'));
insert into public.team_members (event_id, team_id, user_id) values (tests.u('ev'), tests.u('ta'), tests.u('pa'));
insert into public.submissions (id, event_id, form_id, team_id, title, status, submitted_at) values
  (tests.u('sa'), tests.u('ev'), tests.u('form'), tests.u('ta'), 'A', 'submitted', now()),
  (tests.u('sb'), tests.u('ev'), tests.u('form'), tests.u('tb'), 'B', 'submitted', now()),
  (tests.u('sc'), tests.u('ev'), tests.u('form'), tests.u('tc'), 'C', 'submitted', now());

select tests.as_user(tests.u('pa'));
select throws_ok($$select public.assign_tables(tests.u('form'))$$, '42501', null, 'participants can''t number tables');
select throws_ok($$update public.submissions set table_label = '99' where id = tests.u('sa')$$, '42501', null, 'and teams can''t pick their own');
reset role;

select tests.as_user(tests.u('own'));
select is(public.assign_tables(tests.u('form')), 3, 'an organizer numbers every entry');
reset role;
select is((select string_agg(table_label, ',' order by table_label) from public.submissions where event_id = tests.u('ev')), '1,2,3', 'one, two, three');
select is((select table_label from public.submissions where id = tests.u('sa')), '1', 'in team name order');

select tests.as_user(tests.u('own'));
select is(public.assign_tables(tests.u('form'), 'numeric', 10), 0, 'numbered entries keep their table');
select is(public.assign_tables(tests.u('form'), 'prefix', 1, 'T', 'division', true), 3, 'unless renumbering');
reset role;
select is((select table_label from public.submissions where id = tests.u('sb')), 'T1', 'middle school (sort 0) comes first, with a prefix');
select is((select string_agg(table_label, ',' order by table_label) from public.submissions where team_id in (tests.u('ta'), tests.u('tc'))), 'T2,T3', 'then the high school teams together');

select tests.as_user(tests.u('pa'));
select is((select table_label from public.submissions where id = tests.u('sa')), 'T2', 'a team reads its table');
reset role;

select tests.as_user(tests.u('j1'));
select lives_ok($$select public.skip_submission(tests.u('sb'))$$, 'a judge skips a team');
select is((select status::text from public.judge_assignments where submission_id = tests.u('sb') and judge_id = tests.u('j1')), 'skipped', 'which is remembered');
select lives_ok($$select public.skip_submission(tests.u('sb'), false)$$, 'and brings it back');
reset role;
select tests.as_user(tests.u('own2'));
select throws_ok($$select public.assign_tables(tests.u('form'))$$, '42501', null, 'another org''s owner can''t number them');
reset role;

select * from finish();
rollback;
