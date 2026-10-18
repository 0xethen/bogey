begin;
select plan(21);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'tags-org', 'Tags');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max) values
  (tests.u('ev'), tests.u('org'), 'tags', 'Tags', 'unlisted', 1, 4);
insert into public.submission_forms (id, event_id, key, title) values (tests.u('form'), tests.u('ev'), 'project', 'Project');
select tests.create_user(tests.u(n), n || '@t.test')
from unnest(array['own','org1','a1','a2','a3','s1','s2','p1']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner');
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('org1'), 'organizer'),
  (tests.u('ev'), tests.u('a1'), 'judge'), (tests.u('ev'), tests.u('a2'), 'judge'), (tests.u('ev'), tests.u('a3'), 'judge'),
  (tests.u('ev'), tests.u('s1'), 'judge'), (tests.u('ev'), tests.u('s2'), 'judge'),
  (tests.u('ev'), tests.u('p1'), 'participant');
insert into public.teams (id, event_id, name)
select tests.u('t' || i), tests.u('ev'), 'Team ' || i from generate_series(1, 4) i;
insert into public.submissions (id, event_id, form_id, team_id, title, status, submitted_at)
select tests.u('s' || i || 'x'), tests.u('ev'), tests.u('form'), tests.u('t' || i), 'P' || i, 'submitted', now()
from generate_series(1, 4) i;

-- who makes which tags
select tests.as_user(tests.u('org1'));
select lives_ok($$insert into public.tags (id, org_id, event_id, name) values
  (tests.u('adult'), tests.u('org'), tests.u('ev'), 'Adult Judge'),
  (tests.u('student'), tests.u('org'), tests.u('ev'), 'Student Judge')$$, 'an organizer makes event tags');
select throws_ok($$insert into public.tags (org_id, name) values (tests.u('org'), 'Mentor')$$, '42501', null,
  'but not org tags');
reset role;
select tests.as_user(tests.u('own'));
select lives_ok($$insert into public.tags (id, org_id, name, permissions) values
  (tests.u('lead'), tests.u('org'), 'Lead', '{people.view}')$$, 'an org owner makes org tags');
reset role;
select throws_ok($$insert into public.tags (org_id, name, permissions) values (tests.u('org'), 'Bad', '{Not A Permission}')$$,
  '23514', null, 'a tag grants only named permissions');

-- handing them out
select tests.as_user(tests.u('org1'));
select lives_ok($$select public.set_person_tags(tests.u('a1'), array[tests.u('adult')], p_event => tests.u('ev'))$$,
  'an organizer tags someone in the event');
select throws_ok($$select public.set_person_tags(tests.u('a1'), array[tests.u('lead')], p_event => tests.u('ev'))$$,
  '22023', null, 'an org tag isn''t handed out as an event''s');
select throws_ok($$select public.set_person_tags(tests.u('a1'), array[tests.u('lead')], tests.u('org'))$$,
  '42501', null, 'and organizers can''t hand out org tags');
reset role;
select tests.as_user(tests.u('own'));
select lives_ok($$select public.set_person_tags(tests.u('a1'), array[tests.u('lead')], tests.u('org'))$$,
  'org admins can, to org members');
select throws_ok($$select public.set_person_tags(tests.u('p1'), array[tests.u('lead')], tests.u('org'))$$,
  '22023', null, 'participants aren''t org members, so they can''t hold org tags');
select is((select count(*)::integer from public.tag_holders where user_id = tests.u('a1')), 2,
  'org and event tags sit side by side');
reset role;

-- permissions
select tests.as_user(tests.u('a2'));
select ok(not private.has_permission(tests.u('ev'), 'people.view'), 'judges don''t see people');
reset role;
select tests.as_user(tests.u('a1'));
select ok(private.has_permission(tests.u('ev'), 'people.view'), 'unless a tag lets them');
reset role;
insert into public.settings (scope, org_id, namespace, value) values ('org', tests.u('org'), 'tags', '{"eventTags":false}');
select tests.as_user(tests.u('org1'));
select throws_ok($$insert into public.tags (org_id, event_id, name) values (tests.u('org'), tests.u('ev'), 'Mentor')$$,
  '42501', null, 'with event tags off, organizers can''t make them');
reset role;
select is(cardinality(private.held_tags(tests.u('ev'), tests.u('a1'))), 1, 'and the event''s tags stop counting');
delete from public.settings where scope = 'org' and org_id = tests.u('org') and namespace = 'tags';

-- judging rules: three adults, two students, four projects, two judges each
insert into public.tag_holders (tag_id, user_id) values
  (tests.u('adult'), tests.u('a2')), (tests.u('adult'), tests.u('a3')),
  (tests.u('student'), tests.u('s1')), (tests.u('student'), tests.u('s2'));
insert into public.settings (scope, event_id, namespace, value) values ('event', tests.u('ev'), 'judging',
  jsonb_build_object('assignment', jsonb_build_object('perProject', 2, 'exclude', '[]'::jsonb, 'rules', jsonb_build_array(
    jsonb_build_object('tag', tests.u('adult'), 'count', 1, 'strict', false),
    jsonb_build_object('tag', tests.u('student'), 'count', 1, 'strict', false)))));
select tests.as_user(tests.u('org1'));
select is(public.assign_round_robin(tests.u('ev'), 2), 8, 'every project gets two judges');
reset role;
select is((
  select count(*)::integer from public.submissions s
  where s.event_id = tests.u('ev')
    and exists (select 1 from public.judge_assignments a join public.tag_holders h on h.user_id = a.judge_id
                where a.submission_id = s.id and h.tag_id = tests.u('adult'))
    and exists (select 1 from public.judge_assignments a join public.tag_holders h on h.user_id = a.judge_id
                where a.submission_id = s.id and h.tag_id = tests.u('student'))
), 4, 'one adult and one student on each');
select tests.as_user(tests.u('org1'));
select is(public.assign_round_robin(tests.u('ev'), 2), 0, 'running it again tops up nothing');
reset role;

-- one student for four projects: without strict they keep an even share, with it they double up
delete from public.judge_assignments where event_id = tests.u('ev');
delete from public.tag_holders where user_id = tests.u('s2');
select tests.as_user(tests.u('org1'));
select public.assign_round_robin(tests.u('ev'), 2);
reset role;
select is((select count(*)::integer from public.judge_assignments where judge_id = tests.u('s1')), 2,
  'a lone student judge takes their share and adults fill in');
delete from public.judge_assignments where event_id = tests.u('ev');
update public.settings set value = jsonb_set(value, '{assignment,rules,1,strict}', 'true')
where event_id = tests.u('ev') and namespace = 'judging';
select tests.as_user(tests.u('org1'));
select public.assign_round_robin(tests.u('ev'), 2);
reset role;
select is((select count(*)::integer from public.judge_assignments where judge_id = tests.u('s1')), 4,
  'a strict rule puts them on every project');

delete from public.judge_assignments where event_id = tests.u('ev');
insert into public.judge_conflicts (event_id, judge_id, team_id) values (tests.u('ev'), tests.u('s1'), tests.u('t1'));
select tests.as_user(tests.u('org1'));
select throws_ok($$select public.assign_round_robin(tests.u('ev'), 2)$$, 'P0001',
  '1 project has no one tagged "Student Judge". A strict rule needs someone with that tag who has no conflict with the team; nothing was assigned.',
  'a strict rule that can''t be met assigns nothing');
reset role;
select is((select count(*)::integer from public.judge_assignments where event_id = tests.u('ev')), 0, 'nothing at all');

select * from finish();
rollback;
