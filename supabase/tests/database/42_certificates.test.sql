begin;
select plan(15);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max, starts_at, ends_at)
values (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public', 1, 4, now() - interval '2 days', now() - interval '1 day');
insert into public.settings (scope, event_id, namespace, value) values ('event', tests.u('ev'), 'certificates', '{"enabled":true}');
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','pa','pb','jj','st']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner');
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('pa'), 'participant'), (tests.u('ev'), tests.u('pb'), 'participant'),
  (tests.u('ev'), tests.u('jj'), 'judge'), (tests.u('ev'), tests.u('st'), 'staff');
insert into public.checkins (event_id, user_id, method) values (tests.u('ev'), tests.u('pa'), 'desk');
insert into public.submission_forms (id, event_id, key, title) values (tests.u('form'), tests.u('ev'), 'project', 'Project');
insert into public.teams (id, event_id, name) values (tests.u('t'), tests.u('ev'), 'Mappers');
insert into public.team_members (event_id, team_id, user_id) values (tests.u('ev'), tests.u('t'), tests.u('pa'));
insert into public.submissions (id, event_id, form_id, team_id, title, status, submitted_at)
values (tests.u('s'), tests.u('ev'), tests.u('form'), tests.u('t'), 'Atlas', 'submitted', now());

select tests.as_user(tests.u('pa'));
select is((select array_agg(kind) from public.my_certificates(tests.u('ev'))), array['participation'], 'someone who checked in can claim a participation certificate');
reset role;
select tests.as_user(tests.u('pb'));
select is((select count(*)::integer from public.my_certificates(tests.u('ev'))), 0, 'someone who neither came nor submitted has none');
select throws_ok($$select public.claim_certificate(tests.u('ev'), 'participation')$$, '42501', null, 'and can''t claim one');
reset role;
select tests.as_user(tests.u('jj'));
select is((select array_agg(kind) from public.my_certificates(tests.u('ev'))), array['judge'], 'a judge can claim a judge certificate');
reset role;
select tests.as_user(tests.u('st'));
select is((select array_agg(kind) from public.my_certificates(tests.u('ev'))), array['volunteer'], 'staff can claim a volunteer one');
reset role;

select tests.as_user(tests.u('pa'));
create temp table made (code text) on commit drop;
grant all on made to anon, authenticated;
insert into made select public.claim_certificate(tests.u('ev'), 'participation');
select is((select length(code) from made), 10, 'a certificate has a ten character code');
select is(public.claim_certificate(tests.u('ev'), 'participation'), (select code from made), 'claiming again gives the same one');
reset role;
select tests.as_anon();
select is(public.verify_certificate((select lower(code) from made)) ->> 'name', 'pa', 'anyone with the code can check it, in any case');
reset role;

insert into public.awards (event_id, kind, label, submission_id) values (tests.u('ev'), 'special', 'Best pitch', tests.u('s'));
select tests.as_user(tests.u('pa'));
select is((select count(*)::integer from public.my_certificates(tests.u('ev')) where kind = 'award'), 0, 'an award certificate waits for published results');
reset role;
insert into public.result_publications (event_id, rows) values (tests.u('ev'), '[]');
select tests.as_user(tests.u('pa'));
select is((select label from public.my_certificates(tests.u('ev')) where kind = 'award'), 'Best pitch', 'and appears once they are out');
select throws_ok($$select public.issue_certificates(tests.u('ev'))$$, '42501', null, 'participants can''t issue certificates');
reset role;

select tests.as_user(tests.u('own'));
select is(public.issue_certificates(tests.u('ev')), 3, 'organizers issue the rest: the award, the judge and the volunteer');
select public.revoke_certificate((select id from public.certificates where code = (select code from made)));
reset role;
select tests.as_anon();
select is((public.verify_certificate((select code from made)) ->> 'revoked')::boolean, true, 'a withdrawn certificate says so');
reset role;
select tests.as_user(tests.u('pa'));
select isnt(public.claim_certificate(tests.u('ev'), 'participation'), (select code from made), 'a new claim after withdrawal gets a new code');
reset role;

select tests.as_user(tests.u('own'));
select public.save_certificate_template(tests.u('org'), 'judge',
  '{"background":{"color":"#ffffff","image":null,"frame":false},"layers":[{"id":"a","type":"text","x":10,"y":10,"w":100,"h":20,"text":"Thanks {{name}}!"}]}',
  'portrait', tests.u('ev'));
reset role;
select set_config('t.judge', (select c.code from public.certificates c where c.event_id = tests.u('ev') and c.kind = 'judge'), true);
select tests.as_anon();
select is(public.verify_certificate(current_setting('t.judge')) #>> '{layout,layers,0,text}', 'Thanks {{name}}!', 'a certificate carries the event''s design');
reset role;

select * from finish();
rollback;
