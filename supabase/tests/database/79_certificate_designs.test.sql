begin;
select plan(19);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'designs', 'Designs');
insert into public.events (id, org_id, slug, name) values (tests.u('ev'), tests.u('org'), 'designs-ev', 'Ev');
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','org1','pa']) n;
insert into public.org_members (org_id, user_id, role) values
  (tests.u('org'), tests.u('own'), 'owner'), (tests.u('org'), tests.u('org1'), 'member');
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('org1'), 'organizer'), (tests.u('ev'), tests.u('pa'), 'participant');

select set_config('t.org_folder', 'org/' || tests.u('org') || '/certificates/award', true);
select set_config('t.ev_folder', tests.u('ev') || '/certificates/award', true);
create temp table design (layout jsonb) on commit drop;
grant all on design to authenticated;
insert into design values (jsonb_build_object(
  'background', jsonb_build_object('color', '#ffffff', 'frame', false, 'image', jsonb_build_object(
    'path', current_setting('t.org_folder') || '/bg.png',
    'url', 'https://s.test/storage/v1/object/public/event-assets/' || current_setting('t.org_folder') || '/bg.png')),
  'layers', jsonb_build_array(
    jsonb_build_object('id', 'n', 'type', 'text', 'x', 10, 'y', 10, 'w', 100, 'h', 20, 'text', '{{name}}'),
    jsonb_build_object('id', 'logo', 'type', 'image', 'x', 0, 'y', 0, 'w', 20, 'h', 20, 'image', jsonb_build_object(
      'path', current_setting('t.org_folder') || '/logo.png',
      'url', 'https://s.test/storage/v1/object/public/event-assets/' || current_setting('t.org_folder') || '/logo.png')),
    jsonb_build_object('id', 'qr', 'type', 'qr', 'x', 250, 'y', 160, 'w', 30, 'h', 30))));
insert into storage.objects (bucket_id, name, created_at) values
  ('event-assets', current_setting('t.org_folder') || '/bg.png', now()),
  ('event-assets', current_setting('t.org_folder') || '/logo.png', now()),
  ('event-assets', current_setting('t.org_folder') || '/discarded.png', now() - interval '2 days'),
  ('event-assets', current_setting('t.org_folder') || '/fresh.png', now());

select tests.as_user(tests.u('org1'));
select throws_ok($$select public.save_certificate_template(tests.u('org'), 'award', (select layout from design))$$,
  '42501', null, 'event organizers can''t edit the organization''s designs');
reset role;

select tests.as_user(tests.u('own'));
select lives_ok($$select public.save_certificate_template(tests.u('org'), 'award', (select layout from design))$$,
  'org admins save a design with pictures in the organization''s folder');
select throws_ok($$select public.save_certificate_template(tests.u('org'), 'judge', (select layout from design), p_event => tests.u('ev'))$$,
  '22023', null, 'a design can''t point at another design''s files');
select throws_ok($$select public.save_certificate_template(tests.u('org'), 'judge',
  '{"background":{},"layers":[{"type":"text","x":"a"}]}', p_event => tests.u('ev'))$$, '22023', null, 'a broken layer is refused');
select throws_ok($$select public.save_certificate_template(tests.u('org'), 'judge',
  '{"background":{"image":{"url":"http://plain.test/x.png"}},"layers":[]}', p_event => tests.u('ev'))$$, '22023', null,
  'outside pictures need https');
reset role;

select is((select array_agg(path order by path) from private.storage_orphans where starts_with(path, current_setting('t.org_folder'))),
  array[current_setting('t.org_folder') || '/discarded.png'],
  'saving lists an upload nothing used for a day, not the fresh one');

select tests.as_user(tests.u('org1'));
select is((select count(*)::integer from public.certificate_templates where org_id = tests.u('org') and event_id is null), 1,
  'event organizers see the organization''s design their event falls back to');
create temp table copied (files jsonb) on commit drop;
grant all on copied to authenticated;
insert into copied select public.copy_certificate_template(tests.u('ev'), 'award');
select is(jsonb_array_length((select files from copied)), 2, 'copying returns both files to copy');
select is((select files -> 0 ->> 'to' from copied), current_setting('t.ev_folder') || '/bg.png',
  'into the event''s folder');
select is((select layout #>> '{background,image,url}' from public.certificate_templates where event_id = tests.u('ev') and kind = 'award'),
  'https://s.test/storage/v1/object/public/event-assets/' || current_setting('t.ev_folder') || '/bg.png',
  'and the copy points at the event''s files');
select throws_ok($$select public.copy_certificate_template(tests.u('ev'), 'award')$$, '23505', null,
  'an event copies a design once');
select throws_ok($$select public.copy_certificate_template(tests.u('ev'), 'judge')$$, 'P0002', null,
  'and only one the organization has');
reset role;

select tests.as_user(tests.u('pa'));
select throws_ok($$select public.copy_certificate_template(tests.u('ev'), 'award')$$, '42501', null,
  'participants can''t copy designs');
reset role;

delete from private.storage_orphans where starts_with(path, current_setting('t.org_folder'));
select tests.as_user(tests.u('own'));
select public.save_certificate_template(tests.u('org'), 'award',
  (select (layout #- '{layers,1}') || jsonb_build_object('background', jsonb_build_object('color', '#ffffff')) from design));
reset role;
select is((select array_agg(path order by path) from private.storage_orphans where starts_with(path, current_setting('t.org_folder'))),
  array[current_setting('t.org_folder') || '/bg.png', current_setting('t.org_folder') || '/discarded.png',
    current_setting('t.org_folder') || '/logo.png'],
  'removing a picture and the background lists their files');

insert into storage.objects (bucket_id, name) values ('event-assets', current_setting('t.ev_folder') || '/bg.png');
select tests.as_user(tests.u('org1'));
select public.save_certificate_template(tests.u('org'), 'award', null, p_event => tests.u('ev'));
reset role;
select ok(exists (select 1 from private.storage_orphans where path = current_setting('t.ev_folder') || '/bg.png'),
  'going back to the organization''s design lists the event''s copy');

select tests.as_user(tests.u('pa'));
select throws_ok($$select public.claim_storage_orphans()$$, '42501', null, 'only the app claims files to remove');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select ok((select public.claim_storage_orphans(1000)) @> jsonb_build_array(jsonb_build_object(
  'bucket', 'event-assets', 'path', current_setting('t.ev_folder') || '/bg.png')), 'the app claims queued files');
select is((select count(*)::integer from private.storage_orphans where path = current_setting('t.ev_folder') || '/bg.png'), 0,
  'and they leave the queue');
select set_config('request.jwt.claims', '{}', true);

delete from public.orgs where id = tests.u('org');
select ok(exists (select 1 from private.storage_orphans where path = current_setting('t.org_folder') || '/fresh.png'),
  'deleting the organization lists its folder');

select * from finish();
rollback;
