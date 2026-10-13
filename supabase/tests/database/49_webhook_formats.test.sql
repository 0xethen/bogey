begin;
select plan(10);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'hooks', 'Hooks');
insert into public.events (id, org_id, slug, name) values (tests.u('ev'), tests.u('org'), 'hooks', 'Hook *Jam*');

select is(private.webhook_format('https://discord.com/api/webhooks/1/abc'), 'discord', 'Discord addresses are recognized');
select is(private.webhook_format('https://hooks.slack.com/services/T/B/x'), 'slack', 'so are Slack ones');
select is(private.webhook_format('https://example.com/discord.com/api/webhooks/1'), 'json', 'anything else gets the signed JSON');

create temporary table payloads (name text primary key, payload jsonb) on commit drop;
insert into payloads values
  ('team', jsonb_build_object('kind', 'team.created', 'action', 'team.created',
    'event', jsonb_build_object('id', tests.u('ev'), 'slug', 'hooks', 'name', 'Hook *Jam*'),
    'data', jsonb_build_object('name', '@everyone [win](https://evil.test)'))),
  ('private', jsonb_build_object('kind', 'announcement.posted', 'action', 'announcement.posted',
    'event', jsonb_build_object('id', tests.u('ev'), 'slug', 'hooks', 'name', 'Hook Jam'),
    'data', jsonb_build_object('title', 'Team 4 only', 'everyone', false)));

select is(private.webhook_body('https://example.com/hook', (select payload from payloads where name = 'team')),
  (select payload from payloads where name = 'team'), 'other addresses get the payload unchanged');

select ok(starts_with(private.webhook_body('https://discord.com/api/webhooks/1/abc', (select payload from payloads where name = 'team')) ->> 'content',
  '**Hook \*Jam\*** · Team "\@everyone \[win\]\(https://evil.test\)" was created.'), 'Discord gets a line with what people typed escaped');
select is(private.webhook_body('https://discord.com/api/webhooks/1/abc', (select payload from payloads where name = 'team')) -> 'allowed_mentions',
  '{"parse": []}'::jsonb, 'and it can''t ping anyone');
select ok(private.webhook_body('https://hooks.slack.com/services/x', (select payload from payloads where name = 'team')) ->> 'text'
  like '*Hook *Jam** · Team "@everyone [win](https://evil.test)" was created.%', 'Slack gets text');
select ok(private.webhook_body('https://discord.com/api/webhooks/1/abc', (select payload from payloads where name = 'private')) ->> 'content'
  like '%An announcement was posted.%', 'an announcement for some people doesn''t name itself in chat');

insert into public.webhooks (id, org_id, event_id, url, events) values
  (tests.u('hook'), tests.u('org'), tests.u('ev'), 'https://example.com/hook', array['announcement.posted']);
insert into public.webhook_secrets (webhook_id, secret) values (tests.u('hook'), 'secret');
insert into public.audit_log (org_id, event_id, action, target_type, target_id, meta)
values (tests.u('org'), tests.u('ev'), 'announcement.posted', 'announcement', tests.u('a1'),
  jsonb_build_object('title', 'Later', 'everyone', true, 'scheduled', true));
select is((select count(*)::integer from public.webhook_deliveries where webhook_id = tests.u('hook')), 0,
  'a scheduled announcement isn''t sent when it''s scheduled');

insert into public.announcements (id, event_id, title, body_md, everyone, publish_at, created_at)
values (tests.u('a1'), tests.u('ev'), 'Later', 'x', true, now() - interval '1 minute', now() - interval '1 hour');
select private.queue_due_announcement_webhooks();
select private.queue_due_announcement_webhooks();
select is((select count(*)::integer from public.webhook_deliveries where webhook_id = tests.u('hook')), 1,
  'it is sent once when it goes live');

select * from finish();
rollback;
