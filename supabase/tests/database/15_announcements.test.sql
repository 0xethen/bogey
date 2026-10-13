begin;
select plan(12);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, visibility) values (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public');
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','p1','p2','p3','j1']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner');
insert into public.divisions (id, event_id, name) values (tests.u('high'), tests.u('ev'), 'High school');
insert into public.event_members (event_id, user_id, role, division_id) values
  (tests.u('ev'), tests.u('p1'), 'participant', null), (tests.u('ev'), tests.u('p2'), 'participant', null),
  (tests.u('ev'), tests.u('p3'), 'participant', tests.u('high')), (tests.u('ev'), tests.u('j1'), 'judge', null);
insert into public.teams (id, event_id, name, division_id) values
  (tests.u('ta'), tests.u('ev'), 'Team A', tests.u('high')), (tests.u('tb'), tests.u('ev'), 'Team B', null);
insert into public.team_members (event_id, team_id, user_id) values
  (tests.u('ev'), tests.u('ta'), tests.u('p1')), (tests.u('ev'), tests.u('tb'), tests.u('p2'));

select tests.as_user(tests.u('p1'));
select throws_ok($$select public.post_announcement(tests.u('ev'), 'Hi', '', 'info')$$, '42501', null, 'participants can''t post');
reset role;

select tests.as_user(tests.u('own'));
select lives_ok($$select public.post_announcement(tests.u('ev'), 'Team A only', '', 'info', p_teams => array[tests.u('ta')])$$, 'organizer posts to a team');
select lives_ok($$select public.post_announcement(tests.u('ev'), 'High school', '', 'info', p_divisions => array[tests.u('high')])$$, 'organizer posts to a division');
select lives_ok($$select public.post_announcement(tests.u('ev'), 'Judges', '', 'info', p_roles => array['judge']::public.event_role[])$$, 'organizer posts to a role');
select lives_ok($$select public.post_announcement(tests.u('ev'), 'All', '', 'info')$$, 'organizer posts to everyone');
select is((select count(*)::integer from public.audit_log where event_id = tests.u('ev') and action = 'announcement.posted'), 4, 'posting is audited');
reset role;

select tests.as_user(tests.u('p1'));
select results_eq('select title from public.announcements order by title', array['All', 'High school', 'Team A only'], 'a team member sees their team''s and their team''s division''s posts');
select is_empty('select 1 from public.announcement_audiences', 'participants can''t read who else a post went to');
reset role;
select tests.as_user(tests.u('p2'));
select results_eq('select title from public.announcements order by title', array['All'], 'another team sees only the everyone post');
reset role;
select tests.as_user(tests.u('p3'));
select results_eq('select title from public.announcements order by title', array['All', 'High school'], 'a member''s own division counts too');
reset role;
select tests.as_user(tests.u('j1'));
select results_eq('select title from public.announcements order by title', array['All', 'Judges'], 'judges see judge posts');
reset role;

delete from public.teams where id = tests.u('ta');
select tests.as_user(tests.u('p2'));
select results_eq('select title from public.announcements order by title', array['All'], 'a post whose team is gone reaches nobody new');
reset role;

select * from finish();
rollback;
