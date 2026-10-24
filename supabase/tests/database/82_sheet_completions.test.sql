begin;
select plan(7);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max)
values (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public', 1, 4);
insert into public.event_windows (event_id, key, override) values (tests.u('ev'), 'judging', 'open');
insert into public.submission_forms (id, event_id, key, title) values (tests.u('form'), tests.u('ev'), 'project', 'Project');
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['j1','j2','out']) n;
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('j1'), 'judge'), (tests.u('ev'), tests.u('j2'), 'judge');
insert into public.teams (id, event_id, name) values (tests.u('ta'), tests.u('ev'), 'A');
insert into public.submissions (id, event_id, form_id, team_id, title, status, submitted_at) values
  (tests.u('sa'), tests.u('ev'), tests.u('form'), tests.u('ta'), 'A', 'submitted', now());

select tests.as_user(tests.u('j1'));
select lives_ok($$select public.set_sheet_done(tests.u('sa'), true)$$, 'an unassigned judge marks a project done');
select lives_ok($$select public.set_sheet_done(tests.u('sa'), true)$$, 'marking it twice is fine');
select is((select count(*)::integer from public.sheet_completions), 1, 'one completion is recorded');
reset role;
select tests.as_user(tests.u('j2'));
select is((select count(*)::integer from public.sheet_completions), 0, 'other judges don''t see it');
reset role;
select tests.as_user(tests.u('out'));
select throws_ok($$select public.set_sheet_done(tests.u('sa'), true)$$, '42501', null, 'someone who isn''t a judge can''t');
reset role;
select tests.as_user(tests.u('j1'));
select lives_ok($$select public.set_sheet_done(tests.u('sa'), false)$$, 'a judge reopens it');
select is((select count(*)::integer from public.sheet_completions), 0, 'and the completion goes');
reset role;

select * from finish();
rollback;
