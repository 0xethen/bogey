begin;
select plan(17);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha'), (tests.u('other'), 'beta', 'Beta');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max)
values (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public', 1, 4);
insert into public.event_windows (event_id, key, override) values (tests.u('ev'), 'results', 'open');
insert into public.submission_forms (id, event_id, key, title) values (tests.u('form'), tests.u('ev'), 'project', 'Project');
insert into public.criteria (id, event_id, label, max_score) values (tests.u('c1'), tests.u('ev'), 'Impact', 10);
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','win','lose','own2']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner'), (tests.u('other'), tests.u('own2'), 'owner');
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('win'), 'participant'), (tests.u('ev'), tests.u('lose'), 'participant');
insert into public.teams (id, event_id, name) values (tests.u('tw'), tests.u('ev'), 'Winners'), (tests.u('tl'), tests.u('ev'), 'Others');
insert into public.team_members (event_id, team_id, user_id) values
  (tests.u('ev'), tests.u('tw'), tests.u('win')), (tests.u('ev'), tests.u('tl'), tests.u('lose'));
insert into public.submissions (id, event_id, form_id, team_id, title, status, submitted_at) values
  (tests.u('sw'), tests.u('ev'), tests.u('form'), tests.u('tw'), 'Winning project', 'submitted', now()),
  (tests.u('sl'), tests.u('ev'), tests.u('form'), tests.u('tl'), 'Other project', 'submitted', now());
insert into public.tracks (id, event_id, name, sponsor_name, prize_md) values (tests.u('trk'), tests.u('ev'), 'Best data', 'Acme', '$100');

select tests.as_user(tests.u('win'));
select throws_ok(format($$select public.save_awards(tests.u('ev'), '[{"kind":"overall","label":"1st","submission_id":"%s"}]')$$, tests.u('sw')), '42501', null, 'participants can''t draft awards');
reset role;
select tests.as_user(tests.u('own'));
select lives_ok(format($$select public.save_awards(tests.u('ev'), '[
  {"kind":"overall","label":"1st place","place":1,"submission_id":"%s"},
  {"kind":"track","label":"Best data","track_id":"%s","submission_id":"%s"},
  {"kind":"special","label":"Best pitch","submission_id":"%s","note_md":"Loved it"}]')$$, tests.u('sw'), tests.u('trk'), tests.u('sw'), tests.u('sl')), 'an organizer drafts awards');
select is((select count(*)::integer from public.awards where event_id = tests.u('ev')), 3, 'with each one');
select throws_ok($$select public.save_awards(tests.u('ev'), '[{"kind":"bogus","label":"x","submission_id":"00000000-0000-0000-0000-000000000000"}]')$$, '23514', null, 'a bad kind is refused');
reset role;
select tests.as_user(tests.u('win'));
select is_empty($$select 1 from public.awards$$, 'participants can''t read the drafts');
reset role;

select tests.as_user(tests.u('own'));
select is(jsonb_array_length((public.publish_results(tests.u('ev'))).awards), 3, 'publishing snapshots the awards');
select is(jsonb_array_length((select rows from public.result_publications where event_id = tests.u('ev') order by published_at desc limit 1)), 0, 'and keeps the ranking out by default');
reset role;
select is((select awards -> 1 ->> 'sponsor_name' from public.result_publications where event_id = tests.u('ev') limit 1), 'Acme', 'a prize award carries its sponsor');
select is((select awards -> 0 ->> 'team_name' from public.result_publications where event_id = tests.u('ev') limit 1), 'Winners', 'and the team');
select tests.as_user(tests.u('lose'));
select is((select jsonb_array_length(awards) from public.result_publications where event_id = tests.u('ev')), 3, 'any participant reads the awards');
reset role;

select is((select count(*)::integer from public.notifications where kind = 'results.published' and event_id = tests.u('ev')), 2, 'every participant is notified');
select is((select body_md from public.notifications where user_id = tests.u('win') and kind = 'results.published'), 'Your team won: 1st place, Best data', 'winners hear what they won');
select is((select body_md from public.notifications where user_id = tests.u('lose') and kind = 'results.published'), 'Your team won: Best pitch', 'each team hears its own');

select tests.as_user(tests.u('own'));
select lives_ok($$select public.publish_results(tests.u('ev'))$$, 'publishing again works');
reset role;
select is((select count(*)::integer from public.notifications where kind = 'results.published' and event_id = tests.u('ev')), 2, 'and tells nobody twice');

insert into public.settings (scope, event_id, namespace, value) values ('event', tests.u('ev'), 'judging', '{"showRankings":"everyone"}');
select tests.as_user(tests.u('own'));
select is(jsonb_array_length((public.publish_results(tests.u('ev'))).rows), 2, 'with the setting on, the ranking is included');
reset role;

select tests.as_user(tests.u('own2'));
select throws_ok($$select public.save_awards(tests.u('ev'), '[]')$$, '42501', null, 'another org''s owner can''t draft or clear them');
reset role;

select * from finish();
rollback;
