# 0008: Plugin tables are always installed; enablement is a setting

**Status:** superseded by [0009](0009-plugins-ship-separately.md)

## Context

Plugins were switched on only by the file allowlist. Several parts of the
old design didn't fit together:

- Plugin tables lived in core migrations.
- Plugin manifests declared a `requiresMigrations` that nothing checked.
- A plugin's database side (the `checkin` enum value, the Discord trigger)
  ran whether or not the plugin was allowlisted.

The hosted instance also needs per-org control, which a file can't give.

## Decision

- **Plugin tables always exist.** Each plugin's tables, policies and RPCs
  live in `supabase/schemas/plugins/<key>.sql` and are installed on every
  instance, so the schema is identical everywhere and migrations stay
  linear.
- **Three levels decide whether a plugin runs:**
  1. The file allowlist (`bogey.config.ts`) says the plugin's code is
     trusted on this instance.
  2. Org settings (`plugins.enabled`) say the org can use it.
  3. Event settings say it is on for that event. New events start with no
     plugins on, apart from the defaults for their `kind`.
- **RLS checks enablement too.** Plugin policies and RPCs also require
  `private.plugin_enabled(event_id, key)`. A disabled plugin's data
  therefore can't be read or written through the API, even though its
  tables exist.
- **`bogey doctor`** checks that every allowlisted plugin has its SQL file,
  and warns when a plugin is enabled in settings but not allowlisted.

## Consequences

- Third-party plugins that need tables must ship a SQL file and have it
  added to `supabase/schemas/plugins/`. The plugin guide documents this.
- Removing a plugin from the allowlist hides its UI. Its data stays until an
  organizer deletes the event.
