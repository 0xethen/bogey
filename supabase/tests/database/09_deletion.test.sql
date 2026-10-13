begin;
select plan(17);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max) values
  (tests.u('hack'), tests.u('org'), 'hack', 'Hack', 'public', 1, 4);
insert into public.event_windows (event_id, key, override) values
  (tests.u('hack'), 'teams', 'open'), (tests.u('hack'), 'submissions', 'open');
insert into public.submission_forms (id, event_id, key, title) values (tests.u('form'), tests.u('hack'), 'project', 'Project');

select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['p1','p2','org1','root','owner']) n;
insert into public.event_members (event_id, user_id, role) values
  (tests.u('hack'), tests.u('p1'), 'participant'), (tests.u('hack'), tests.u('p2'), 'participant'),
  (tests.u('hack'), tests.u('org1'), 'organizer');
delete from public.platform_admins;
insert into public.platform_admins (user_id) values (tests.u('root'));
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('owner'), 'owner');

select tests.as_user(tests.u('p1'));
select public.create_team(tests.u('hack'), 'Rockets');
insert into public.submissions (id, event_id, form_id, team_id, title)
  select tests.u('sub'), tests.u('hack'), tests.u('form'), id, 'Moonshot' from public.teams where name = 'Rockets';
select throws_ok($$update public.submissions set deletion_requested_at = now()$$, '42501', null, 'teams cannot set a deletion request directly');
reset role;

select tests.as_user(tests.u('p2'));
select throws_ok(format('select public.delete_submission(%L)', tests.u('sub')), '42501', null, 'only the team deletes its submission');
reset role;
select tests.as_user(tests.u('p1'));
select is((select public.delete_submission(id) from public.submissions where title = 'Moonshot'), 'deleted', 'teams delete by default');
reset role;
select is((select count(*)::int from public.audit_log where action = 'submission.deleted'), 1, 'deleting is audited');

insert into public.settings (scope, org_id, namespace, value) values ('org', tests.u('org'), 'submissions', '{"deletion":"request"}');
select tests.as_user(tests.u('p1'));
insert into public.submissions (event_id, form_id, team_id, title)
  select tests.u('hack'), tests.u('form'), id, 'Again' from public.teams where name = 'Rockets';
select is((select public.delete_submission(id) from public.submissions), 'requested', 'with "request" teams only ask');
select isnt((select deletion_requested_at from public.submissions), null, 'the request is recorded');
select lives_ok($$select public.cancel_submission_deletion(id) from public.submissions$$, 'teams withdraw a request');
select is((select deletion_requested_at from public.submissions), null, 'and it clears');
select public.delete_submission(id) from public.submissions;
reset role;
select tests.as_user(tests.u('org1'));
select lives_ok($$select public.cancel_submission_deletion(id) from public.submissions$$, 'organizers decline');
reset role;
select is((select count(*)::int from public.audit_log where action = 'submission.deletion_declined'), 1, 'declining is audited');

insert into public.settings (scope, event_id, namespace, value) values ('event', tests.u('hack'), 'submissions', '{"deletion":"none"}');
select tests.as_user(tests.u('p1'));
select throws_ok($$select public.delete_submission(id) from public.submissions$$, 'P0001', null, 'with "none" teams cannot delete or ask');
reset role;
select tests.as_user(tests.u('org1'));
select is((select public.delete_submission(id) from public.submissions), 'deleted', 'organizers always delete');
reset role;

select tests.as_user(tests.u('p1'));
select lives_ok($$insert into public.account_deletion_requests (user_id, reason) values (tests.u('p1'), 'done')$$, 'people ask to be deleted');
select is((public.account_deletion_status() ->> 'requestedAt') is not null, true, 'and see that they asked');
select throws_ok(format('select public.delete_account(%L)', tests.u('p2')), '42501', null, 'only platform admins delete accounts');
reset role;
insert into public.settings (scope, namespace, value) values ('instance', 'accounts', '{"deletionRequests":false}')
on conflict (scope, org_id, event_id, namespace) do update set value = excluded.value;
select tests.as_user(tests.u('p2'));
select throws_ok($$insert into public.account_deletion_requests (user_id) values (tests.u('p2'))$$, '42501', null, 'requests can be turned off');
reset role;
select tests.as_user(tests.u('root'));
select throws_ok(format('select public.delete_account(%L)', tests.u('owner')), '23514', null, 'the only owner of an org stays');
reset role;

select * from finish();
rollback;
