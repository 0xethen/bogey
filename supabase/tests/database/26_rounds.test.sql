begin;
select plan(20);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha'), (tests.u('other'), 'beta', 'Beta');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max)
values (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public', 1, 4);
insert into public.event_windows (event_id, key, override) values (tests.u('ev'), 'judging', 'open'), (tests.u('ev'), 'finals', 'closed');
insert into public.submission_forms (id, event_id, key, title) values (tests.u('form'), tests.u('ev'), 'project', 'Project');
insert into public.criteria (id, event_id, label, max_score) values (tests.u('c1'), tests.u('ev'), 'Impact', 10);
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','j1','pa','pb','pc','own2']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner'), (tests.u('other'), tests.u('own2'), 'owner');
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('j1'), 'judge'), (tests.u('ev'), tests.u('pa'), 'participant'),
  (tests.u('ev'), tests.u('pb'), 'participant'), (tests.u('ev'), tests.u('pc'), 'participant');
insert into public.teams (id, event_id, name) values
  (tests.u('ta'), tests.u('ev'), 'A'), (tests.u('tb'), tests.u('ev'), 'B'), (tests.u('tc'), tests.u('ev'), 'C');
insert into public.team_members (event_id, team_id, user_id) values
  (tests.u('ev'), tests.u('ta'), tests.u('pa')), (tests.u('ev'), tests.u('tb'), tests.u('pb')), (tests.u('ev'), tests.u('tc'), tests.u('pc'));
insert into public.submissions (id, event_id, form_id, team_id, title, status, submitted_at) values
  (tests.u('sa'), tests.u('ev'), tests.u('form'), tests.u('ta'), 'A', 'submitted', now()),
  (tests.u('sb'), tests.u('ev'), tests.u('form'), tests.u('tb'), 'B', 'submitted', now()),
  (tests.u('sc'), tests.u('ev'), tests.u('form'), tests.u('tc'), 'C', 'submitted', now());

select is((select count(*)::integer from public.judging_rounds where form_id = tests.u('form')), 1, 'a form starts with one round');
select is((select ordinal::integer from public.judging_rounds where form_id = tests.u('form')), 1, 'round 1');
select is(private.active_round(tests.u('sa')), (select id from public.judging_rounds where form_id = tests.u('form')), 'everyone is judged in it');

select tests.as_user(tests.u('j1'));
select lives_ok($$insert into public.scores (event_id, submission_id, judge_id, criterion_id, value) values
  (tests.u('ev'), tests.u('sa'), tests.u('j1'), tests.u('c1'), 9),
  (tests.u('ev'), tests.u('sb'), tests.u('j1'), tests.u('c1'), 6),
  (tests.u('ev'), tests.u('sc'), tests.u('j1'), tests.u('c1'), 3)$$, 'a judge scores in round 1');
select throws_ok($$select public.advance_submissions((select id from public.judging_rounds where form_id = tests.u('form') limit 1), null, 1)$$, '42501', null, 'judges can''t advance entries');
reset role;

select tests.as_user(tests.u('own'));
select throws_ok($$select public.advance_submissions((select id from public.judging_rounds where form_id = tests.u('form')))$$, '22023', null, 'say who or how many');
select lives_ok($$select public.advance_submissions((select id from public.judging_rounds where form_id = tests.u('form')), null, 2)$$, 'an organizer advances the top two');
reset role;
select is((select count(*)::integer from public.judging_rounds where form_id = tests.u('form')), 2, 'which creates round 2');
select is(
  (select array_agg(submission_id order by submission_id) from public.round_entries where event_id = tests.u('ev')),
  (select array_agg(t order by t) from unnest(array[tests.u('sa'), tests.u('sb')]) t),
  'with the best two in it');
select is(private.active_round(tests.u('sa')), (select id from public.judging_rounds where form_id = tests.u('form') and ordinal = 2), 'who are now judged in round 2');
select is(private.active_round(tests.u('sc')), (select id from public.judging_rounds where form_id = tests.u('form') and ordinal = 1), 'and the rest stay in round 1');
select is((select count(*)::integer from public.notifications where event_id = tests.u('ev') and kind = 'judging.advanced'), 2, 'finalists are told');

select tests.as_user(tests.u('j1'));
select lives_ok($$insert into public.scores (event_id, submission_id, judge_id, criterion_id, value) values
  (tests.u('ev'), tests.u('sa'), tests.u('j1'), tests.u('c1'), 5)$$, 'a finalist can be scored again');
reset role;
select is((select count(*)::integer from public.scores where submission_id = tests.u('sa')), 2, 'beside its round 1 score');
update public.judging_rounds set window_key = 'finals' where form_id = tests.u('form') and ordinal = 2;
select tests.as_user(tests.u('j1'));
select throws_ok($$insert into public.scores (event_id, submission_id, judge_id, criterion_id, value) values
  (tests.u('ev'), tests.u('sb'), tests.u('j1'), tests.u('c1'), 5)$$, '42501', null, 'a round with its own window waits for it');
reset role;

select is(
  (select count(*)::integer from jsonb_array_elements(private.rank_submissions(tests.u('ev'))) r where (r ->> 'round_id')::uuid = (select id from public.judging_rounds where form_id = tests.u('form') and ordinal = 1)),
  3, 'round 1 ranks everyone');
select is(
  (select (r ->> 'score') from jsonb_array_elements(private.rank_submissions(tests.u('ev'))) r where (r ->> 'submission_id')::uuid = tests.u('sa') and (r ->> 'round_ordinal') = '2'),
  '50.00', 'round 2 ranks on its own scores');
insert into public.criteria (id, event_id, label, max_score, round_id)
values (tests.u('c2'), tests.u('ev'), 'Finals only', 10, (select id from public.judging_rounds where form_id = tests.u('form') and ordinal = 2));
select is(
  (select count(*)::integer from jsonb_array_elements(private.rank_submissions(tests.u('ev'))) r where (r ->> 'round_ordinal') = '1' and (r ->> 'criteria_scored')::integer > 1),
  0, 'a criterion for round 2 doesn''t count in round 1');

select tests.as_user(tests.u('own2'));
select throws_ok($$select public.advance_submissions((select id from public.judging_rounds where form_id = tests.u('form') and ordinal = 1))$$, '42501', null, 'another org''s owner can''t advance them');
select is((select count(*)::integer from public.round_entries where event_id = tests.u('ev')), 0, 'and can''t see who was');
reset role;

select * from finish();
rollback;
