begin;
select plan(21);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha'), (tests.u('other'), 'beta', 'Beta');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max) values
  (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public', 1, 4),
  (tests.u('ev2'), tests.u('other'), 'ev2', 'Ev2', 'public', 1, 4);
insert into public.event_windows (event_id, key, override) values (tests.u('ev'), 'submissions', 'open');
insert into public.submission_forms (id, event_id, key, title) values
  (tests.u('form'), tests.u('ev'), 'project', 'Project'), (tests.u('slides'), tests.u('ev'), 'slides', 'Slides');
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','a1','b1','own2']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner'), (tests.u('other'), tests.u('own2'), 'owner');
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('a1'), 'participant'), (tests.u('ev'), tests.u('b1'), 'participant');
insert into public.teams (id, event_id, name) values (tests.u('ta'), tests.u('ev'), 'A'), (tests.u('tb'), tests.u('ev'), 'B');
insert into public.team_members (event_id, team_id, user_id) values
  (tests.u('ev'), tests.u('ta'), tests.u('a1')), (tests.u('ev'), tests.u('tb'), tests.u('b1'));
insert into public.submissions (id, event_id, form_id, team_id, title) values
  (tests.u('sa'), tests.u('ev'), tests.u('form'), tests.u('ta'), 'A project'),
  (tests.u('sb'), tests.u('ev'), tests.u('form'), tests.u('tb'), 'B project');

select tests.as_user(tests.u('a1'));
select throws_ok($$select public.save_prizes(tests.u('ev'), '[]')$$, '42501', null, 'participants can''t edit prizes');
reset role;
select tests.as_user(tests.u('own'));
select lives_ok(format($$select public.save_prizes(tests.u('ev'), '[
  {"id":"%s","name":"Best data","max_winners":2,"prize_md":"$100"},
  {"id":"%s","name":"Sponsor pick","opt_in":false,"sponsor_name":"Acme","sponsor_logo_url":"https://a.test/l.png"},
  {"id":"%s","name":"Best slides","form_id":"%s"},
  {"id":"%s","name":"Also open"}]'::jsonb)$$, tests.u('p1'), tests.u('p2'), tests.u('p3'), tests.u('slides'), tests.u('p4')), 'an organizer saves the list');
select is((select count(*)::integer from public.tracks where event_id = tests.u('ev')), 4, 'with each prize');
select is((select max_winners::integer from public.tracks where id = tests.u('p1')), 2, 'and its winners');
select throws_ok($$select public.save_prizes(tests.u('ev'), '[{"name":"X","sponsor_logo_url":"javascript:alert(1)"}]')$$, '23514', null, 'a logo has to be a web address');
reset role;

select tests.as_user(tests.u('a1'));
select lives_ok($$select public.set_submission_tracks(tests.u('sa'), array[tests.u('p1')])$$, 'a team enters an open prize');
select throws_ok($$select public.set_submission_tracks(tests.u('sa'), array[tests.u('p2')])$$, '42501', null, 'but not one only organizers place');
select throws_ok($$select public.set_submission_tracks(tests.u('sa'), array[tests.u('p3')])$$, '22023', null, 'or one for another form');
select throws_ok($$select public.set_submission_tracks(tests.u('sb'), array[tests.u('p1')])$$, '42501', null, 'or for another team');
reset role;
select is((select count(*)::integer from public.audit_log where event_id = tests.u('ev') and action = 'submission.tracks_set'), 1, 'entering is audited');

select tests.as_user(tests.u('own'));
select lives_ok($$select public.set_submission_tracks(tests.u('sa'), array[tests.u('p1'), tests.u('p2')])$$, 'an organizer places an entry anywhere');
reset role;
select tests.as_user(tests.u('a1'));
select lives_ok($$select public.set_submission_tracks(tests.u('sa'), array[tests.u('p4')])$$, 'the team changes its own choices');
select is((select array_agg(track_id order by track_id) from public.submission_tracks where submission_id = tests.u('sa')), (select array_agg(t order by t) from unnest(array[tests.u('p2'), tests.u('p4')]) t), 'and the organizer''s placement stays');
reset role;

insert into public.settings (scope, event_id, namespace, value) values ('event', tests.u('ev'), 'submissions', '{"maxTracks":1}');
select tests.as_user(tests.u('b1'));
select lives_ok($$select public.set_submission_tracks(tests.u('sb'), array[tests.u('p1')])$$, 'one prize is within the cap');
select throws_ok($$select public.set_submission_tracks(tests.u('sb'), array[tests.u('p1'), tests.u('p4')])$$, '22023', null, 'two are over it');
reset role;
select tests.as_user(tests.u('own'));
select lives_ok($$select public.set_submission_tracks(tests.u('sb'), array[tests.u('p1'), tests.u('p4')])$$, 'organizers aren''t capped');
reset role;

select tests.as_user(tests.u('b1'));
select throws_ok($$insert into public.submission_tracks (event_id, submission_id, track_id) values (tests.u('ev'), tests.u('sb'), tests.u('p2'))$$, '42501', null, 'teams can''t write entries directly');
reset role;

update public.event_windows set override = 'closed' where event_id = tests.u('ev') and key = 'submissions';
select tests.as_user(tests.u('b1'));
select throws_ok($$select public.set_submission_tracks(tests.u('sb'), array[tests.u('p4')])$$, '42501', null, 'a closed form locks the choices');
reset role;

select tests.as_user(tests.u('own2'));
select is((select count(*)::integer from public.tracks where event_id = tests.u('ev')), 4, 'prizes are public to anyone who can see the event');
select throws_ok($$select public.save_prizes(tests.u('ev'), '[]')$$, '42501', null, 'another org''s owner can''t edit them');
reset role;
select is((select count(*)::integer from public.tracks where event_id = tests.u('ev')), 4, 'and nothing was removed');

select * from finish();
rollback;
