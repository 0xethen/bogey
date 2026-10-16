begin;
select plan(6);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, visibility) values (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public');
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','p1','p2','host']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner');
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('p1'), 'participant'), (tests.u('ev'), tests.u('p2'), 'participant'),
  (tests.u('ev'), tests.u('host'), 'staff');
insert into public.session_slots (id, event_id, kind, starts_at) values (tests.u('slot'), tests.u('ev'), 'choose', now());
insert into public.event_sessions (id, event_id, slot_id, name) values
  (tests.u('git'), tests.u('ev'), tests.u('slot'), 'Git'), (tests.u('ai'), tests.u('ev'), tests.u('slot'), 'AI');
insert into public.session_signups (event_id, slot_id, session_id, user_id) values
  (tests.u('ev'), tests.u('slot'), tests.u('git'), tests.u('p1')),
  (tests.u('ev'), tests.u('slot'), tests.u('ai'), tests.u('p2'));
insert into public.session_hosts (event_id, session_id, user_id) values (tests.u('ev'), tests.u('git'), tests.u('host'));

select tests.as_user(tests.u('own'));
select lives_ok($$select public.post_announcement(tests.u('ev'), 'Git room moved', '', 'info',
  p_sessions => array[tests.u('git')], p_notify => true)$$, 'organizer posts to a session');
select is((select everyone from public.announcements where event_id = tests.u('ev')), false, 'it isn''t for everyone');
reset role;

select tests.as_user(tests.u('p1'));
select results_eq($$select title from public.announcements where event_id = tests.u('ev')$$, array['Git room moved'], 'someone signed up sees it');
reset role;
select tests.as_user(tests.u('host'));
select results_eq($$select title from public.announcements where event_id = tests.u('ev')$$, array['Git room moved'], 'the host sees it');
reset role;
select tests.as_user(tests.u('p2'));
select is_empty($$select 1 from public.announcements where event_id = tests.u('ev')$$, 'someone in another session doesn''t');
reset role;

select is((select array_agg(user_id order by user_id) from public.notifications where event_id = tests.u('ev') and kind = 'announcement'),
  (select array_agg(u order by u) from unnest(array[tests.u('p1'), tests.u('host')]) u), 'only the session''s people are notified');

select * from finish();
rollback;
