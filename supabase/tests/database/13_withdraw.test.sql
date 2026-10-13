begin;
select plan(5);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max) values
  (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public', 1, 4);
insert into public.event_windows (event_id, key, override) values (tests.u('ev'), 'teams', 'open');
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['reg','added']) n;
insert into public.registrations (event_id, email, user_id, source, status)
  values (tests.u('ev'), 'reg@t.test', tests.u('reg'), 'self', 'approved');
insert into public.event_members (event_id, user_id, role) values (tests.u('ev'), tests.u('added'), 'participant');

select tests.as_user(tests.u('reg'));
select public.create_team(tests.u('ev'), 'Rockets');
select lives_ok($$select public.withdraw_registration(tests.u('ev'))$$, 'a registered participant can leave');
reset role;
select is((select status::text from public.registrations where user_id = tests.u('reg')), 'withdrawn', 'their registration is withdrawn');
select is((select status::text from public.event_members where user_id = tests.u('reg')), 'removed', 'and their participation ends');
select is_empty($$select 1 from public.team_members where user_id = tests.u('reg')$$, 'and they leave their team');

select tests.as_user(tests.u('added'));
select public.withdraw_registration(tests.u('ev'));
reset role;
select is((select status::text from public.event_members where user_id = tests.u('added')), 'removed', 'someone added without a registration can leave too');

select * from finish();
rollback;
