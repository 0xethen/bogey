begin;
select plan(13);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'present-org', 'Present');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max)
values (tests.u('ev'), tests.u('org'), 'present', 'Present', 'public', 1, 4);
insert into public.event_windows (event_id, key, override) values (tests.u('ev'), 'judging', 'open');
insert into public.submission_forms (id, event_id, key, title) values (tests.u('form'), tests.u('ev'), 'project', 'Project');
insert into public.divisions (id, event_id, name) values (tests.u('div'), tests.u('ev'), 'High school');
insert into public.tracks (id, event_id, name) values (tests.u('tr'), tests.u('ev'), 'Best hardware');
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','g','pa']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner');
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('g'), 'judge'), (tests.u('ev'), tests.u('pa'), 'participant');
insert into public.teams (id, event_id, name, division_id) values (tests.u('ta'), tests.u('ev'), 'Alpha', tests.u('div'));
insert into public.team_members (event_id, team_id, user_id, role) values
  (tests.u('ev'), tests.u('ta'), tests.u('pa'), 'captain');
insert into public.submissions (id, event_id, form_id, team_id, title, status, submitted_at) values
  (tests.u('sa'), tests.u('ev'), tests.u('form'), tests.u('ta'), 'Robot', 'submitted', now());
insert into public.submission_tracks (event_id, submission_id, track_id) values (tests.u('ev'), tests.u('sa'), tests.u('tr'));

select tests.as_user(tests.u('own'));
create temp table r as select id from public.judging_rounds where form_id = tests.u('form');
grant select on r to authenticated;
update public.judging_rounds set format = 'demos' where id = (select id from r);
select public.save_panels((select id from r), jsonb_build_array(
  jsonb_build_object('name', 'Room 1', 'slotMinutes', 6, 'judges', jsonb_build_array(tests.u('g')))));
select public.schedule_demos((select id from r));
create temp table p as select id from public.judging_panels where round_id = (select id from r);
grant select on p to authenticated;

select is((public.panel_presentation((select id from p)) -> 'slots' -> 0 ->> 'teamName'), 'Alpha',
  'organizers see the team presenting');
select is((public.panel_presentation((select id from p)) -> 'slots' -> 0 ->> 'division'), 'High school',
  'its division');
select is((public.panel_presentation((select id from p)) -> 'slots' -> 0 -> 'tracks'), '["Best hardware"]'::jsonb,
  'its prize tracks');
select is(jsonb_array_length(public.panel_presentation((select id from p)) -> 'slots' -> 0 -> 'members'), 1,
  'and its members');
select is((public.panel_presentation((select id from p)) ->> 'nowStartedAt'), null, 'no timer before the first team');
select is((public.panel_presentation((select id from p)) ->> 'canAdvance')::boolean, true, 'organizers can move it along');
reset role;

select tests.as_user(tests.u('g'));
select is((public.panel_presentation((select id from p)) ->> 'canAdvance')::boolean, true, 'so can the panel''s judges');
select public.set_panel_now((select id from p), 0);
select isnt((public.panel_presentation((select id from p)) ->> 'nowStartedAt'), null,
  'moving the presenter along starts its timer');
reset role;
update public.judging_panels set now_started_at = now() - interval '5 minutes' where id = (select id from p);
select tests.as_user(tests.u('g'));
select public.set_panel_now((select id from p), 0);
select ok((select now_started_at > now() - interval '1 minute' from public.judging_panels where id = (select id from p)),
  'setting the same team again restarts it');
select public.set_panel_now((select id from p), null);
select is((select now_started_at from public.judging_panels where id = (select id from p)), null,
  'resetting the panel clears it');
reset role;

insert into public.settings (scope, event_id, namespace, value) values ('event', tests.u('ev'), 'judging', '{"blind":true}');
select tests.as_user(tests.u('g'));
select is((public.panel_presentation((select id from p)) -> 'slots' -> 0 ->> 'teamName'), null,
  'blind judging hides the team from judges');
select is(jsonb_array_length(public.panel_presentation((select id from p)) -> 'slots' -> 0 -> 'members'), 0,
  'and its members');
reset role;

select tests.as_user(tests.u('pa'));
select throws_ok($$select public.panel_presentation((select id from p))$$, '42501', null,
  'participants can''t read the run of show');
reset role;

select * from finish();
rollback;
