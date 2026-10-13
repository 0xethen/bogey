begin;
select plan(17);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'extrasorg', 'Extras Org');
insert into public.events (id, org_id, slug, name, visibility, team_size_max) values (tests.u('ev'), tests.u('org'), 'extras', 'Extras', 'public', 4);
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','p1','p2']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner');
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('p1'), 'participant'), (tests.u('ev'), tests.u('p2'), 'participant');
insert into public.settings (scope, event_id, namespace, value) values ('event', tests.u('ev'), 'chat', '{"enabled":true,"participants":true,"copyTeam":false}');

select tests.as_user(tests.u('p1'));
select public.ask_clarification(tests.u('ev'), 'Wifi?', 'What is the password?');
select lives_ok(
  format('insert into public.clarification_archives (clarification_id, user_id) select id, %L from public.clarifications where subject = %L', tests.u('p1'), 'Wifi?'),
  'a participant archives their own conversation');
select throws_ok(
  format('insert into public.clarification_archives (clarification_id, user_id) select id, %L from public.clarifications where subject = %L', tests.u('p2'), 'Wifi?'),
  '42501', null, 'but not for someone else');
reset role;
create temp table wifi on commit drop as select id from public.clarifications where subject = 'Wifi?';
grant select on wifi to authenticated;
select tests.as_user(tests.u('p2'));
select is_empty($$select 1 from public.clarification_archives where user_id = tests.u('p1')$$, 'nobody sees another person''s archive');
select throws_ok(
  format('insert into public.clarification_archives (clarification_id, user_id) select id, %L from wifi', tests.u('p2')),
  '42501', null, 'a conversation they can''t read can''t be archived either');
reset role;

select tests.as_user(tests.u('p1'));
select lives_ok(
  format($q$insert into public.clarification_messages (event_id, clarification_id, body_md, attachments)
    select %L, id, '', jsonb_build_array(jsonb_build_object('path', %L || '/' || id || '/x/notes.md', 'name', 'notes.md', 'size', 10, 'type', 'text/markdown'))
    from public.clarifications where subject = 'Wifi?'$q$, tests.u('ev'), tests.u('ev')),
  'a message can be only an attachment in its own folder');
select throws_ok(
  format($q$insert into public.clarification_messages (event_id, clarification_id, body_md, attachments)
    select %L, id, 'look', jsonb_build_array(jsonb_build_object('path', 'elsewhere/secret.pdf', 'name', 'secret.pdf', 'size', 1, 'type', 'application/pdf'))
    from public.clarifications where subject = 'Wifi?'$q$, tests.u('ev')),
  '22023', null, 'an attachment outside the conversation''s folder is refused');
select throws_ok(
  format($q$insert into public.clarification_messages (event_id, clarification_id, body_md) select %L, id, '' from public.clarifications where subject = 'Wifi?'$q$, tests.u('ev')),
  '23514', null, 'a message needs words or a file');
reset role;

insert into public.divisions (id, event_id, name) values (tests.u('ms'), tests.u('ev'), 'Middle school');
insert into public.session_slots (id, event_id, kind, starts_at) values (tests.u('slot'), tests.u('ev'), 'choose', now() + interval '1 day');
insert into public.event_sessions (id, event_id, slot_id, name, capacity) values
  (tests.u('git'), tests.u('ev'), tests.u('slot'), 'Git', 10);
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['maya','oli']) n;

select tests.as_user(tests.u('own'));
select is(
  public.import_roster(tests.u('ev'), jsonb_build_array(
    jsonb_build_object('email', 'maya@t.test', 'name', 'Maya', 'teamOptions', jsonb_build_array('A.C.S.', 'A.C.S Coders'),
      'division', tests.u('ms'), 'sessions', jsonb_build_array(tests.u('git'), gen_random_uuid()),
      'answers', jsonb_build_object('School', 'North Valley')),
    jsonb_build_object('email', 'oli@t.test', 'team', 'Byte Club')
  )) ->> 'asked', '1', 'someone with team options is counted as asked');
reset role;

select is((select team_hint from public.registrations where email = 'maya@t.test' and event_id = tests.u('ev')), null, 'someone choosing joins no team yet');
select is((select division_id from public.event_members where user_id = tests.u('maya') and event_id = tests.u('ev')), tests.u('ms'), 'the division carries to their membership');
select is((select session_id from public.session_signups where user_id = tests.u('maya') and event_id = tests.u('ev')), tests.u('git'), 'they''re signed up for the picked session, and an unknown one is dropped');
select is((select answers ->> 'School' from public.registrations where email = 'maya@t.test' and event_id = tests.u('ev')), 'North Valley', 'the answers are kept');
select isnt((select t.name from public.team_members m join public.teams t on t.id = m.team_id where m.user_id = tests.u('oli') and m.event_id = tests.u('ev')), null, 'a plain team still applies');

select tests.as_user(tests.u('maya'));
select throws_ok($$select public.choose_team_option(tests.u('ev'), 'Rockets')$$, '22023', null, 'only an offered team can be picked');
select lives_ok($$select public.choose_team_option(tests.u('ev'), 'a.c.s coders')$$, 'picking one of them works, in any case');
reset role;
select is((select t.name from public.team_members m join public.teams t on t.id = m.team_id where m.user_id = tests.u('maya') and m.event_id = tests.u('ev')), 'A.C.S Coders', 'and puts them on it, spelled as offered');

select has_trigger('public', 'announcements', 'announcements_broadcast', 'announcement changes are broadcast to open pages');

select * from finish();
rollback;
