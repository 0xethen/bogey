begin;
select plan(16);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name) values (tests.u('ev'), tests.u('org'), 'ev', 'Ev');
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','p1','p2','new','lead']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner');
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('p1'), 'participant'), (tests.u('ev'), tests.u('p2'), 'participant'),
  (tests.u('ev'), tests.u('lead'), 'organizer');
insert into public.teams (id, event_id, name) values (tests.u('t1'), tests.u('ev'), 'Rockets');

update public.events set name = 'Seeded' where id = tests.u('ev');
select is((select count(*)::integer from public.audit_log where event_id = tests.u('ev')), 0, 'no session, no audit');

create function pg_temp.last(p_action text) returns jsonb language sql as $$
  select meta from public.audit_log where org_id = tests.u('org') and action = p_action order by id desc limit 1
$$;

select tests.as_user(tests.u('own'));
update public.events set name = 'Hack Night', description_md = 'Long text' where id = tests.u('ev');
insert into public.settings (scope, event_id, namespace, value) values ('event', tests.u('ev'), 'judging', '{"blind": true}');
insert into public.settings (scope, org_id, namespace, value) values ('org', tests.u('org'), 'branding', '{"name": "Alpha"}');
update public.event_members set role = 'judge' where user_id = tests.u('p2') and event_id = tests.u('ev');
update public.event_members set status = 'removed' where user_id = tests.u('p2') and event_id = tests.u('ev');
update public.teams set name = 'Rocketz', locked_at = now() where id = tests.u('t1');
delete from public.teams where id = tests.u('t1');
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('new'), 'member');
reset role;

select is(pg_temp.last('event.updated') -> 'fields', '["description_md", "name"]', 'event edits list the fields');
select is(pg_temp.last('event.updated') -> 'changes' -> 'name', '{"from": "Seeded", "to": "Hack Night"}', 'and old and new values of short ones');
select ok(not (pg_temp.last('event.updated') -> 'changes') ? 'description_md', 'but not of long ones');
select is((select actor_id from public.audit_log where action = 'event.updated' and event_id = tests.u('ev')), tests.u('own'), 'the actor is the session user');
select is((select meta from public.audit_log where action = 'settings.changed' and event_id = tests.u('ev')), '{"namespace": "judging", "keys": ["blind"]}', 'settings record the keys, not values');
select is((select meta ->> 'namespace' from public.audit_log where action = 'settings.changed' and org_id = tests.u('org') and event_id is null), 'branding', 'org settings are logged on the org');
select is(pg_temp.last('member.role_changed'), '{"from": "participant", "to": "judge"}', 'role changes are logged');
select is(pg_temp.last('member.removed'), '{"role": "judge"}', 'removals are logged');
select is(pg_temp.last('team.renamed'), '{"from": "Rockets", "to": "Rocketz"}', 'renames are logged');
select ok(pg_temp.last('team.locked') is not null, 'locks are logged');
select is(pg_temp.last('team.deleted'), '{"name": "Rocketz"}', 'deletes are logged');
select is(pg_temp.last('org.member_added'), '{"role": "member"}', 'org members are logged');

select tests.as_user(tests.u('p1'));
select is_empty('select 1 from public.audit_log', 'participants can''t read the log');
reset role;
select tests.as_user(tests.u('lead'));
select is_empty('select 1 from public.audit_log', 'neither can an event''s organizers: it''s the org admins''');
select lives_ok($$select * from public.event_blocked_access(tests.u('ev'))$$, 'but they see refused writes in their event');
reset role;

select * from finish();
rollback;
