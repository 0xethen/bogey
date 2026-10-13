begin;
select plan(13);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max)
values (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public', 1, 4);
insert into public.event_windows (event_id, key, override) values (tests.u('ev'), 'judging', 'open');
insert into public.submission_forms (id, event_id, key, title) values (tests.u('form'), tests.u('ev'), 'project', 'Project');
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','j1','pa','pb']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner');
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('j1'), 'judge'), (tests.u('ev'), tests.u('pa'), 'participant'), (tests.u('ev'), tests.u('pb'), 'participant');
insert into public.teams (id, event_id, name) values (tests.u('ta'), tests.u('ev'), 'A'), (tests.u('tb'), tests.u('ev'), 'B');
insert into public.team_members (event_id, team_id, user_id) values
  (tests.u('ev'), tests.u('ta'), tests.u('pa')), (tests.u('ev'), tests.u('tb'), tests.u('pb'));
insert into public.submissions (id, event_id, form_id, team_id, title, status, submitted_at) values
  (tests.u('sa'), tests.u('ev'), tests.u('form'), tests.u('ta'), 'A', 'submitted', now()),
  (tests.u('sb'), tests.u('ev'), tests.u('form'), tests.u('tb'), 'B', 'submitted', now());

select is((select method from public.judging_rounds where form_id = tests.u('form')), 'rubric', 'rounds are ranked by the rubric to begin with');

select tests.as_user(tests.u('own'));
select throws_ok($$update public.judging_rounds set method = 'duel.pairwise' where form_id = tests.u('form')$$, '22023', null, 'a plugin''s method needs the plugin on');
reset role;
insert into public.settings (scope, event_id, namespace, value) values ('event', tests.u('ev'), 'plugins', '{"enabled":["duel"]}');
select tests.as_user(tests.u('own'));
select lives_ok($$update public.judging_rounds set method = 'duel.pairwise' where form_id = tests.u('form')$$, 'and works once it is');
reset role;
select is((select count(*)::integer from public.audit_log where event_id = tests.u('ev') and action = 'judging.method_set'), 1, 'changing it is audited');
select throws_ok($$update public.judging_rounds set method = 'duel.Pairwise' where form_id = tests.u('form')$$, '23514', null, 'a method has to look like <plugin>.<key>');

select throws_ok($$select private.set_ranking_input((select id from public.judging_rounds where form_id = tests.u('form') limit 1), tests.u('sa'), 'other.method', 1)$$, '22023', null, 'a method that is not the round''s can''t write its scores');
select lives_ok($$select private.set_ranking_input((select id from public.judging_rounds where form_id = tests.u('form') limit 1), tests.u('sa'), 'duel.pairwise', 12.5, '{"wins":3}')$$, 'the round''s own method can');
select lives_ok($$select private.set_ranking_input((select id from public.judging_rounds where form_id = tests.u('form') limit 1), tests.u('sb'), 'duel.pairwise', 40)$$, 'for each entry');
select tests.as_user(tests.u('j1'));
select throws_ok($$select private.set_ranking_input((select id from public.judging_rounds where form_id = tests.u('form') limit 1), tests.u('sa'), 'duel.pairwise', 99)$$, '42501', null, 'but a client can''t call the helper');
select is((select count(*)::integer from public.ranking_inputs), 0, 'nor read the scores');
reset role;

select is(
  (select array_agg((r ->> 'title') order by (r ->> 'rank')::integer)
   from jsonb_array_elements(private.rank_submissions(tests.u('ev'))) r),
  array['B', 'A'], 'results follow the plugin''s scores, highest first');
select is(
  (select (r ->> 'method') from jsonb_array_elements(private.rank_submissions(tests.u('ev'))) r limit 1),
  'duel.pairwise', 'and say which method ranked them');
select is(
  (select (r -> 'detail' ->> 'wins') from jsonb_array_elements(private.rank_submissions(tests.u('ev'))) r where r ->> 'title' = 'A'),
  '3', 'with the method''s own detail');

select * from finish();
rollback;
