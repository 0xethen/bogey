begin;
select plan(16);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max)
values (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public', 1, 4);
insert into public.event_windows (event_id, key, override) values (tests.u('ev'), 'gallery', 'open'), (tests.u('ev'), 'submissions', 'open');
insert into public.submission_forms (id, event_id, key, title) values (tests.u('form'), tests.u('ev'), 'project', 'Project');
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','pa','pb','fan']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner');
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('pa'), 'participant'), (tests.u('ev'), tests.u('pb'), 'participant');
insert into public.teams (id, event_id, name) values (tests.u('ta'), tests.u('ev'), 'A'), (tests.u('tb'), tests.u('ev'), 'B');
insert into public.team_members (event_id, team_id, user_id) values
  (tests.u('ev'), tests.u('ta'), tests.u('pa')), (tests.u('ev'), tests.u('tb'), tests.u('pb'));
insert into public.submissions (id, event_id, form_id, team_id, title, status, submitted_at) values
  (tests.u('sa'), tests.u('ev'), tests.u('form'), tests.u('ta'), 'A', 'submitted', now()),
  (tests.u('sb'), tests.u('ev'), tests.u('form'), tests.u('tb'), 'B', 'submitted', now());
insert into public.submission_files (id, event_id, submission_id, item_key, storage_path, file_name, size_bytes) values
  (tests.u('fa'), tests.u('ev'), tests.u('sa'), 'shot', tests.u('ev') || '/a/shot.png', 'shot.png', 10),
  (tests.u('fb'), tests.u('ev'), tests.u('sb'), 'shot', tests.u('ev') || '/b/shot.png', 'shot.png', 10);

select tests.as_user(tests.u('pa'));
select lives_ok($$select public.set_gallery_look(tests.u('sa'), 'standard', tests.u('fa'))$$, 'a team picks one of its images as the banner');
select is((select is_banner from public.submission_files where id = tests.u('fa')), true, 'it is marked');
select throws_ok($$select public.set_gallery_look(tests.u('sa'), 'standard', tests.u('fb'))$$, '22023', null, 'but not another team''s file');
select throws_ok($$select public.set_gallery_look(tests.u('sb'), 'standard', null)$$, '42501', null, 'nor another team''s project');
select throws_ok($$select public.set_gallery_look(tests.u('sa'), 'large', tests.u('fa'))$$, '42501', null, 'card sizes are the organizers'' until they allow it');
select throws_ok($$update public.submissions set card_size = 'large' where id = tests.u('sa')$$, '42501', null, 'and can''t be written around the function');
reset role;
insert into public.settings (scope, event_id, namespace, value) values ('event', tests.u('ev'), 'gallery', '{"teamSizes":true,"teamBanners":false}');
select tests.as_user(tests.u('pa'));
select lives_ok($$select public.set_gallery_look(tests.u('sa'), 'large', tests.u('fa'))$$, 'allowed, a team sets its size');
select throws_ok($$select public.set_gallery_look(tests.u('sa'), 'large', null)$$, '42501', null, 'while banners switched to organizers can''t change');
reset role;
select is((select count(*)::integer from public.audit_log where event_id = tests.u('ev') and action = 'submission.gallery_look_set'), 2, 'each change is audited');

select tests.as_user(tests.u('fan'));
select throws_ok($$select public.set_gallery_like(tests.u('sa'), true)$$, '42501', null, 'likes are off by default');
reset role;
update public.settings set value = '{"likes":true,"comments":true}' where event_id = tests.u('ev') and namespace = 'gallery';
select tests.as_user(tests.u('fan'));
select lives_ok($$select public.set_gallery_like(tests.u('sa'), true)$$, 'a signed-in visitor likes once organizers allow it');
select lives_ok($$select public.post_gallery_comment(tests.u('sa'), 'Nice work')$$, 'and comments');
select throws_ok($$select public.post_gallery_comment(tests.u('sa'), '   ')$$, '22023', null, 'but not with an empty comment');
reset role;
select tests.as_anon();
select is((select likes::integer from public.gallery_engagement(tests.u('ev')) where submission_id = tests.u('sa')), 1, 'anyone sees the counts');
select is((select count(*)::integer from public.gallery_thread(tests.u('sa'))), 1, 'and the thread');
reset role;
insert into public.gallery_comments (id, event_id, submission_id, author_id, body)
values (tests.u('c1'), tests.u('ev'), tests.u('sa'), tests.u('fan'), 'Hi');
select tests.as_user(tests.u('pb'));
select throws_ok($$select public.delete_gallery_comment(tests.u('c1'))$$, '42501', null, 'only the author or an organizer removes a comment');
reset role;

select * from finish();
rollback;
