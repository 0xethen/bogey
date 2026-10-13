begin;
select plan(7);

select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['org1']) n;
insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('org1'), 'owner');
insert into public.events (id, org_id, slug, name, visibility) values (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public');
insert into public.submission_forms (id, event_id, key, title) values (tests.u('form'), tests.u('ev'), 'project', 'Project');

select tests.as_user(tests.u('org1'));

select throws_ok($$select public.save_submission_form(tests.u('ev'), jsonb_build_object('id', tests.u('form'), 'title', 'Project'),
  '[{"key":"sketch","label":"Sketch","kind":"sketch.canvas"}]')$$, '22023', null, 'a plugin''s item type needs the plugin on');
reset role;

insert into public.settings (scope, event_id, namespace, value) values ('event', tests.u('ev'), 'plugins', '{"enabled":["sketch"]}');
select tests.as_user(tests.u('org1'));
select lives_ok($$select public.save_submission_form(tests.u('ev'), jsonb_build_object('id', tests.u('form'), 'title', 'Project'),
  '[{"key":"sketch","label":"Sketch","kind":"sketch.canvas","config":{"maxStrokes":50}},{"key":"pitch","label":"Pitch","kind":"longtext"}]')$$,
  'it goes in once the plugin is on');
reset role;
select is((select kind from public.submission_items where form_id = tests.u('form') and key = 'sketch'), 'sketch.canvas', 'the kind is stored as written');
select is((select config ->> 'maxStrokes' from public.submission_items where form_id = tests.u('form') and key = 'sketch'), '50', 'with its settings');

select throws_ok($$insert into public.submission_items (event_id, form_id, key, label, kind)
  values (tests.u('ev'), tests.u('form'), 'bad', 'Bad', 'sketch')$$, '23514', null, 'a bare unknown kind is refused');
select throws_ok($$insert into public.submission_items (event_id, form_id, key, label, kind)
  values (tests.u('ev'), tests.u('form'), 'bad2', 'Bad', 'Sketch.Canvas')$$, '23514', null, 'so is one in the wrong case');

update public.settings set value = '{"enabled":[]}' where scope = 'event' and event_id = tests.u('ev') and namespace = 'plugins';
select tests.as_user(tests.u('org1'));
select lives_ok($$select public.save_submission_form(tests.u('ev'), jsonb_build_object('id', tests.u('form'), 'title', 'Project'),
  '[{"key":"pitch","label":"Pitch","kind":"longtext"}]')$$, 'a form without the plugin''s items still saves');
reset role;

select * from finish();
rollback;
