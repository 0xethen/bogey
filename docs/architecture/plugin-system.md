# Plugin system

How Bogey is extended, how that compares with other plugin systems, and what
we decided. The how-to for writing one is [`docs/plugins.md`](../plugins.md).
Bogey calls them plugins everywhere: in the UI, the code and the CLI. (The UI said "extension" before 2.0.)

## What exists

| Part                | How it works                                                                                                                                                                                                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install             | A folder in `packages/plugins/installed/<key>/` ([ADR 0009](../adr/0009-plugins-ship-separately.md)), or `bundled/<key>/` for one that ships with Bogey ([ADR 0026](../adr/0026-bundled-plugins-and-team-board.md)). It's part of the fork and the build, so installing one is the operator's act of trust. |
| Turning on          | Three gates: the instance (`plugins.disabled` in `bogey.config.ts`), the org (which ones its events may use), the event (which ones are on). `private.plugin_enabled(event, key)` gives the database the same answer.                                                                                       |
| Contract            | `definePlugin(manifest)` checks the manifest when it loads. `api` names the plugin API version it targets.                                                                                                                                                                                                  |
| Pages               | Declared `routes` with an `area` (event, manage, org, account, admin, public), each mounted under one splat route in that area's layout at `<area>/x/<key>/...`. `createPluginNav` gives typed links to the plugin's own paths.                                                                             |
| Slots               | `pending`, `wrapper`, `preferencesPanel`, `accountMenu`, `menubar`, `organizerPanel`, `manageOverview`, `judgingPanel`, `sessionPanel`. Runtimes load lazily; slots load once before first render.                                                                                                          |
| Item types          | `itemTypes`: a kind of submission answer, `<key>.<kind>`, with the plugin's field, view and a pure validator that also runs on the server.                                                                                                                                                                  |
| Ranking methods     | `ranking`: a way to rank a round besides the rubric ([ADR 0020](../adr/0020-ranking-providers.md)). The plugin writes scores through `private.set_ranking_input`; Bogey ranks, advances and publishes from them.                                                                                            |
| Session types       | `sessionKinds`, merged into the event's session types while the plugin is on, plus a `sessionPanel` on the session's page.                                                                                                                                                                                  |
| Server routes       | `serverRoutes` answered at `/api/x/<key>/...` as the caller (no service role), with same-site writes only.                                                                                                                                                                                                  |
| Settings            | Typed fields at instance, org and event scope under the `plugin.<key>` namespace, inheriting and locking like core settings, with generated forms. Per-person choices through `createPluginPreferences`.                                                                                                    |
| ⌘K and menus        | Labelled routes appear as tabs and in ⌘K; `commands` adds pages, `https:` links and client-side actions; `accountLinks` adds account menu items; `uses` says what the plugin needs (advisory).                                                                                                              |
| Schedule            | `windows`, namespaced `<key>.<window>`.                                                                                                                                                                                                                                                                     |
| People              | `permissions` and `roles`, namespaced; roles grant only the plugin's own permissions.                                                                                                                                                                                                                       |
| Audit               | `actions`, written with `createPluginAudit(manifest).log()`, which only accepts declared actions.                                                                                                                                                                                                           |
| Database            | `migrations/<n>_<name>.sql`, `seed.sql`, pgTAP tests. `bogey plugins migrate` applies them after core's, recording each. RLS is required, as in core.                                                                                                                                                       |
| Updates             | The manifest's `source.repository`; the check reads the latest GitHub release, or the manifest on the default branch. `bogey plugins outdated`, and Instance → Plugins → Check for updates.                                                                                                                 |
| Seeing what's there | Instance → Plugins (everything on disk, with status, what it adds and updates), Organization → Plugins (offer to events, org settings), Manage → Plugins (turn on, event settings).                                                                                                                         |

## Review

**Install and update.** Build-time install fits forks: a plugin is reviewed like
any other change, typed against `@bogey/*`, and bundled with the app. Updating
means replacing the folder and rebuilding. The update check is advisory and
reads only public GitHub metadata. Its permission check read `org_members`
without an org and failed for people in several orgs; it now allows platform
admins and admins of the host's org.

**Compatibility.** There was nothing to say which Bogey a plugin was written
for, so a breaking change would surface as a runtime crash. Manifests now carry
`api`; Bogey loads only APIs in `SUPPORTED_PLUGIN_APIS` and skips the rest with
a reason on Instance → Plugins and in `bogey plugins list`.

**Runtime.** Plugin code runs in the app's process with the app's privileges.
That's deliberate (see the decisions), so the boundaries that matter are the
database's: plugin queries run as the signed-in person, under RLS, and secrets
come only from Vault through `private.secret`.

**Database.** Each plugin ships numbered migrations, applied in order and
recorded per plugin (`supabase_migrations.plugin_migrations`) by `bogey plugins
migrate` and `bogey upgrade`. A plugin with only the older `schema.sql` counts
it as migration 0. A migration can only add to Bogey: the database records what
it creates (`private.plugin_objects`) and refuses changes to anything it didn't,
so `bogey plugins remove` can take a plugin out completely
([ADR 0027](../adr/0027-plugins-only-add.md)).

**Visibility.** Plugins were nearly invisible: the org list sat at the bottom
of Org settings, Manage hid the page when nothing was installed, and the update
check had no UI. Each level now has its own Plugins page.

## Elsewhere

| System    | Install                                      | Contract and compatibility                                                                                            | Isolation                                                        | UI plugin                                     | Data                                      |
| --------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------- |
| VS Code   | Marketplace, at runtime                      | `engines.vscode` range; declarative contribution points (commands, menus, keybindings, settings); proposed APIs gated | Separate extension host process                                  | Contribution points plus a webview API        | Extension storage APIs                    |
| Grafana   | Catalog or folder, at runtime                | `grafanaDependency` range in `plugin.json`; panel, data source and app types                                          | Signed plugins; backend plugins run as separate processes (gRPC) | Frontend modules loaded at runtime            | Through data sources                      |
| Directus  | Folder, npm or marketplace                   | `host` range in `package.json`; typed extension kinds (interfaces, displays, hooks, endpoints, panels, bundles)       | Optional sandbox for API extensions                              | Typed app extension kinds                     | Collections through the API, migrations   |
| Strapi    | npm package registered in config, build time | Peer dependency on `@strapi/strapi`; admin and server halves                                                          | None: in process                                                 | Admin panel injection zones                   | Content types and lifecycle hooks         |
| Backstage | npm packages, build time                     | Extension points and blueprints in the new frontend and backend systems; deprecations follow release lines            | None: in process                                                 | Extensions attached to typed extension points | Backend plugins own their database schema |
| WordPress | Plugin directory or upload, at runtime       | "Requires at least" header; hooks (actions and filters)                                                               | None: in process                                                 | Hooks and shortcodes                          | Own tables, `dbDelta` on activation       |

What carries over:

- **Declare contributions in the manifest** (VS Code, Directus). Bogey knows what a
  plugin adds before running it, can validate it, and can show it to organizers.
- **Say which host version it targets** (VS Code, Grafana, Directus, WordPress).
  Bogey uses one integer instead of a semver range; plugins are few and
  hand-installed, so "API 1" is easier to reason about than ranges.
- **Typed extension points instead of free-form hooks** (Backstage). WordPress-style
  filters reach everywhere but can't be type-checked or listed.
- **Plugins own their schema and its migrations** (Backstage, Directus, WordPress).
  Bogey has the first half.

What doesn't: runtime marketplaces and process sandboxes (VS Code, Grafana)
answer "untrusted code from strangers", which a self-hosted fork doesn't have.
TanStack Start compiles routes and server functions into one bundle, so
build-time install also keeps plugins on the same typed router and server
function machinery as core.

## Decisions

1. **Build-time install, full trust, three gates.** Plugins are code in the fork.
   Instance, org and event each decide whether one runs. No marketplace, no
   runtime loading.
2. **A declarative manifest is the contract.** Every extension point is a
   manifest field or a slot, checked by `definePlugin`, namespaced by the key,
   and listed on the Plugins pages.
3. **One integer plugin API.** `PLUGIN_API` goes up only for breaking changes:
   a removed or renamed manifest field, slot, context value or helper.
   Additions don't change it. Bogey keeps loading the previous API for at least
   one release after a bump (`SUPPORTED_PLUGIN_APIS`), marks what's going away
   `@deprecated` in the types, and lists it below.
4. **The database is the boundary.** Plugins aren't sandboxed. RLS and Vault are
   what keep data safe, so plugin tables follow core's rules: RLS in the same
   change, writes through `SECURITY DEFINER` RPCs that check the caller,
   `search_path = ''`.
5. **Routes stay under one splat route per area for now.** Each area (event,
   manage, org, account, admin, public) has a `p/$key/$` route inside its own
   layout, so a plugin page gets that layout's checks and chrome without being
   able to take a core path. Mounting plugin routes in the generated route tree
   (TanStack Router's virtual file routes) would give them nested layouts and
   type-safe params like core routes. It's worth doing once a plugin needs that;
   until then `createPluginNav` covers links.

## Next

| Extension point       | Status | Plan                                                                                                                                                                                                                                 |
| --------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Plugin migrations     | Done   | `migrations/<n>_<name>.sql` per plugin, applied in order and recorded per plugin, by `bogey plugins migrate` and `bogey upgrade`.                                                                                                    |
| Removal               | Done   | What each migration creates is recorded; a migration may only add; `bogey plugins remove` drops it all and the plugin's rows ([ADR 0027](../adr/0027-plugins-only-add.md)).                                                          |
| Plugins together      | Done   | `requires` and `shares` (`messages`, `sql`): a plugin builds on another only where that one allows it.                                                                                                                               |
| Hotkeys               | Done   | Core shortcuts and a manifest `hotkeys` list (open a plugin page) share one per-person binding store, rebound on Account.                                                                                                            |
| Notifications         | Done   | Manifest `notifications` and `emails`, `createPluginNotify` and the `notify_event` RPC: the bell, and email through the core outbox.                                                                                                 |
| Submission item types | Done   | Item kinds are text, a core kind or `<key>.<kind>`; the plugin supplies the field, the answer check and the read-only view.                                                                                                          |
| Session types         | Done   | `sessionKinds` merged into the agenda's types, and a `sessionPanel` slot.                                                                                                                                                            |
| Ranking methods       | Done   | `ranking` and the `judgingPanel` slot; `ranking_inputs` and `private.set_ranking_input` are the contract.                                                                                                                            |
| Languages             | Done   | `locales` and a runtime `catalogs`: messages for a language, loaded on demand ([ADR 0024](../adr/0024-languages.md)). A plugin's own text: `createPluginMessages`, `translations` and a runtime `messages`, keyed `<key>.<message>`. |
| Server routes         | Done   | `serverRoutes` at `/api/x/<key>/...`, run with the caller's session.                                                                                                                                                                 |
| Devtools              | Done   | The Bogey tab in TanStack Devtools (dev only): session and access, plugins with their routes, slots and settings, loaded settings, realtime channels, the save bar's entries, hotkeys and the screen's queries.                      |

## Plugin API versions

- **1** (2026-10): the first versioned API. Manifest fields: `key`, `name`,
  `api`, `version`, `description`, `author`, `license`, `source`, `windows`,
  `actions`, `settings` (with `scope`, `lock` and `showWhen`), `routes`, `permissions`,
  `roles`, `commands`, `scope` and `eventTypes` (org-scoped plugins that come
  with an event type, which can start the plugin at its own settings), and `limits`
  (ceilings platform admins set per instance and organization). Slots:
  `pending`, `wrapper`, `preferencesPanel`, `accountMenu`,
  `organizerPanel`.

  Added without a new version, because they only add optional fields and slots: manifest `itemTypes`,
  `ranking`, `sessionKinds`, `serverRoutes`, `locales`, `translations`, `actionLabels`, `requires` and `shares`, and a route's `area`
  (`public: true` stays as the spelling of `area: "public"`, marked `@deprecated`); runtime `itemTypes`,
  `serverRoutes`, `catalogs` and `messages` (required for every one the manifest declares); slots
  `judgingPanel`, `sessionPanel` and `menubar`; `createPluginMessages`, and `SettingsLink` on `createPluginNav`. A plugin written before
  them loads unchanged. The API number changes only when something that exists stops working.
