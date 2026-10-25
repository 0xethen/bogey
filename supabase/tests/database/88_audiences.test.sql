begin;
select plan(10);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max) values
  (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public', 1, 4);
insert into public.event_windows (event_id, key, override) values
  (tests.u('ev'), 'teams', 'open'), (tests.u('ev'), 'submissions', 'open');
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['cap','boss']) n;
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('cap'), 'participant'),
  (tests.u('ev'), tests.u('boss'), 'organizer');
insert into public.divisions (id, event_id, name, sort, selectable, switchable) values
  (tests.u('jr'), tests.u('ev'), 'Juniors', 0, true, true),
  (tests.u('sr'), tests.u('ev'), 'Seniors', 1, true, true);
insert into public.tags (id, org_id, event_id, name) values
  (tests.u('mentor'), tests.u('org'), tests.u('ev'), 'Mentor');
insert into public.submission_forms (id, event_id, key, title) values
  (tests.u('form'), tests.u('ev'), 'project', 'Project');

select tests.as_user(tests.u('boss'));
select lives_ok(format($$select public.save_submission_form(tests.u('ev'),
  jsonb_build_object('id', %L, 'key', 'project', 'title', 'Project'),
  jsonb_build_array(
    jsonb_build_object('key', 'demo', 'label', 'Demo', 'kind', 'text', 'required', true),
    jsonb_build_object('key', 'poster', 'label', 'Poster', 'kind', 'text', 'required', true,
      'division_ids', jsonb_build_array(%L, %L)),
    jsonb_build_object('key', 'log', 'label', 'Mentor log', 'kind', 'text', 'required', true,
      'tag_ids', jsonb_build_array(%L))))$$,
  tests.u('form'), tests.u('jr'), tests.u('nowhere'), tests.u('mentor')), 'organizers aim items at divisions and tags');
reset role;
select is((select division_ids from public.submission_items where form_id = tests.u('form') and key = 'poster'),
  array[tests.u('jr')], 'an item keeps only divisions that exist');

select tests.as_user(tests.u('cap'));
select public.choose_division(tests.u('ev'), tests.u('sr'));
select public.create_team(tests.u('ev'), 'Rockets');
insert into public.submissions (event_id, form_id, team_id, title)
  select tests.u('ev'), tests.u('form'), id, 'Moonshot' from public.teams where name = 'Rockets';
reset role;

select is(private.submission_problems((select id from public.submissions where title = 'Moonshot')),
  array['Demo'], 'a seniors team without the tag only owes the item for everyone');
insert into public.tag_holders (tag_id, user_id) values (tests.u('mentor'), tests.u('cap'));
select is(private.submission_problems((select id from public.submissions where title = 'Moonshot')),
  array['Demo', 'Mentor log'], 'a member holding the tag brings in its item');
update public.teams set division_id = tests.u('jr') where name = 'Rockets' and event_id = tests.u('ev');
select is(private.submission_problems((select id from public.submissions where title = 'Moonshot')),
  array['Demo', 'Poster', 'Mentor log'], 'moving to the division brings in its item');

insert into public.onboarding_forms (event_id, fields) values (tests.u('ev'), jsonb_build_array(
  jsonb_build_object('key', 'shirt', 'label', 'Shirt', 'kind', 'text', 'required', false),
  jsonb_build_object('key', 'school', 'label', 'School', 'kind', 'text', 'required', false,
    'divisionIds', jsonb_build_array(tests.u('sr'))),
  jsonb_build_object('key', 'hours', 'label', 'Hours', 'kind', 'text', 'required', false,
    'tagIds', jsonb_build_array(tests.u('mentor')))));

select tests.as_user(tests.u('cap'));
select is((select array_agg(q ->> 'key') from jsonb_array_elements(public.my_onboarding_form(tests.u('ev'))) q),
  array['shirt', 'hours'], 'a junior mentor gets the questions for everyone and for mentors');
reset role;
select tests.as_user(tests.u('boss'));
select is((select array_agg(q ->> 'key') from jsonb_array_elements(public.my_onboarding_form(tests.u('ev'))) q),
  array['shirt'], 'someone in no division without tags gets only the questions for everyone');
reset role;

delete from public.divisions where id = tests.u('sr');
select ok(not ((select fields from public.onboarding_forms where event_id = tests.u('ev')) -> 1 ? 'divisionIds'),
  'deleting a division drops it from questions');
delete from public.tags where id = tests.u('mentor');
select is((select tag_ids from public.submission_items where form_id = tests.u('form') and key = 'log'),
  '{}'::uuid[], 'deleting a tag drops it from items');
select is((select count(*)::int from public.submission_items where form_id = tests.u('form')), 3,
  'and the items stay');

select * from finish();
rollback;
