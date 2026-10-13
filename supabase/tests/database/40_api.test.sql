begin;
select plan(16);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max, starts_at, ends_at) values
  (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public', 1, 4, now() + interval '1 day', now() + interval '2 days'),
  (tests.u('ev2'), tests.u('org'), 'ev2', 'Ev2', 'public', 1, 4, now() + interval '1 day', now() + interval '2 days');
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','org1','pa']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner');
insert into public.event_members (event_id, user_id, role) values
  (tests.u('ev'), tests.u('org1'), 'organizer'), (tests.u('ev'), tests.u('pa'), 'participant');
insert into public.event_windows (event_id, key, opens_at, closes_at)
values (tests.u('ev'), 'submissions', now() + interval '1 day', now() + interval '2 days');

select tests.as_user(tests.u('pa'));
create temp table made (token text) on commit drop;
grant all on made to anon, authenticated;
insert into made select public.create_calendar_token();
select ok((select token like 'bgc_%' from made), 'a person makes a calendar token');
select is((select count(*)::integer from public.calendar_tokens), 1, 'and sees that they have one');
reset role;
select tests.as_anon();
select is(jsonb_array_length(public.calendar_feed((select token from made)) -> 'windows'), 1, 'the token opens a feed without a session, with the person''s windows');
select is(public.calendar_feed('bgc_nope'), null, 'an unknown token gets nothing');
reset role;
select tests.as_user(tests.u('pa'));
select public.revoke_calendar_token();
reset role;
select is(public.calendar_feed((select token from made)), null, 'a revoked token stops working');

select tests.as_user(tests.u('pa'));
select throws_ok($$select * from public.create_webhook(tests.u('org'), null, 'https://hooks.example.com/a', array['window.opened'])$$, '42501', null, 'participants can''t add webhooks');
reset role;
select tests.as_user(tests.u('own'));
create temp table hooks (id uuid, secret text) on commit drop;
grant all on hooks to authenticated;
insert into hooks select * from public.create_webhook(tests.u('org'), null, 'https://hooks.example.com/a', array['window.opened', 'team.created']);
select ok((select secret like 'whsec_%' from hooks), 'an org admin adds one and gets its secret');
select throws_ok($$select * from public.create_webhook(tests.u('org'), null, 'http://hooks.example.com/a', array['window.opened'])$$, '23514', null, 'plain http is refused');
select throws_ok($$select * from public.create_webhook(tests.u('org'), null, 'https://localhost/a', array['window.opened'])$$, '23514', null, 'so are names inside the network');
select throws_ok($$select * from public.create_webhook(tests.u('org'), null, 'https://hooks.example.com/a', array['nope'])$$, '23514', null, 'and kinds that don''t exist');
select is((select count(*)::integer from public.webhook_secrets), 0, 'the signing secret can''t be read back');
reset role;
select tests.as_user(tests.u('org1'));
select lives_ok($$select * from public.create_webhook(tests.u('org'), tests.u('ev'), 'https://hooks.example.com/b', array['window.opened'])$$, 'an event organizer adds one for their event');
select throws_ok($$select * from public.create_webhook(tests.u('org'), tests.u('ev2'), 'https://hooks.example.com/c', array['window.opened'])$$, '42501', null, 'but not for another event');
reset role;

select private.audit(tests.u('ev'), 'window.opened', 'window', null, '{"key":"submissions"}');
select is((select count(*)::integer from public.webhook_deliveries where org_id = tests.u('org') and kind = 'window.opened'), 2, 'an audited window change queues a delivery for each webhook that asked');
select private.audit(tests.u('ev2'), 'window.opened', 'window', null, '{"key":"x"}');
select is((select count(*)::integer from public.webhook_deliveries where event_id = tests.u('ev2')), 1, 'the org-wide webhook also hears about other events');
select private.audit(tests.u('ev'), 'form.saved', 'form', null, '{}');
select is((select count(*)::integer from public.webhook_deliveries where org_id = tests.u('org') and kind not in ('window.opened')), 0, 'actions no webhook can ask for queue nothing');

select * from finish();
rollback;
