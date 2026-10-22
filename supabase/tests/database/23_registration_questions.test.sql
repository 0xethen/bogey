begin;
select plan(26);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha'), (tests.u('other'), 'beta', 'Beta');
insert into public.settings (scope, org_id, namespace, value) values ('org', tests.u('org'), 'registration', '{"signup":"open","mode":"review"}');
insert into public.events (id, org_id, slug, name, visibility, starts_at, timezone)
values (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public', '2026-10-10 09:00+00', 'UTC');
insert into public.event_windows (event_id, key, override) values (tests.u('ev'), 'registration', 'open');
select tests.create_user(tests.u(n), n || '@t.test', '{"org":"alpha"}') from unnest(array['adult','minor','minor2','staff','other']) n;
select tests.create_user(tests.u('own2'), 'own2@t.test', '{"org":"beta"}');
insert into public.org_members (org_id, user_id, role) values (tests.u('other'), tests.u('own2'), 'owner');
insert into public.event_members (event_id, user_id, role) values (tests.u('ev'), tests.u('staff'), 'staff');

select throws_ok($$insert into public.onboarding_forms (event_id, fields) values (tests.u('ev'), '[{"key":"a","label":"A","kind":"hologram","required":false}]')$$, '22023', null, 'an unknown question type is refused');
select throws_ok($$insert into public.onboarding_forms (event_id, fields) values (tests.u('ev'), '[{"key":"a","label":"A","kind":"text","required":false,"showWhen":{"field":"b","in":["x"]}},{"key":"b","label":"B","kind":"text","required":false}]')$$, '22023', null, 'a question can only depend on one above it');
select throws_ok($$insert into public.onboarding_forms (event_id, fields) values (tests.u('ev'), '[{"key":"a","label":"A","kind":"text","required":false},{"key":"b","label":"B","kind":"text","required":false,"showWhen":{"field":"a","ageUnder":18}}]')$$, '22023', null, 'an age condition needs a date question');
select throws_ok($$insert into public.onboarding_forms (event_id, fields) values (tests.u('ev'), '[{"key":"c","label":"C","kind":"consent","required":true}]')$$, '22023', null, 'consent needs its text');
insert into public.onboarding_forms (event_id, fields) values (tests.u('ev'), $json$[
  {"key":"dob","label":"Date of birth","kind":"date","required":true},
  {"key":"guardian","label":"Guardian","kind":"text","required":true,"showWhen":{"field":"dob","ageUnder":18}},
  {"key":"slip","label":"Permission slip","kind":"file","required":true,"showWhen":{"field":"dob","ageUnder":18}},
  {"key":"photo","label":"Photo consent","kind":"consent","required":true,"text":"We may photograph you."},
  {"key":"langs","label":"Languages","kind":"multiselect","required":false,"options":["Python","Rust"]},
  {"key":"years","label":"Years coding","kind":"number","required":false,"min":0,"max":80},
  {"key":"phone","label":"Phone","kind":"phone","required":false}
]$json$);

select tests.as_user(tests.u('adult'));
select is(
  (public.register_for_event(tests.u('ev'), '{"dob":"2000-05-05","guardian":"Someone","photo":{"accepted":true},"langs":["Rust"],"years":3,"phone":"+1 (555) 010-9999"}')).answers - 'photo',
  '{"dob":"2000-05-05","langs":["Rust"],"years":3,"phone":"+1 (555) 010-9999"}'::jsonb,
  'an adult keeps their answers and loses the guardian one');
reset role;
select is((select answers #>> '{photo,textHash}' from public.registrations where user_id = tests.u('adult')), encode(extensions.digest('We may photograph you.', 'sha256'), 'hex'), 'consent stores a hash of the text agreed to');
select ok((select (answers #>> '{photo,at}') is not null from public.registrations where user_id = tests.u('adult')), 'and when');

select tests.as_user(tests.u('minor'));
select throws_ok($$select public.register_for_event(tests.u('ev'), '{"dob":"2012-05-05","photo":{"accepted":true}}')$$, '23502', null, 'a minor must name a guardian');
select throws_ok($$select public.register_for_event(tests.u('ev'), '{"dob":"2012-05-05","guardian":"Parent","slip":{"path":"x/y/slip.pdf","name":"slip.pdf","size":1,"type":"application/pdf"},"photo":{"accepted":true}}')$$, '22023', null, 'a file has to be one in their own folder');
reset role;
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('registrations', tests.u('ev')::text || '/' || tests.u('minor')::text || '/slip.pdf', tests.u('minor')::text, '{"size":1234,"mimetype":"application/pdf"}'),
  ('registrations', tests.u('ev')::text || '/' || tests.u('minor2')::text || '/slip.pdf', tests.u('minor2')::text, '{"size":99,"mimetype":"application/pdf"}');
select tests.as_user(tests.u('minor'));
select throws_ok(format($$select public.register_for_event(tests.u('ev'), '{"dob":"2012-05-05","guardian":"Parent","slip":{"path":"%s/%s/missing.pdf","name":"m.pdf","size":1,"type":"application/pdf"},"photo":{"accepted":true}}')$$, tests.u('ev'), tests.u('minor')), '22023', null, 'and exist');
select throws_ok(format($$select public.register_for_event(tests.u('ev'), '{"dob":"2012-05-05","guardian":"Parent","slip":{"path":"%s/%s/slip.pdf","name":"slip.pdf","size":1,"type":"application/pdf"},"photo":{"accepted":true}}')$$, tests.u('ev'), tests.u('minor2')), '22023', null, 'someone else''s upload is refused');
select is(
  (public.register_for_event(tests.u('ev'), format('{"dob":"2012-05-05","guardian":"Parent","slip":{"path":"%s/%s/slip.pdf","name":"slip.pdf","size":1,"type":"image/gif"},"photo":{"accepted":true}}', tests.u('ev'), tests.u('minor'))::jsonb)).answers #>> '{slip,size}',
  '1234', 'the stored size and type come from storage, not the browser');
reset role;

select tests.as_user(tests.u('minor2'));
select throws_ok($$select public.register_for_event(tests.u('ev'), '{"dob":"2000-01-01"}')$$, '23502', null, 'required consent has to be given');
select throws_ok($$select public.register_for_event(tests.u('ev'), '{"dob":"2000-01-01","photo":{"accepted":false}}')$$, '23502', null, 'and accepted');
select throws_ok($$select public.register_for_event(tests.u('ev'), '{"dob":"2000-02-30","photo":{"accepted":true}}')$$, '22023', null, 'a date has to be real');
select throws_ok($$select public.register_for_event(tests.u('ev'), '{"dob":"2000-01-01","photo":{"accepted":true},"langs":["Cobol"]}')$$, '22023', null, 'a multiple choice has to use the options');
select throws_ok($$select public.register_for_event(tests.u('ev'), '{"dob":"2000-01-01","photo":{"accepted":true},"years":99}')$$, '22023', null, 'a number respects its range');
select throws_ok($$select public.register_for_event(tests.u('ev'), '{"dob":"2000-01-01","photo":{"accepted":true},"years":"3"}')$$, '22023', null, 'and is a number, not text');
select throws_ok($$select public.register_for_event(tests.u('ev'), '{"dob":"2000-01-01","photo":{"accepted":true},"phone":"12"}')$$, '22023', null, 'a phone number has digits');
reset role;

select tests.as_user(tests.u('minor'));
select is((select count(*)::integer from storage.objects where bucket_id = 'registrations'), 1, 'a registrant sees their own file only');
reset role;
select tests.as_user(tests.u('staff'));
select is((select count(*)::integer from storage.objects where bucket_id = 'registrations'), 2, 'staff who see people see every file');
reset role;
select tests.as_user(tests.u('other'));
select is((select count(*)::integer from storage.objects where bucket_id = 'registrations'), 0, 'another registrant sees none');
reset role;
select tests.as_user(tests.u('own2'));
select is((select count(*)::integer from storage.objects where bucket_id = 'registrations'), 0, 'nor does another organization''s owner');
select throws_ok(format($$insert into storage.objects (bucket_id, name, owner_id) values ('registrations', '%s/%s/x.pdf', '%s')$$, tests.u('ev'), tests.u('minor'), tests.u('own2')), '42501', null, 'and nobody uploads into someone else''s folder');
reset role;

select is(private.age_on('2008-10-10', date '2026-10-10'), 18, 'age counts whole years');
select is(private.age_on('2008-10-11', date '2026-10-10'), 17, 'until the birthday');
select * from finish();
rollback;
