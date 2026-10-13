begin;
select plan(18);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha'), (tests.u('other'), 'beta', 'Beta');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max)
values (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public', 1, 4);
insert into public.event_windows (event_id, key, override) values (tests.u('ev'), 'voting', 'open'), (tests.u('ev'), 'gallery', 'open');
insert into public.submission_forms (id, event_id, key, title) values (tests.u('form'), tests.u('ev'), 'project', 'Project'), (tests.u('alt'), tests.u('ev'), 'alt', 'Alt');
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','pa','pb','j1','fan','own2']) n;
insert into public.org_members (org_id, user_id, role) values
  (tests.u('org'), tests.u('own'), 'owner'), (tests.u('org'), tests.u('fan'), 'member'), (tests.u('other'), tests.u('own2'), 'owner');
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('pa'), 'participant'), (tests.u('ev'), tests.u('pb'), 'participant'), (tests.u('ev'), tests.u('j1'), 'judge');
insert into public.teams (id, event_id, name) values (tests.u('ta'), tests.u('ev'), 'A'), (tests.u('tb'), tests.u('ev'), 'B'), (tests.u('tc'), tests.u('ev'), 'C');
insert into public.team_members (event_id, team_id, user_id) values (tests.u('ev'), tests.u('ta'), tests.u('pa')), (tests.u('ev'), tests.u('tb'), tests.u('pb'));
insert into public.submissions (id, event_id, form_id, team_id, title, status, submitted_at) values
  (tests.u('sa'), tests.u('ev'), tests.u('form'), tests.u('ta'), 'A', 'submitted', now()),
  (tests.u('sb'), tests.u('ev'), tests.u('form'), tests.u('tb'), 'B', 'submitted', now()),
  (tests.u('sc'), tests.u('ev'), tests.u('form'), tests.u('tc'), 'C', 'submitted', now()),
  (tests.u('sd'), tests.u('ev'), tests.u('alt'), tests.u('tc'), 'Draft', 'draft', null);

select tests.as_user(tests.u('pa'));
select throws_ok($$select public.cast_vote(tests.u('sb'))$$, '42501', null, 'voting is off until it is enabled');
reset role;
insert into public.settings (scope, event_id, namespace, value) values ('event', tests.u('ev'), 'voting', '{"enabled":true}');

select tests.as_user(tests.u('pa'));
select lives_ok($$select public.cast_vote(tests.u('sb'))$$, 'a participant votes for another team');
select throws_ok($$select public.cast_vote(tests.u('sa'))$$, '42501', null, 'but not their own');
select throws_ok($$select public.cast_vote(tests.u('sc'))$$, '22023', null, 'and only once with the default of one vote');
select lives_ok($$select public.cast_vote(tests.u('sb'))$$, 'voting again for the same project changes nothing');
select is((select count(*)::integer from public.votes), 1, 'it stays one vote');
select throws_ok($$insert into public.votes (event_id, submission_id, voter_id) values (tests.u('ev'), tests.u('sc'), tests.u('pa'))$$, '42501', null, 'votes can''t be written directly');
reset role;
select is((select count(*)::integer from public.audit_log where event_id = tests.u('ev') and action = 'vote.cast'), 1, 'a vote is audited once');

select tests.as_user(tests.u('pa'));
select lives_ok($$select public.retract_vote(tests.u('sb'))$$, 'a vote can be taken back');
select lives_ok($$select public.cast_vote(tests.u('sc'))$$, 'and used elsewhere');
select throws_ok($$select public.cast_vote(tests.u('sd'))$$, '22023', null, 'drafts can''t be voted for');
reset role;

select tests.as_user(tests.u('j1'));
select throws_ok($$select public.cast_vote(tests.u('sb'))$$, '42501', null, 'judges don''t vote by default');
reset role;
update public.settings set value = '{"enabled":true,"who":"members"}' where event_id = tests.u('ev') and namespace = 'voting';
select tests.as_user(tests.u('j1'));
select lives_ok($$select public.cast_vote(tests.u('sb'))$$, 'but may when everyone in the event can');
reset role;
select tests.as_user(tests.u('fan'));
select throws_ok($$select public.cast_vote(tests.u('sb'))$$, '42501', null, 'an outsider can''t');
reset role;
update public.settings set value = '{"enabled":true,"who":"signedIn"}' where event_id = tests.u('ev') and namespace = 'voting';
select tests.as_user(tests.u('fan'));
select lives_ok($$select public.cast_vote(tests.u('sb'))$$, 'unless any account in the org may, with a public gallery');
reset role;

select tests.as_user(tests.u('pa'));
select is((select count(*)::integer from public.vote_counts(tests.u('ev'))), 0, 'participants see no counts while voting is open');
reset role;
select tests.as_user(tests.u('own'));
select is((select votes::integer from public.vote_counts(tests.u('ev')) where submission_id = tests.u('sb')), 2, 'organizers see them');
reset role;
update public.settings set value = '{"enabled":true,"who":"signedIn","showCounts":true}' where event_id = tests.u('ev') and namespace = 'voting';
select tests.as_anon();
select is((select votes::integer from public.vote_counts(tests.u('ev')) where submission_id = tests.u('sb')), 2, 'and everyone can when the event shows counts');
reset role;

select * from finish();
rollback;
