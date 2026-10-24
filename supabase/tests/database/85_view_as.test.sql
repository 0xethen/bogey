begin;
select plan(12);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'viewas', 'View As');
insert into public.events (id, org_id, slug, name, visibility) values
  (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'unlisted');
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['boss','admin','part']) n;
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('boss'), 'organizer'),
  (tests.u('ev'), tests.u('part'), 'participant');
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('admin'), 'admin');

select tests.as_user(tests.u('boss'));
select is(private.event_role(tests.u('ev'))::text, 'organizer', 'an organizer is an organizer');

select set_config('request.headers', '{"x-bogey-view-as":"participant"}', true);
select is(private.event_role(tests.u('ev'))::text, 'participant', 'previewing a participant, the database sees one');
select ok(not private.has_permission(tests.u('ev'), 'event.manage'), 'and they can''t manage the event');
select ok(private.has_permission(tests.u('ev'), 'event.compete'), 'but hold what participants hold');
select is(private.event_gate(tests.u('ev')), null, 'plugin gates still let them through');

select set_config('request.headers', '{"x-bogey-view-as":"judge"}', true);
select ok(private.has_permission(tests.u('ev'), 'judging.score'), 'previewing a judge grants what judges hold');
select ok(not private.has_permission(tests.u('ev'), 'people.view'), 'and nothing else');

select set_config('request.headers', '{"x-bogey-view-as":"organizer"}', true);
select is(private.event_role(tests.u('ev'))::text, 'organizer', 'an unknown preview is ignored');
reset role;

select tests.as_user(tests.u('part'));
select set_config('request.headers', '{"x-bogey-view-as":"judge"}', true);
select is(private.event_role(tests.u('ev'))::text, 'participant', 'a participant can''t preview their way up');
select ok(not private.has_permission(tests.u('ev'), 'judging.score'), 'or gain a judge''s permissions');
reset role;

select tests.as_user(tests.u('admin'));
select set_config('request.headers', '{"x-bogey-view-as":"staff"}', true);
select ok(not private.is_org_admin(tests.u('org')), 'an org admin previewing is a member of the org');
select is(private.event_role(tests.u('ev'))::text, 'staff', 'and the previewed role in its events');
reset role;

select * from finish();
rollback;
