# 0027: A plugin only adds to Bogey, so removing it is complete

**Status:** accepted (2026-10-12).

## Context

Plugin SQL was free-form, and nothing recorded what it made. Deleting a plugin's folder left its
tables, functions, cron jobs, roles, settings and migration records in every database it had run on.
The dev database still held five deleted plugins' leftovers: the Discord plugin's cron job kept
firing every minute against functions nobody maintained. Clearing them by hand meant knowing every
object each plugin had ever created, and nothing stopped a plugin from changing core: a column on
`public.events` or a replaced core function would outlive the plugin and change Bogey for good. Trying
a plugin shouldn't cost that.

## Decision

- **The database records what a plugin makes.** Every plugin migration runs between
  `private.plugin_migration_begin` and `_end` (supabase/schemas/20_plugins.sql), in a repeatable read
  transaction so another session's changes can't land in the snapshot. End diffs the catalog, plus cron
  jobs and storage buckets, against begin's snapshot and records each new object in
  `private.plugin_objects` by its address (`pg_identify_object_as_address`), which survives a dump and
  restore where an oid wouldn't. The record comes from what happened, not from parsing SQL.
- **A migration may only add, or change what its plugin made.** Changing or dropping anything of core's
  or another plugin's fails the migration, as does creating a plugin. Plugin data lives in plugin
  tables keyed by core ids; rows a plugin puts in core tables must be keyed by the plugin (roles by
  `source`, permissions and kinds by `<key>.`, settings by `plugin.<key>`).
- **`bogey plugins remove`** drops the recorded objects newest first, then calls
  `private.plugin_purge`, which knows every core table that holds plugin-keyed rows. It refuses, changing
  nothing, while an object outside the plugin depends on one of its own. Organizer content that names
  the plugin (sessions of its types, form items, rounds ranked by it) and the audit log stay, as they do
  while a plugin is off.
- **Plugins build on each other only by permission.** A plugin declares `shares` (`messages`, `sql`) and
  a dependent declares `requires`. The migration check refuses another plugin's objects that aren't
  both, including names in function bodies, which Postgres doesn't record as dependencies. These are
  optional manifest fields, so this stays plugin API 1.
- **Plugins migrated before the record existed** are adopted: `migrate` and `remove` record the objects
  their applied migrations name before going on. With the folder gone, `remove` finds objects by the
  plugin's name prefix and lists them for the operator to check.

## Consequences

- Removing a plugin is one command, and leftovers of deleted ones are visible in `bogey plugins status`.
- A plugin that used to alter core has to move that into its own tables. None of the first-party ones
  did.
- Each migration pays for two catalog snapshots, about a fifth of a second on the dev database.
- The check sees catalog objects, cron jobs and buckets. A migration that writes unkeyed rows into core
  tables isn't caught; the rule is documented, and plugin migrations are reviewed code like the rest.
