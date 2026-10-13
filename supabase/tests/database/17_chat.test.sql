begin;
select plan(20);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'chatorg', 'Chat Org');
insert into public.events (id, org_id, slug, name, visibility, team_size_max) values (tests.u('ev'), tests.u('org'), 'chat', 'Chat', 'public', 4);
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','p1','p2','p3','j1']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner');
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('p1'), 'participant'), (tests.u('ev'), tests.u('p2'), 'participant'),
  (tests.u('ev'), tests.u('p3'), 'participant'), (tests.u('ev'), tests.u('j1'), 'judge');
insert into public.teams (id, event_id, name, created_by) values (tests.u('t1'), tests.u('ev'), 'Rockets', tests.u('p1'));
insert into public.team_members (event_id, team_id, user_id, role) values
  (tests.u('ev'), tests.u('t1'), tests.u('p1'), 'captain'), (tests.u('ev'), tests.u('t1'), tests.u('p2'), 'member');

insert into public.settings (scope, event_id, namespace, value) values ('event', tests.u('ev'), 'chat', '{"enabled":false}');
select tests.as_user(tests.u('own'));
select throws_ok($$select public.ask_clarification(tests.u('ev'), 'Hi', 'hello', 'general', 'staff')$$, '42501', null, 'chat turned off stops everyone');
reset role;

update public.settings set value = '{"enabled":true,"participants":false}' where event_id = tests.u('ev') and namespace = 'chat';

select tests.as_user(tests.u('j1'));
select lives_ok($$select public.ask_clarification(tests.u('ev'), 'Rubric?', 'Which rubric?', 'general', 'staff')$$, 'a judge starts a staff conversation');
reset role;
select tests.as_user(tests.u('own'));
select lives_ok(format('insert into public.clarification_messages (event_id, clarification_id, body_md) select %L, id, %L from public.clarifications where subject = %L', tests.u('ev'), 'The new one', 'Rubric?'), 'organizers reply');
select is((select author_role from public.clarification_messages where body_md = 'The new one'), 'organizer', 'and are marked as organizers');
reset role;
select tests.as_user(tests.u('p1'));
select is_empty($$select 1 from public.clarifications where subject = 'Rubric?'$$, 'participants never see staff conversations');
select throws_ok($$select public.ask_clarification(tests.u('ev'), 'Q', 'q')$$, '42501', null, 'participants are off until allowed');
reset role;

update public.settings set value = '{"enabled":true,"participants":true}' where event_id = tests.u('ev') and namespace = 'chat';

select tests.as_user(tests.u('p1'));
select lives_ok($$select public.ask_clarification(tests.u('ev'), 'APIs?', 'May we?')$$, 'a participant messages organizers');
select throws_ok($$select public.ask_clarification(tests.u('ev'), 'Score?', 'why?', 'general', 'judges')$$, '42501', null, 'judges need their own switch');
select throws_ok($$select public.ask_clarification(tests.u('ev'), 'Sneaky', 'x', 'general', 'staff')$$, '42501', null, 'participants cannot start staff conversations');
reset role;
select is((select team_id from public.clarifications where subject = 'APIs?'), tests.u('t1'), 'the team is copied by default');
select tests.as_user(tests.u('p2'));
select lives_ok(format('insert into public.clarification_messages (event_id, clarification_id, body_md) select %L, id, %L from public.clarifications where subject = %L', tests.u('ev'), 'me too', 'APIs?'), 'a teammate replies');
reset role;
select tests.as_user(tests.u('j1'));
select is_empty($$select 1 from public.clarifications where subject = 'APIs?'$$, 'judges do not see conversations with organizers');
reset role;

update public.settings set value = '{"enabled":true,"participants":true,"judges":true,"copyTeam":false}' where event_id = tests.u('ev') and namespace = 'chat';

select tests.as_user(tests.u('p1'));
select lives_ok($$select public.ask_clarification(tests.u('ev'), 'Feedback?', 'Any notes?', 'general', 'judges')$$, 'with the switch, participants message judges');
reset role;
select is((select team_id from public.clarifications where subject = 'Feedback?'), null, 'copyTeam off keeps it to the sender');
select tests.as_user(tests.u('p2'));
select is_empty($$select 1 from public.clarifications where subject = 'Feedback?'$$, 'so teammates do not see it');
reset role;
select tests.as_user(tests.u('j1'));
select lives_ok(format('insert into public.clarification_messages (event_id, clarification_id, body_md) select %L, id, %L from public.clarifications where subject = %L', tests.u('ev'), 'Nice work', 'Feedback?'), 'judges reply to conversations with judges');
reset role;
select is((select status::text from public.clarifications where subject = 'Feedback?'), 'answered', 'a reply from the other side answers it');

update public.settings set value = value || '{"staff":false}' where event_id = tests.u('ev') and namespace = 'chat';
select tests.as_user(tests.u('j1'));
select throws_ok($$select public.ask_clarification(tests.u('ev'), 'Again?', 'hm', 'general', 'staff')$$, '42501', null, 'judges start no staff conversations');
select throws_ok(format('insert into public.clarification_messages (event_id, clarification_id, body_md) select %L, id, %L from public.clarifications where subject = %L', tests.u('ev'), 'late', 'Rubric?'), '42501', null, 'or reply to old ones');
reset role;
select tests.as_user(tests.u('own'));
select throws_ok($$select public.ask_clarification(tests.u('ev'), 'Again?', 'hm', 'general', 'staff')$$, '42501', null, 'organizers neither');
reset role;

select * from finish();
rollback;
