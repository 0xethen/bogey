begin;
select plan(13);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha'), (tests.u('other'), 'beta', 'Beta');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max, starts_at)
values (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public', 1, 4, now() - interval '1 day');
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['ada','pal','far']) n;
insert into public.org_members (org_id, user_id, role) values
  (tests.u('org'), tests.u('ada'), 'member'), (tests.u('org'), tests.u('pal'), 'member'), (tests.u('other'), tests.u('far'), 'member');
insert into public.event_members (event_id, user_id, role) values (tests.u('ev'), tests.u('ada'), 'participant');
update public.profiles set handle = 'ada', bio_md = 'I build maps', links = '[{"kind":"website","url":"https://ada.test"}]'
where id = tests.u('ada');
insert into public.event_windows (event_id, key, override) values (tests.u('ev'), 'gallery', 'open');
insert into public.submission_forms (id, event_id, key, title) values (tests.u('form'), tests.u('ev'), 'project', 'Project');
insert into public.teams (id, event_id, name) values (tests.u('t'), tests.u('ev'), 'Mappers');
insert into public.team_members (event_id, team_id, user_id) values (tests.u('ev'), tests.u('t'), tests.u('ada'));
insert into public.submissions (id, event_id, form_id, team_id, title, status, submitted_at)
values (tests.u('s'), tests.u('ev'), tests.u('form'), tests.u('t'), 'Atlas', 'submitted', now());
insert into public.checkins (event_id, user_id, method) values (tests.u('ev'), tests.u('ada'), 'desk');

update public.settings set value = value - 'portfolios' where scope = 'instance' and namespace = 'accounts';
select tests.as_user(tests.u('pal'));
select is(public.public_profile('ada'), null, 'nobody has a page while the instance has portfolios off');
select is(public.portfolios_enabled(), false, 'which is the default');
reset role;
insert into public.settings (scope, namespace, value) values ('instance', 'accounts', '{"portfolios": true}')
on conflict (scope, org_id, event_id, namespace) do update set value = public.settings.value || excluded.value;

select tests.as_anon();
select is(public.public_profile('ada'), null, 'a signed-out visitor sees nothing while the profile is for the organization');
reset role;
select tests.as_user(tests.u('far'));
select is(public.public_profile('ada'), null, 'and so does someone in another organization');
reset role;
select tests.as_user(tests.u('pal'));
select is(public.public_profile('ada') ->> 'name', (select display_name from public.profiles where id = tests.u('ada')), 'but a fellow member sees it');
select is(public.public_profile('ada') -> 'projects' -> 0 ->> 'title', 'Atlas', 'with the projects shared in the open gallery');
select is(jsonb_array_length(public.public_profile('ada') -> 'events'), 1, 'and the events they came to');
reset role;

update public.profiles set visibility = 'public' where id = tests.u('ada');
select tests.as_anon();
select is(public.public_profile('ada') ->> 'bio', 'I build maps', 'a public profile is for anyone');
select is(public.public_profile('nobody'), null, 'an unknown handle gives nothing');
reset role;

update public.event_windows set override = 'closed' where event_id = tests.u('ev') and key = 'gallery';
select tests.as_anon();
select is(jsonb_array_length(public.public_profile('ada') -> 'projects'), 0, 'projects disappear when the gallery closes');
reset role;

select throws_ok($$update public.profiles set visibility = 'friends' where id = tests.u('ada')$$, '23514', null, 'visibility is org or public');
select throws_ok($$update public.profiles set links = (select jsonb_agg('{"kind":"website","url":"https://a.test"}'::jsonb) from generate_series(1, 9)) where id = tests.u('ada')$$, '23514', null, 'a profile has at most eight links');
select throws_ok($$update public.profiles set handle = 'Bad Handle' where id = tests.u('ada')$$, '23514', null, 'handles are lowercase letters, numbers and underscores');

select * from finish();
rollback;
