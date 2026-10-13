begin;
select plan(23);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'reachorg', 'Reach Org');
insert into public.events (id, org_id, slug, name, visibility, team_size_max) values (tests.u('ev'), tests.u('org'), 'reach', 'Reach', 'public', 4);
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','p1','p2','j1']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner');
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('p1'), 'participant'), (tests.u('ev'), tests.u('p2'), 'participant'),
  (tests.u('ev'), tests.u('j1'), 'judge');
insert into public.teams (id, event_id, name, created_by) values (tests.u('t1'), tests.u('ev'), 'Rockets', tests.u('p1'));
insert into public.team_members (event_id, team_id, user_id, role) values
  (tests.u('ev'), tests.u('t1'), tests.u('p1'), 'captain');

-- Judges posting announcements
select tests.as_user(tests.u('j1'));
select throws_ok($$select public.post_announcement(tests.u('ev'), 'Hi', '', 'info')$$, '42501', null, 'judges can''t post by default');
reset role;
insert into public.settings (scope, event_id, namespace, value) values ('event', tests.u('ev'), 'announcements', '{"judges":true}');
select tests.as_user(tests.u('j1'));
select lives_ok($$select public.post_announcement(tests.u('ev'), 'Judging at 3', '', 'info', p_anonymous => true)$$, 'with the setting, judges post');
select lives_ok($$select public.post_announcement(tests.u('ev'), 'Rockets: table 4', '', 'info', p_teams => array[tests.u('t1')])$$, 'and can address a team');
reset role;
select is((select author_id from public.announcements where event_id = tests.u('ev') and title = 'Judging at 3'), tests.u('j1'), 'a judge''s announcement always carries their name');
select tests.as_user(tests.u('p2'));
select is_empty($$select 1 from public.announcements where title = 'Rockets: table 4'$$, 'other teams don''t see a team''s announcement');
reset role;
select tests.as_user(tests.u('p1'));
select isnt_empty($$select 1 from public.announcements where title = 'Rockets: table 4'$$, 'the team does');
select throws_ok($$select public.post_announcement(tests.u('ev'), 'Me too', '', 'info')$$, '42501', null, 'participants still can''t post');
reset role;

-- Attachments must sit under the announcement's own folder
select tests.as_user(tests.u('own'));
select lives_ok(format($$insert into storage.objects (bucket_id, name, owner_id) values ('message-attachments', %L, %L)$$,
  tests.u('ev') || '/' || tests.u('an1') || '/x/map.png', tests.u('own')), 'organizers upload before posting');
select lives_ok(format($$insert into storage.objects (bucket_id, name, owner_id) values ('message-attachments', %L, %L)$$,
  tests.u('ev') || '/' || tests.u('an4') || '/x/seat.png', tests.u('own')), 'files for a team-only announcement too');
select lives_ok(format($$select public.post_announcement(%L, 'Seats', '', 'info', p_teams => array[%L]::uuid[], p_id => %L)$$,
  tests.u('ev'), tests.u('t1'), tests.u('an4')), 'that goes to one team');
reset role;
select tests.as_user(tests.u('p1'));
select throws_ok(format($$insert into storage.objects (bucket_id, name, owner_id) values ('message-attachments', %L, %L)$$,
  tests.u('ev') || '/' || tests.u('an3') || '/x/f.png', tests.u('p1')), '42501', null, 'participants can''t upload announcement files');
select isnt_empty(format($$select 1 from storage.objects where name = %L$$, tests.u('ev') || '/' || tests.u('an4') || '/x/seat.png'), 'the team reads its announcement''s files');
reset role;
select tests.as_user(tests.u('p2'));
select is_empty(format($$select 1 from storage.objects where name = %L$$, tests.u('ev') || '/' || tests.u('an4') || '/x/seat.png'), 'other teams don''t');
reset role;
select tests.as_user(tests.u('own'));
select lives_ok(format($$select public.post_announcement(%L, 'Map', '', 'info', p_id => %L, p_attachments => %L)$$,
  tests.u('ev'), tests.u('an1'), jsonb_build_array(jsonb_build_object('path', tests.u('ev') || '/' || tests.u('an1') || '/x/map.png', 'name', 'map.png'))),
  'an announcement carries files from its folder');
select throws_ok(format($$select public.post_announcement(%L, 'Sneaky', '', 'info', p_id => %L, p_attachments => %L)$$,
  tests.u('ev'), tests.u('an2'), jsonb_build_array(jsonb_build_object('path', tests.u('ev') || '/' || tests.u('an1') || '/x/map.png', 'name', 'map.png'))),
  '22023', null, 'but not another announcement''s');
reset role;
select is((select jsonb_array_length(attachments) from public.announcements where id = tests.u('an1')), 1, 'and keeps them');

-- Messaging a team
insert into public.settings (scope, event_id, namespace, value) values ('event', tests.u('ev'), 'chat', '{"enabled":true,"participants":true,"judges":false}');
select tests.as_user(tests.u('own'));
select lives_ok($$select public.message_team(tests.u('ev'), tests.u('t1'), 'Your demo', 'Room 2 at 4pm')$$, 'an organizer messages a team');
reset role;
select tests.as_user(tests.u('p1'));
select lives_ok(format('insert into public.clarification_messages (event_id, clarification_id, body_md) select %L, id, %L from public.clarifications where subject = %L', tests.u('ev'), 'Thanks!', 'Your demo'), 'the team sees it and replies');
reset role;
select tests.as_user(tests.u('p2'));
select is_empty($$select 1 from public.clarifications where subject = 'Your demo'$$, 'other teams don''t see it');
reset role;
select tests.as_user(tests.u('j1'));
select throws_ok($$select public.message_team(tests.u('ev'), tests.u('t1'), 'Q', 'q')$$, '42501', null, 'judges can''t message teams without chat.judges');
reset role;

update public.settings set value = value || '{"judges":true}' where event_id = tests.u('ev') and namespace = 'chat';
select tests.as_user(tests.u('j1'));
select lives_ok($$select public.message_team(tests.u('ev'), tests.u('t1'), 'Your repo', 'Is it public?')$$, 'with it, judges message a team');
reset role;
select is((select audience from public.clarifications where subject = 'Your repo'), 'judges', 'as a judges conversation');

insert into public.settings (scope, event_id, namespace, value) values ('event', tests.u('ev'), 'judging', '{"blind":true}');
select tests.as_user(tests.u('j1'));
select throws_ok($$select public.message_team(tests.u('ev'), tests.u('t1'), 'Blind', 'x')$$, '42501', null, 'but not while judging is blind');
reset role;

select * from finish();
rollback;
