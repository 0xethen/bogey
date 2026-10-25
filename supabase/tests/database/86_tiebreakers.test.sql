begin;
select plan(12);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max)
values (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public', 1, 4);
insert into public.event_windows (event_id, key, override) values (tests.u('ev'), 'judging', 'open');
insert into public.submission_forms (id, event_id, key, title) values (tests.u('form'), tests.u('ev'), 'project', 'Project');
insert into public.criteria (id, event_id, label, max_score) values
  (tests.u('c1'), tests.u('ev'), 'Impact', 10), (tests.u('c2'), tests.u('ev'), 'Design', 10);
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','g']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner');
insert into public.event_members (event_id, user_id, role) values (tests.u('ev'), tests.u('g'), 'judge');
insert into public.teams (id, event_id, name) values
  (tests.u('ta'), tests.u('ev'), 'A'), (tests.u('tb'), tests.u('ev'), 'B'),
  (tests.u('tc'), tests.u('ev'), 'C'), (tests.u('td'), tests.u('ev'), 'D');
insert into public.submissions (id, event_id, form_id, team_id, title, status, submitted_at) values
  (tests.u('sa'), tests.u('ev'), tests.u('form'), tests.u('ta'), 'A', 'submitted', now() - interval '3 hours'),
  (tests.u('sb'), tests.u('ev'), tests.u('form'), tests.u('tb'), 'B', 'submitted', now() - interval '2 hours'),
  (tests.u('sc'), tests.u('ev'), tests.u('form'), tests.u('tc'), 'C', 'submitted', now() - interval '4 hours'),
  (tests.u('sd'), tests.u('ev'), tests.u('form'), tests.u('td'), 'D', 'submitted', now() - interval '1 hour');

-- A, B and D all total 70; A leads on Impact, B and D match on everything
select tests.as_user(tests.u('g'));
insert into public.scores (event_id, submission_id, judge_id, criterion_id, value) values
  (tests.u('ev'), tests.u('sa'), tests.u('g'), tests.u('c1'), 8), (tests.u('ev'), tests.u('sa'), tests.u('g'), tests.u('c2'), 6),
  (tests.u('ev'), tests.u('sb'), tests.u('g'), tests.u('c1'), 6), (tests.u('ev'), tests.u('sb'), tests.u('g'), tests.u('c2'), 8),
  (tests.u('ev'), tests.u('sc'), tests.u('g'), tests.u('c1'), 5), (tests.u('ev'), tests.u('sc'), tests.u('g'), tests.u('c2'), 5),
  (tests.u('ev'), tests.u('sd'), tests.u('g'), tests.u('c1'), 6), (tests.u('ev'), tests.u('sd'), tests.u('g'), tests.u('c2'), 8);
reset role;

create temp view standing as
  select r ->> 'title' as title, (r ->> 'rank')::integer as rank, r ->> 'tie' as tie
  from jsonb_array_elements(private.rank_submissions(tests.u('ev'))) r;

select is((select array_agg(rank order by title) from standing), array[1, 1, 4, 1], 'without tiebreakers, equal scores share a rank');
select is((select tie from standing where title = 'A'), 'tied', 'and are marked tied');
select is((select tie from standing where title = 'C'), null, 'a lone score isn''t');

insert into public.settings (scope, event_id, namespace, value) values ('event', tests.u('ev'), 'judging',
  jsonb_build_object('tiebreakers', jsonb_build_array(jsonb_build_object('by', 'criterion', 'criterion', tests.u('c1')))));
select is((select array_agg(rank order by title) from standing), array[1, 2, 4, 2], 'a criterion breaks the tie');
select is((select tie from standing where title = 'A'), 'broken', 'and the winner is marked broken');
select is((select tie from standing where title = 'B'), 'tied', 'those equal on it too stay tied');
select is((select array_agg(r ->> 'title' order by ord) from jsonb_array_elements(private.rank_submissions(tests.u('ev'))) with ordinality e(r, ord)),
  array['A', 'B', 'D', 'C'], 'rows come in rank order, then by title');

update public.settings set value = jsonb_set(value, '{tiebreakers}', value -> 'tiebreakers' || '[{"by":"submitted"}]')
where event_id = tests.u('ev') and namespace = 'judging';
select is((select array_agg(rank order by title) from standing), array[1, 2, 4, 3], 'the next tiebreaker decides what the first left tied');

update public.settings set value = jsonb_build_object('tiebreakers', jsonb_build_array(jsonb_build_object('by', 'criterion', 'criterion', tests.u('c1'))), 'advanceTies', false)
where event_id = tests.u('ev') and namespace = 'judging';
select tests.as_user(tests.u('own'));
select lives_ok($$select public.advance_submissions((select id from public.judging_rounds where form_id = tests.u('form') and ordinal = 1), null, 2)$$, 'an organizer advances the top two');
reset role;
select is((select count(*)::integer from public.round_entries e join public.judging_rounds r on r.id = e.round_id where r.form_id = tests.u('form') and r.ordinal = 2), 2, 'with advanceTies off, exactly two move on');

update public.settings set value = value || '{"advanceTies":true}' where event_id = tests.u('ev') and namespace = 'judging';
select tests.as_user(tests.u('own'));
select lives_ok($$select public.advance_submissions((select id from public.judging_rounds where form_id = tests.u('form') and ordinal = 1), null, 2)$$, 'and again with it on');
reset role;
select is((select array_agg(s.title order by s.title) from public.round_entries e join public.judging_rounds r on r.id = e.round_id join public.submissions s on s.id = e.submission_id where r.form_id = tests.u('form') and r.ordinal = 2),
  array['A', 'B', 'D'], 'everyone tied for the last spot moves on');

select * from finish();
rollback;
