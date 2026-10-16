begin;
select plan(10);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max)
values (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public', 1, 4);
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','p1','p2','p3']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner');
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('p1'), 'participant'), (tests.u('ev'), tests.u('p2'), 'participant'), (tests.u('ev'), tests.u('p3'), 'participant');
insert into public.teams (id, event_id, name) values (tests.u('ta'), tests.u('ev'), 'A');
insert into public.team_members (event_id, team_id, user_id) values
  (tests.u('ev'), tests.u('ta'), tests.u('p2')), (tests.u('ev'), tests.u('ta'), tests.u('p3'));

select tests.as_user(tests.u('p1'));
select lives_ok($$select public.ask_clarification(tests.u('ev'), 'Hi', 'First question')$$, 'a participant asks');
select throws_ok($$select public.block_from_chat(tests.u('ev'), tests.u('p2'))$$, '42501', null, 'participants can''t block');
reset role;

select tests.as_user(tests.u('own'));
select lives_ok($$select public.block_from_chat(tests.u('ev'), tests.u('p1'), null, 'spam')$$, 'an organizer blocks a person');
select lives_ok($$select public.block_from_chat(tests.u('ev'), null, tests.u('ta'))$$, 'and a team');
select is((select count(*)::integer from public.audit_log where event_id = tests.u('ev') and action = 'chat.blocked'), 2, 'blocks are audited');
reset role;

select tests.as_user(tests.u('p1'));
select throws_ok($$select public.ask_clarification(tests.u('ev'), 'Again', 'Second question')$$, '42501', null, 'a blocked person can''t ask');
select throws_ok($$insert into public.clarification_messages (event_id, clarification_id, body_md)
  select tests.u('ev'), id, 'more' from public.clarifications where event_id = tests.u('ev') limit 1$$, '42501', null, 'or reply');
select is((select count(*)::integer from public.chat_blocks where event_id = tests.u('ev')), 1, 'they can see their own block');
reset role;
select tests.as_user(tests.u('p3'));
select throws_ok($$select public.ask_clarification(tests.u('ev'), 'Team', 'Question')$$, '42501', null, 'a blocked team''s members can''t ask');
reset role;

select tests.as_user(tests.u('own'));
select public.unblock_from_chat(id) from public.chat_blocks where event_id = tests.u('ev') and user_id = tests.u('p1');
reset role;
select tests.as_user(tests.u('p1'));
select lives_ok($$select public.ask_clarification(tests.u('ev'), 'Again', 'Second question')$$, 'unblocked, they can ask again');
reset role;

select * from finish();
rollback;
