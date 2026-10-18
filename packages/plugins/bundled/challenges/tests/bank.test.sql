-- The problem bank: saving a contest's problem to it, using it in another contest, copying between
-- contests, and who may.
begin;
select plan(14);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha'), (tests.u('org2'), 'beta', 'Beta');
insert into public.events (id, org_id, slug, name, kind, visibility, team_size_max) values
  (tests.u('one'), tests.u('org'), 'one', 'One', 'contest', 'public', 1),
  (tests.u('two'), tests.u('org'), 'two', 'Two', 'contest', 'public', 1),
  (tests.u('far'), tests.u('org2'), 'far', 'Far', 'contest', 'public', 1);
insert into public.settings (scope, event_id, namespace, value)
select 'event', e, 'plugins', '{"enabled":["challenges"]}' from unnest(array[tests.u('one'), tests.u('two'), tests.u('far')]) e;
select tests.create_user(tests.u(n), n || '@t.test', jsonb_build_object('full_name', n)) from unnest(array['jo','amy']) n;
insert into public.event_members (event_id, user_id, role) values
  (tests.u('one'), tests.u('jo'), 'organizer'), (tests.u('two'), tests.u('jo'), 'organizer'),
  (tests.u('far'), tests.u('jo'), 'organizer'), (tests.u('one'), tests.u('amy'), 'participant');

insert into public.challenges_problems (id, event_id, label, slug, title, kind, statement_md, run_script) values
  (tests.u('sum'), tests.u('one'), 'A', 'sum', 'Sum', 'pass_fail', 'Add them.', 'exec "$@" < "$1" > "$2"');
insert into public.challenges_testcases (event_id, problem_id, ordinal, is_sample, input, answer) values
  (tests.u('one'), tests.u('sum'), 1, true, '1 2', '3'), (tests.u('one'), tests.u('sum'), 2, false, '5 5', '10');
insert into public.challenges_solutions (event_id, problem_id, team_id, language_key, source, expected_verdict, jury_label) values
  (tests.u('one'), tests.u('sum'), null, 'python', 'print(sum(map(int,input().split())))', 'AC', 'right');

select tests.as_user(tests.u('amy'));
select throws_ok($$select public.challenges_bank_save(tests.u('sum'), 'Warm-ups')$$, '42501', null,
  'a participant can''t save to the bank');
select is_empty($$select 1 from public.challenges_bank_problems$$, 'or read it');
reset role;

select tests.as_user(tests.u('jo'));
create temp table banked as select public.challenges_bank_save(tests.u('sum'), 'Warm-ups') as id;
select is((select category || ' ' || title from public.challenges_bank_problems), 'Warm-ups Sum', 'the jury saves it with a category');
select is((select count(*)::integer from public.challenges_bank_testcases), 2, 'with its tests');
select is((select count(*)::integer from public.challenges_bank_solutions), 1, 'and its jury solutions');
select is(public.challenges_bank_save(tests.u('sum')), (select id from banked), 'saving again updates the same entry');
select is((select category from public.challenges_bank_problems), 'Warm-ups', 'keeping its category');

create temp table used as select public.challenges_bank_use((select id from banked), tests.u('two'), 'C') as id;
select is((select label || ' ' || slug || ' ' || title from public.challenges_problems where id = (select id from used)),
  'C sum Sum', 'using it puts a copy in another contest');
select is((select count(*)::integer from public.challenges_testcases where problem_id = (select id from used)), 2,
  'with the tests');
select is((select count(*)::integer from public.challenges_solutions where problem_id = (select id from used) and team_id is null), 1,
  'and the jury solutions, queued to be judged there');
select is(public.challenges_scripts((select id from used)) ->> 'run_script', 'exec "$@" < "$1" > "$2"',
  'the run script comes along');
create temp table copied as select public.challenges_problem_copy(tests.u('sum'), tests.u('two'), 'D') as id;
select is((select slug from public.challenges_problems where id = (select id from copied)), 'sum-2',
  'copying between contests picks a free URL name');
select throws_ok($$select public.challenges_bank_use((select id from banked), tests.u('far'), 'A')$$, '42501', null,
  'another org''s event can''t use it');
select throws_ok($$select public.challenges_problem_copy(tests.u('sum'), tests.u('two'), 'C')$$, '23505', null,
  'an ID already taken is refused');
reset role;

select * from finish();
rollback;
