begin isolation level repeatable read;
select plan(19);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name) values (tests.u('ev'), tests.u('org'), 'ev', 'Ev');

select throws_ok($$select private.plugin_migration_end('zz-one')$$, '25000', null,
  'end without begin is refused');

select private.plugin_migration_begin('zz-one');
create table public.zz_one_notes (id int primary key, event_id uuid references public.events on delete cascade);
alter table public.zz_one_notes enable row level security;
create policy zz_one_notes_read on public.zz_one_notes for select to authenticated using (true);
create function public.zz_one_count() returns integer language sql as $$ select count(*)::integer from public.zz_one_notes $$;
create trigger zz_one_touch before update on public.events for each row execute function private.touch_updated_at();
do $$ begin perform cron.schedule('bogey-zz-one', '0 0 1 1 *', 'select 1'); end $$;
insert into storage.buckets (id, name) values ('zz-one', 'zz-one');
insert into public.roles (key, label, source) values ('zz-one.scribe', 'Scribe', 'zz-one');
insert into public.role_permissions (role_key, permission) values ('zz-one.scribe', 'zz-one.write'), ('organizer', 'zz-one.write');
select private.plugin_migration_end('zz-one');

select results_eq(
  $$select kind, identity from private.plugin_objects where plugin = 'zz-one' order by seq$$,
  $$values ('table', 'public.zz_one_notes'), ('function', 'public.zz_one_count()'),
           ('trigger', 'zz_one_touch on public.events'), ('cron job', 'bogey-zz-one'),
           ('storage bucket', 'zz-one')$$,
  'what it made is recorded; its table''s index and policy go with the table'
);

select private.plugin_migration_begin('zz-one');
alter table public.zz_one_notes add column body text;
alter table public.zz_one_notes rename to zz_one_entries;
create or replace function public.zz_one_count() returns integer language sql as $$ select 0 $$;
select private.plugin_migration_end('zz-one');
select is((select identity from private.plugin_objects where plugin = 'zz-one' order by seq limit 1),
  'public.zz_one_entries', 'a renamed table is recorded by its new name');

savepoint core_table;
select private.plugin_migration_begin('zz-one');
alter table public.events add column zz_one_flag boolean;
select throws_like($$select private.plugin_migration_end('zz-one')$$,
  '%changed table public.events, which belongs to Bogey%', 'changing a core table is refused');
rollback to savepoint core_table;

savepoint core_function;
select private.plugin_migration_begin('zz-one');
create or replace function private.plugin_enabled(p_event uuid, p_plugin text) returns boolean
  language sql stable security definer set search_path = '' as $$ select true $$;
select throws_like($$select private.plugin_migration_end('zz-one')$$,
  '%changed function private.plugin_enabled%', 'replacing a core function is refused');
rollback to savepoint core_function;

savepoint core_drop;
select private.plugin_migration_begin('zz-one');
drop trigger settings_touch on public.settings;
select throws_like($$select private.plugin_migration_end('zz-one')$$,
  '%dropped trigger settings_touch on public.settings%', 'dropping a core object is refused');
rollback to savepoint core_drop;

savepoint extension;
select private.plugin_migration_begin('zz-one');
create extension if not exists pg_trgm with schema extensions;
select throws_like($$select private.plugin_migration_end('zz-one')$$,
  '%created extension%', 'creating an extension is refused');
rollback to savepoint extension;

savepoint unshared;
select private.plugin_migration_begin('zz-two');
create table public.zz_two_links (id int primary key, note_id int references public.zz_one_entries);
select throws_like($$select private.plugin_migration_end('zz-two')$$,
  '%builds on public.zz_one_entries of the zz-one plugin, which it doesn''t list in `requires`%',
  'a foreign key to another plugin''s table needs `requires`');
rollback to savepoint unshared;

savepoint unnamed;
select private.plugin_migration_begin('zz-two');
create function public.zz_two_total() returns integer language plpgsql as $$ begin return public.zz_one_count(); end $$;
select throws_like($$select private.plugin_migration_end('zz-two', '{zz-one}', '{"zz-one": []}')$$,
  '%names public.zz_one_count() of the zz-one plugin, which that plugin doesn''t list in `shares.sql`%',
  'a function body that calls another plugin''s function needs it shared');
rollback to savepoint unnamed;

select private.plugin_migration_begin('zz-two');
create table public.zz_two_links (id int primary key, note_id int references public.zz_one_entries);
create function public.zz_two_total() returns integer language plpgsql as $$ begin return public.zz_one_count(); end $$;
select lives_ok($$select private.plugin_migration_end('zz-two', '{zz-one}', '{"zz-one": ["zz_one_entries", "zz_one_count"]}')$$,
  'with `requires` and `shares.sql`, it may');

select throws_like($$select private.plugin_remove('zz-one')$$,
  '%can''t be removed while something else builds on it%zz_two_links_note_id_fkey%', 'removal refuses what another plugin builds on');
select lives_ok($$select private.plugin_remove('zz-two')$$, 'the plugin that builds on it goes first');

insert into public.settings (scope, event_id, namespace, value) values
  ('event', tests.u('ev'), 'plugins', '{"enabled": ["zz-one", "other"]}'),
  ('event', tests.u('ev'), 'plugin.zz-one', '{"greeting": "hi"}');
insert into public.event_windows (event_id, key) values (tests.u('ev'), 'zz-one.greetings');

select lives_ok($$select private.plugin_remove('zz-one')$$, 'then it can be removed');
select is((select count(*)::integer from pg_catalog.pg_class where relname like 'zz\_one%'), 0, 'its tables are gone');
select is((select count(*)::integer from cron.job where jobname = 'bogey-zz-one'), 0, 'its cron job is unscheduled');
select is((select count(*)::integer from pg_catalog.pg_trigger where tgname = 'zz_one_touch'), 0, 'its trigger on a core table is gone');
select is((select count(*)::integer from storage.buckets where id = 'zz-one'), 0, 'its empty bucket is deleted');
select results_eq(
  $$select (select count(*) from public.roles where source = 'zz-one') + (select count(*) from public.role_permissions where permission like 'zz-one.%')
      + (select count(*) from public.settings where namespace = 'plugin.zz-one') + (select count(*) from public.event_windows where key like 'zz-one.%')
      + (select count(*) from private.plugin_objects where plugin = 'zz-one')$$,
  $$values (0::bigint)$$,
  'its roles, permissions, settings, windows and record are gone'
);
select is((select value -> 'enabled' from public.settings where event_id = tests.u('ev') and namespace = 'plugins'),
  '["other"]'::jsonb, 'and it''s off where it was on, leaving the other plugins');

select * from finish();
rollback;
