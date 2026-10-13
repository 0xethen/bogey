begin;
select plan(26);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, visibility) values (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public');
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','org2','p1','p2','j1']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner');
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('p1'), 'participant'), (tests.u('ev'), tests.u('p2'), 'participant'), (tests.u('ev'), tests.u('j1'), 'judge');

insert into public.settings (scope, namespace, value, locked_keys) values ('instance', 'ui', '{"a":1,"b":1,"c":1}', '{c}');
insert into public.settings (scope, org_id, namespace, value) values ('org', tests.u('org'), 'ui', '{"b":2,"c":2}');
insert into public.settings (scope, event_id, namespace, value) values ('event', tests.u('ev'), 'ui', '{"a":3}');
select is(private.event_setting(tests.u('ev'), 'ui'), '{"a":3,"b":2,"c":1}'::jsonb, 'event > org > instance; instance lock on c wins');
select tests.as_user(tests.u('p1'));
select is(public.settings_for(array['ui'], p_event => tests.u('ev')) -> 'ui', '{"a":3,"b":2,"c":1}'::jsonb, 'settings_for resolves for members');
reset role;
select tests.as_anon();
select is(public.settings_for(array['ui', 'branding'], p_event => tests.u('ev')) ? 'ui', false, 'anon gets no private namespaces');
select ok(public.settings_for(array['branding'], p_event => tests.u('ev')) ? 'branding', 'anon gets public namespaces');
reset role;

insert into public.settings (scope, event_id, namespace, value) values ('event', tests.u('ev'), 'plugins', '{"enabled":["checkin"]}');
select ok(private.plugin_enabled(tests.u('ev'), 'checkin'), 'enabled on the event');
insert into public.settings (scope, org_id, namespace, value) values ('org', tests.u('org'), 'plugins', '{"available":["challenges"]}');
select ok(not private.plugin_enabled(tests.u('ev'), 'checkin'), 'org availability limits it');

select tests.as_user(tests.u('own'));
select lives_ok($$select public.set_secret('org', tests.u('org'), null, 'discord.webhook', 'https://discord.test/hook')$$, 'owner sets an org secret');
select is((select name from public.secrets), 'discord.webhook', 'owner sees the secret name');
select throws_ok($$select private.secret(tests.u('ev'), 'discord.webhook')$$, '42501', null, 'owner cannot read the value');
select throws_ok($$select * from vault.decrypted_secrets$$, '42501', null, 'vault is closed to clients');
reset role;
select is(private.secret(tests.u('ev'), 'discord.webhook'), 'https://discord.test/hook', 'events inherit org secrets');
select tests.as_user(tests.u('p1'));
select is_empty('select 1 from public.secrets', 'participants see no secrets');
select throws_ok($$select public.set_secret('org', tests.u('org'), null, 'x', 'y')$$, '42501', null, 'participants cannot set secrets');
reset role;
select tests.as_user(tests.u('org2'));
select is_empty($$select 1 from public.settings where namespace = 'plugins' and org_id is not null$$, 'non-members see only public org namespaces');
reset role;

insert into public.announcements (id, event_id, title, everyone, publish_at) values
  (tests.u('a-all'), tests.u('ev'), 'All', true, now()), (tests.u('a-judges'), tests.u('ev'), 'Judges', false, now()),
  (tests.u('a-later'), tests.u('ev'), 'Later', true, now() + interval '1 day');
insert into public.announcement_audiences (event_id, announcement_id, role) values (tests.u('ev'), tests.u('a-judges'), 'judge');
select tests.as_user(tests.u('p1'));
select results_eq('select title from public.announcements order by title', array['All'], 'participants see published, everyone-audience posts');
reset role;
select tests.as_user(tests.u('j1'));
select results_eq('select title from public.announcements order by title', array['All', 'Judges'], 'judges also see judge posts');
reset role;

insert into public.settings (scope, event_id, namespace, value) values ('event', tests.u('ev'), 'chat', '{"enabled":true,"participants":true}');
select tests.as_user(tests.u('p1'));
select lives_ok($$insert into public.clarifications (id, event_id, subject, asked_by, visibility) values (tests.u('q1'), tests.u('ev'), 'Is Python allowed?', tests.u('p2'), 'public')$$, 'participant asks');
select is((select asked_by from public.clarifications), tests.u('p1'), 'asked_by comes from the session');
select is((select visibility::text from public.clarifications), 'private', 'participants cannot publish their own question');
select lives_ok($$insert into public.clarification_messages (event_id, clarification_id, body_md) values (tests.u('ev'), tests.u('q1'), 'please?')$$, 'asker adds detail');
select is((select author_role from public.clarification_messages), 'participant', 'author role is derived');
reset role;
select tests.as_user(tests.u('p2'));
select is_empty('select 1 from public.clarifications', 'other participants cannot see a private question');
reset role;
update public.clarifications set visibility = 'public';
select tests.as_user(tests.u('p2'));
select throws_ok($$insert into public.clarification_messages (event_id, clarification_id, body_md) values (tests.u('ev'), tests.u('q1'), 'me too')$$, '42501', null, 'public threads are read-only for others');
reset role;

select tests.as_user(tests.u('p2'));
select lives_ok($$select public.ask_clarification(tests.u('ev'), 'Can we use APIs?', 'Like OpenAI?')$$, 'participant asks through the RPC');
select is((select count(*)::int from public.clarification_messages m join public.clarifications c on c.id = m.clarification_id where c.subject = 'Can we use APIs?'), 1, 'the first message is stored with the question');
reset role;
update public.settings set value = value || '{"participants":false}' where event_id = tests.u('ev') and namespace = 'chat';
select tests.as_user(tests.u('p2'));
select throws_ok($$select public.ask_clarification(tests.u('ev'), 'Late?', 'too late')$$, '42501', null, 'with participants off, new questions are refused');
reset role;

select * from finish();
rollback;
