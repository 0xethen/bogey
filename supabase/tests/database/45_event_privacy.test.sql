begin;
select plan(34);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'priv', 'Priv');
insert into public.events (id, org_id, slug, name, visibility) values
  (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public'),
  (tests.u('unl'), tests.u('org'), 'unl', 'Unl', 'unlisted'),
  (tests.u('old'), tests.u('org'), 'old', 'Old', 'public');
insert into public.event_windows (event_id, key, override) values (tests.u('ev'), 'registration', 'open');
select tests.create_user(tests.u(n), n || '@priv.test')
from unnest(array['own', 'ok', 'pend', 'wait', 'gone', 'past', 'stranger', 'helper']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner');

insert into public.registrations (event_id, email, user_id, source, status) values
  (tests.u('ev'), 'ok@priv.test', tests.u('ok'), 'self', 'approved'),
  (tests.u('ev'), 'pend@priv.test', tests.u('pend'), 'self', 'pending'),
  (tests.u('ev'), 'wait@priv.test', tests.u('wait'), 'self', 'waitlisted'),
  (tests.u('ev'), 'gone@priv.test', tests.u('gone'), 'self', 'approved'),
  (tests.u('old'), 'past@priv.test', tests.u('past'), 'self', 'approved');
update public.registrations set status = 'rejected' where event_id = tests.u('ev') and user_id = tests.u('gone');
insert into public.event_members (event_id, user_id, role) values (tests.u('ev'), tests.u('helper'), 'staff');

insert into public.session_slots (id, event_id, starts_at) values (tests.u('slot'), tests.u('ev'), now() + interval '1 day');
insert into public.event_sessions (event_id, slot_id, name, location)
values (tests.u('ev'), tests.u('slot'), 'Kickoff', 'Room 101');
insert into public.session_hosts (event_id, session_id, user_id)
select tests.u('ev'), id, tests.u('helper') from public.event_sessions where event_id = tests.u('ev');
insert into public.tracks (event_id, name, prize_md) values (tests.u('ev'), 'Best hack', 'A trophy');
insert into public.settings (scope, event_id, namespace, value)
values ('event', tests.u('ev'), 'about', '{"body":"The theme is tides"}');

select ok(not exists (select 1 from public.org_members where org_id = tests.u('org') and user_id = tests.u('ok')),
  'an approved participant doesn''t join the org');
select ok(exists (select 1 from public.org_members where org_id = tests.u('org') and user_id = tests.u('helper')),
  'staff do');

select tests.as_anon();
select ok(not (public.settings_for(array['about'], null, tests.u('ev')) ? 'about'), 'About is for members by default');
select is((select count(*)::integer from public.events where id = tests.u('ev')), 1, 'anyone sees the event');
select is((select count(*)::integer from public.tracks where event_id = tests.u('ev')), 1, 'and the prizes, by default');
select is((select count(*)::integer from public.session_slots where event_id = tests.u('ev')), 0, 'not the agenda');
select is((select count(*)::integer from public.event_sessions where event_id = tests.u('ev')), 0, 'or its sessions');
select is(jsonb_array_length(public.event_agenda(tests.u('ev')) -> 'slots'), 0, 'event_agenda keeps it too');
select is((select count(*)::integer from public.events where id = tests.u('unl')), 0, 'an unlisted event can''t be listed');
reset role;

select tests.as_user(tests.u('pend'));
select is((select count(*)::integer from public.event_sessions where event_id = tests.u('ev')), 0, 'an applicant doesn''t see the agenda');
select ok(not (public.settings_for(array['about'], null, tests.u('ev')) ? 'about'), 'or About');
select is((select count(*)::integer from public.settings where event_id = tests.u('ev') and namespace = 'about'), 0,
  'not even reading settings directly');
reset role;
select tests.as_user(tests.u('wait'));
select is((select count(*)::integer from public.session_slots where event_id = tests.u('ev')), 0, 'nor does the waitlist');
reset role;
select tests.as_user(tests.u('gone'));
select is((select count(*)::integer from public.session_slots where event_id = tests.u('ev')), 0, 'nor someone declined after approval');
reset role;

select tests.as_user(tests.u('ok'));
select is((select count(*)::integer from public.event_sessions where event_id = tests.u('ev')), 1, 'an approved participant sees the agenda');
select is(public.settings_for(array['about'], null, tests.u('ev')) #>> '{about,body}', 'The theme is tides',
  'and About');
select is(jsonb_array_length(public.event_agenda(tests.u('ev')) #> '{slots,0,sessions,0,hosts}'), 1, 'with the hosts');
select ok(exists (select 1 from public.profiles where id = tests.u('helper')), 'and can see people in the event');
select ok(exists (select 1 from public.profiles where id = tests.u('own')), 'and the org''s admins');
select ok(not exists (select 1 from public.profiles where id = tests.u('pend')), 'but not applicants');
reset role;

insert into public.settings (scope, event_id, namespace, value)
values ('event', tests.u('ev'), 'privacy', '{"agenda":"public","tracks":"members","about":"public"}');
select tests.as_anon();
select is(public.settings_for(array['about'], null, tests.u('ev')) #>> '{about,body}', 'The theme is tides',
  'a shared About shows to anyone who can see the event');
reset role;
select tests.as_user(tests.u('pend'));
select is((select count(*)::integer from public.event_sessions where event_id = tests.u('ev')), 1, 'a public agenda shows to applicants');
select is(jsonb_array_length(public.event_agenda(tests.u('ev')) #> '{slots,0,sessions,0,hosts}'), 0, 'without who hosts');
select is((select count(*)::integer from public.tracks where event_id = tests.u('ev')), 0, 'members-only prizes don''t');
reset role;

select tests.as_user(tests.u('past'));
select ok(not exists (select 1 from public.profiles where id = tests.u('ok')), 'last year''s participant can''t see this year''s');
select ok(not exists (select 1 from public.profiles where id = tests.u('helper')), 'or its staff');
select is((select count(*)::integer from public.org_members where org_id = tests.u('org')), 0, 'or the org''s members');
select is((select count(*)::integer from public.events where id = tests.u('unl')), 0, 'or its unlisted events');
reset role;

select tests.as_user(tests.u('stranger'));
select is((select count(*)::integer from public.open_event(tests.u('org'), 'unl')), 1, 'following the link opens it');
select is((select count(*)::integer from public.events where id = tests.u('unl')), 1, 'and it stays open to them');
select is((select count(*)::integer from public.open_event(tests.u('org'), 'nope')), 0, 'a wrong address opens nothing');
reset role;
update public.events set visibility = 'draft' where id = tests.u('unl');
select tests.as_user(tests.u('stranger'));
select is((select count(*)::integer from public.open_event(tests.u('org'), 'unl')), 0, 'a draft doesn''t open from its link');
reset role;
update public.events set visibility = 'unlisted' where id = tests.u('unl');
select tests.as_anon();
select is((select count(*)::integer from public.open_event(tests.u('org'), 'unl')), 0, 'signed out, it asks them to sign in first');
reset role;
select is((select count(*)::integer from public.event_visitors where event_id = tests.u('unl')), 1,
  'but only signed-in visitors are remembered');

select * from finish();
rollback;
