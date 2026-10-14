# Plugins

A plugin is a folder you put in `packages/plugins/installed/<key>/`
([ADR 0009](adr/0009-plugins-ship-separately.md)). Bogey itself ships one, `challenges`, in
`packages/plugins/bundled/<key>/` ([ADR 0026](adr/0026-bundled-plugins-and-team-board.md)): the
same kind of folder, tracked in git, versioned with Bogey, and migrated by `bogey db migrate`.
Everything below applies to both.

```
installed/<key>/
  manifest.ts        what it is: settings, routes, windows, permissions, roles
  runtime.tsx        what it renders, checked against the manifest
  migrations/*.sql   optional: its tables, policies and RPCs, one change per file
  seed.sql           optional: demo data
  tests/*.test.sql   optional: pgTAP tests
```

`packages/plugins/examples/hello` is a complete small plugin. Copy it into
`installed/` to try it, or start one with `bogey plugins new <key>`.

### Developing plugins locally

`packages/plugins/installed` isn't tracked, so a development checkout can point it anywhere. The
maintainer keeps the [bogeyx](https://github.com/0xethen/bogeyx) repository in
`plugins/` next to `monorepo/`, and links it in:

```sh
cd monorepo && bogey plugins link ../plugins
```

That makes `installed` a symlink to the checkout's `plugins/` folder (or to the folder itself when it has none), and gives the folder a `node_modules` of links to
the plugins package's dependencies and to `@bogey/plugins` itself, since a plugin outside the
monorepo couldn't otherwise resolve its imports. It also writes a `tsconfig.json` there if none exists (an existing one is left alone; delete it and link again to regenerate). A folder in `plugins/plugins/` is then picked up like
any installed plugin (dot-folders are skipped). `bogey plugins add` writes into
the linked folder, and the Docker build ignores the link and restores plugins from
`bogey.plugins.lock` instead.

## Installing a plugin

```sh
bogey plugins search [words]            # find one in the libraries below
bogey plugins add <key>[@<version>]     # the newest version unless you name one
bogey plugins add github:0xethen/bogeyx/<plugin>@<version>   # straight from a repository
```

### Libraries

A _library_ is a GitHub repository of plugins with an `index.json` at its root listing each one (key, name, version,
description, plugin API, release tag and its folder). The official library, `github:0xethen/bogeyx`, is always
searched. To search others, list them in `bogey.libraries.json` (commit it) with
`bogey plugins library add github:<owner>/<repo>`; `library remove` takes one out and `library list` shows the order.
`search` reads every library, `add <key>` takes the key from the one that has it and refuses when two do (name it in
full then), and libraries that can't be read are reported and skipped. A library is a source of code that runs with the
app's privileges, so add only ones you trust; everything below still applies to what it publishes.

Both files have JSON Schemas (`bogey plugins schema` for `index.json`, `bogey plugins schema libraries` for
`bogey.libraries.json`); the plugins repository's `build-index.mjs` writes `index.json`, so a library of your own is a
repository with that script (or the same shape by hand), plugins in `plugins/<key>/`, and the release workflow.

This downloads the release tagged `<plugin>-v<version>` from that repository
(the asset `<plugin>-<version>.tar.gz`), then prints what the plugin is, what its
manifest says it `uses`, and every SQL migration it will run, and asks before
anything is written. Without a terminal, pass `--yes` once you've read it. It
refuses an archive that reaches outside the plugin's folder or holds links, a
manifest whose version differs from the tag, and a plugin written for a plugin
API this Bogey doesn't support.

It also asks GitHub whether the download is attested, with `gh` (a release attestation
from an immutable release, or the build provenance of the workflow that packed it), and
shows the answer next to the hash. Without an attestation it warns and carries on;
`--require-attestation` refuses, and `--no-verify` skips the check. What it found is
recorded in the lock.

The plugin lands in `packages/plugins/installed/<key>/` and is pinned in
`bogey.plugins.lock` (commit it): the source, the version and a hash of its
files. `bogey plugins install` restores exactly that, and refuses a release
whose files changed after they were locked. `bogey doctor` fails when an installed
plugin no longer matches the lock. Updating is `add` again with the new version.

Then apply its SQL (`bogey plugins migrate --db-url ...`) and rebuild and redeploy:
a plugin is part of the build, so installing or updating one is never a
restart. A plugin is trusted code, the same as an npm package; read what you
install.

To publish plugins this way, tag each release `<plugin>-v<version>` in a
repository with one folder per plugin under `plugins/` and attach `<plugin>-<version>.tar.gz`,
as [bogeyx](https://github.com/0xethen/bogeyx) does. Its release
workflow attests the archive and publishes through a draft, so with _immutable releases_
turned on for the repository (Settings → General, or
`gh api -X PUT repos/<owner>/<repo>/immutable-releases`) GitHub also signs a release
attestation that `bogey plugins add` checks.

## Removing a plugin

```sh
bogey plugins remove <key>              # shows everything it takes out, then asks
bogey plugins remove <key> --dry-run    # only show it
```

A plugin can only add to Bogey (see [The database](#the-database)), and the database records
everything its migrations make as they run, so removing it puts Bogey back the way it was. `remove`
drops what the plugin made (its tables, views, functions, types, policies, triggers, cron jobs and
storage buckets, emptied through the Storage API first), deletes its rows in Bogey's own tables (its
settings, roles and the permissions it granted, agenda windows, ranking scores, notifications, unsent
email, people's preferences, email wording and org limits), switches it off wherever it was on, forgets
its migrations, and deletes its folder and lock entry. The database part is one transaction that changes
nothing if any of it fails; bucket files are emptied before it, since only the Storage API deletes them
(it needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`).

What organizers made with the plugin stays, as it already does while a plugin is off: sessions of its
types, form items and their answers, rounds ranked by its methods (switch them back to the rubric), and
the audit log.

It refuses while something else builds on the plugin: an installed plugin that `requires` it, or an
object of another plugin (a foreign key, a view, a policy) that depends on one of its own. Remove those
first. A plugin that ships with Bogey can't be removed; `bogey plugins disable` switches it off.

`remove` also takes a key whose folder is already gone: `bogey plugins status` lists plugins the
database remembers that aren't installed, and removing one clears what it left. A plugin migrated
before Bogey recorded plugin objects has no record, so `remove` finds its objects by the names its
migrations use, or, with the folder gone, by names that start with its key (`discord_...`,
`bogey-discord` for a cron job). It lists them before asking, so check them. (`migrate` records such a
plugin's objects the same way before running its next migration.)

When `packages/plugins/installed` is a linked checkout ([Developing plugins locally](#developing-plugins-locally)),
`remove` leaves the folder, since that's the plugin's source, and disables the plugin in `bogey.config.ts`.

## Turning plugins on

1. **Instance:** every installed plugin runs unless `bogey.config.ts` lists it
   under `plugins.disabled` (`bogey plugins disable <key>`), or it targets a
   plugin API this Bogey doesn't support. Instance → Plugins lists every
   plugin on disk with its status and checks for updates.
2. **Organization:** Organization → Plugins chooses which installed
   plugins its events may use, and holds org-level plugin settings.
3. **Event:** Manage → Plugins turns a plugin on for the event and edits its
   event settings. Only then do its pages, tabs and panels appear. A plugin
   with `scope: "org"` has no switch here: it comes with the event's type (see
   [Event types](#event-types)).

Nothing in the database can install a plugin; it can only turn installed
ones on and off. The database's `private.plugin_enabled(event, key)` answers
the same question the app does, so plugin policies can check it.

## The manifest

```ts
import { definePlugin } from "@bogey/plugins/api";

export const manifest = definePlugin({
  key: "hello",
  name: "Hello",
  api: 1,
  version: "0.1.0",
  description: "Greets participants on the event home and on its own page.",
  author: { name: "Ada Lovelace", url: "https://github.com/ada" },
  license: "MIT",
  source: { repository: "github:ada/bogey-hello" },

  windows: [{ key: "greetings", label: "Greetings" }],
  settings: {
    greeting: { type: "string", label: "Greeting", default: "Hello" },
    tone: {
      type: "select",
      label: "Tone",
      scope: "org",
      default: "warm",
      options: [
        { value: "warm", label: "Warm" },
        { value: "brief", label: "Brief" },
      ],
    },
  },
  routes: [
    { path: "", label: "Hello" },
    { path: "/about", public: true },
  ],
  permissions: ["greet"],
  roles: [{ key: "greeter", label: "Greeter", grants: ["greet"] }],
  actions: ["greeted"],
  commands: [{ path: "", label: "Say hello", keywords: ["greet"] }],
  hotkeys: [{ id: "open", label: "Open Hello", keys: "Mod+Shift+H", path: "" }],
  notifications: [{ kind: "greeted", label: "Someone greeted you", email: false }],
  emails: [
    {
      kind: "digest",
      label: "Greeting digest",
      description: "A summary of the day's greetings.",
      variables: [{ name: "count", label: "How many greetings", example: "12" }],
      required: [],
      reason: "you took part in {{event}}",
      defaults: { subject: "{{count}} greetings", body: "# Greetings\n\nYou got {{count}} today." },
    },
  ],
});

export default manifest;
```

`api` is the plugin API the plugin was written for (`PLUGIN_API`, now 1). Bogey
skips plugins whose API it doesn't support and says why; see
[`architecture/plugin-system.md`](architecture/plugin-system.md) for what changes
between versions. `commands` adds ⌘K entries that open the plugin's own
pages; labelled routes are listed there already. `hotkeys` opens one of those
pages from the keyboard in an event where the plugin is on; the keys are a
default that each person can change or turn off in Account → Keyboard
shortcuts, and the shortcuts list (Shift /) shows them under the plugin's
name.

### The menus and ⌘K

Besides pages, a manifest can add to Bogey's chrome. All of it is declared, so
Bogey can list it without running plugin code, and it applies to every
installed plugin, in or out of an event.

```ts
commands: [
  { path: "", label: "Say hello" }, // a page of the plugin, in an event where it's on
  { label: "Plugin docs", href: "https://example.com/docs" }, // another site, https only
  { label: "Wave", action: "wave" }, // runs `actions.wave` from the runtime, in the browser
],
accountLinks: [
  { label: "About Hello", path: "/about" }, // a public route; the menu works outside events
  { label: "Docs", href: "https://example.com/docs" },
],
```

An `action` needs a handler under `actions` in the runtime, keyed by its id;
`definePluginRuntime` fails at load without one, and TypeScript flags it
earlier. For anything more than a link in the account menu, the `accountMenu`
slot renders its own items.

`uses` says what the plugin needs, for the person deciding whether to
install it: `tables` it creates or reads, `network` hosts it calls, and
settings namespaces it reads. Bogey shows it on Instance → Plugins. It's
advisory, since nothing enforces it; a plugin is trusted code that runs with
the app's privileges, like an npm package, so read what you install.

`definePlugin` checks the manifest when it loads: the key is lowercase with
dashes (it appears in URLs and database rows), the version is semver (update
checks compare them), `source.repository` is `github:owner/repo` or a GitHub
URL, routes start with `/` (or are `""` for the index) and aren't declared
twice, select defaults are one of their options, and roles only grant the
plugin's own permissions. The database learns a role from the plugin's migration, so it must insert the
role into `public.roles` (`key` as `<plugin>.<role>`, `label`, `source` as the plugin key) before any
`role_permissions` row or grant uses it, and its `role_permissions` rows should match the manifest's
`grants`. A role sits on top of a person's event role (participant, staff, judge or organizer):
organizers hand it out on Manage → People, in the person's row, while the plugin is on for the event.

Everything a plugin names is namespaced with its key: the window above is
`hello.greetings`, the permission `hello.greet`, the role `hello.greeter`, the
audit action `hello.greeted`, and its settings live in the settings table as
`plugin.hello`.

## The runtime

```tsx
import { definePluginRuntime, type PluginContext } from "@bogey/plugins/runtime";
import type { SettingsOf } from "@bogey/plugins/types";
import { manifest } from "./manifest.ts";

type Settings = SettingsOf<typeof manifest>;

function HelloPage({ settings, session }: PluginContext<Settings>) {
  return (
    <p>
      {settings.greeting}, {session.profile?.display_name}!
    </p>
  );
}

export default definePluginRuntime(manifest, {
  routes: { "": HelloPage },
  publicRoutes: { "/about": About },
  homePanels: { greeters: HomePanel },
  slots: { organizerPanel: OrganizerPanel },
});
```

The route keys are typed from the manifest, so a missing or misspelled route
is a type error, and `definePluginRuntime` also throws at load when a declared
route isn't implemented. The runtime loads lazily, the first time one of its
pages or panels is needed.

### Pages

A route's `area` says where it mounts. Every area has its own URL under the plugin's key, so a
plugin page can never shadow a core page or another plugin's:

| `area`              | Served at                             | Listed (with a `label`) | Gets                                    |
| ------------------- | ------------------------------------- | ----------------------- | --------------------------------------- |
| `"event"` (default) | `/events/<slug>/x/<key><path>`        | the event's tab row, ⌘K | `{ eventId, settings, session, splat }` |
| `"manage"`          | `/events/<slug>/manage/x/<key><path>` | Manage's sidebar, ⌘K    | `{ eventId, settings, session, splat }` |
| `"org"`             | `/org/x/<key><path>`                  | the Organization tabs   | `{ orgId, settings, session, splat }`   |
| `"account"`         | `/account/x/<key><path>`              | the Account sidebar     | `{ settings, session, splat }`          |
| `"admin"`           | `/admin/x/<key><path>`                | the Instance tabs       | `{ settings, session, splat }`          |
| `"public"`          | `/x/<key><path>`                      | nowhere; link to it     | `{ splat }`, the rest of the path       |

```ts
routes: [
  { path: "", label: "Scores" },                         // the event's tab
  { path: "/review", area: "manage", label: "Review" },  // Manage → Plugins group
  { path: "/billing", area: "org", label: "Billing" },   // an Organization tab
  { path: "/join", area: "public" },
],
```

- Each area's page appears only where its layout already lets the person in: event pages while the
  plugin is on for the event, Manage pages for people who manage it, Organization pages for org admins
  of an org that offers the plugin, Instance pages for platform admins. Account pages are every
  signed-in person's.
- `settings` are resolved for the page's level: the event's, the org's, the person's org's (Account) or
  the instance's (Admin).
- `permission` (like `hello.greet` or `event.manage`) hides an event or Manage page, and its tab, from
  people without it. That's the UI only; your policies decide what they can read and write.
- `public: true` is the older spelling of `area: "public"` and still works.
- In the runtime, `routes` takes every signed-in page and `publicRoutes` the public ones, keyed by
  path. Both are typed from the manifest: a missing page, an extra key, or a component that expects
  another area's context (an org page reading `eventId`) is a type error, and `definePluginRuntime`
  also throws at load when a declared route isn't implemented.
- Link between your pages with `createPluginNav(manifest).Link`, whose `to` is one of your declared
  paths; it goes to that path's area, staying in the event being viewed for event and Manage pages.
  `href(path, { slug })` gives the URL as a string. `SettingsLink` goes to Manage → Plugins and shows
  only to people who can manage the event.
- `{ path: "/problem", splat: true }` also serves `/problem/<anything>`, and the page gets the rest as
  `splat`. Pass it to links as `<Link to="/problem" splat="sum">`. Public pages always get the rest.
- A route can be `{ component, loader, title }`. The loader gets the page's context plus `queryClient`
  and runs before the page renders, so prefetch what the page needs there. `title(...)` names the page
  in the tab title and breadcrumbs when that depends on data; it runs after `loader`.
- Public pages have no session or event, and work for anyone whether or not an event has the plugin
  on, so keep them to things that are meant to be public.

Paths outside these areas (a bare `/leaderboard`) aren't offered on purpose: a plugin there could
cover a page core adds later, or `/auth/login`, and nothing would say so.

### Home panels

Declare `homePanels` in the manifest (`{ key, label, description? }`) and implement each in the runtime's `homePanels`,
as many as you like. Organizers place them on the event home under Customize → Plugins, each once, and no panel shows
until one does. A panel gets `{ eventId, settings, session }` and renders only while the plugin is on for the event.

### Slots

| Slot                | Where                                                  | Gets                                                                    |
| ------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------- |
| `organizerPanel`    | under the plugin's settings in Manage → Plugins        | `{ eventId, settings, session }`                                        |
| `manageOverview`    | a section of Manage → Overview, while the plugin is on | `{ eventId, settings, session }`                                        |
| `wrapper`           | around the whole app, first key outermost              | `{ children }`                                                          |
| `eventWrapper`      | around an event's pages, while the plugin is on        | `{ eventId, settings, session, children }`                              |
| `conversationTopic` | above a conversation with the plugin's topic           | `{ eventId, settings, session, topic }`                                 |
| `judgingPanel`      | the judge's sheet, for a round it ranks                | `{ eventId, settings, session, method, formId, roundId, submissionId }` |
| `sessionPanel`      | the page of a session of the plugin's kind             | `{ eventId, settings, session, sessionId, kind }`                       |
| `preferencesPanel`  | a section on the Account page                          | `{ settings, session }` (settings are defaults)                         |
| `accountMenu`       | items in the account menu (`DropdownMenu*`)            | `{ settings, session }` (settings are defaults)                         |
| `menubar`           | an icon button left of the notifications bell          | `{ settings, session }` (settings are defaults)                         |
| `pending`           | replaces the loading skeleton; first plugin wins       | nothing                                                                 |
| `authCaptcha`       | the sign-in forms, above the button; first plugin wins | `{ settings, onToken }` (settings are the instance's)                   |

An `eventWrapper` can guard a page (lockdown covers it until its rules are met). If one throws, the
page stays covered for everyone but organizers, who get it unwrapped with the error so they can reach
Manage → Plugins and switch the plugin off. Panels that throw are replaced by a notice; the rest of
the page keeps working. Render nothing you wouldn't want seen before your own checks pass: the server
renders the wrapper too, so a guard's first render (before the browser answers) should be the covered one.

`authCaptcha` draws a captcha widget and calls `onToken` with its token (or `null` when it expires).
Bogey sends the token with the sign-in request, and Supabase Auth checks it with the provider when captcha
protection is on there, so Bogey never sees the secret and nobody can skip the check by calling Supabase directly.
Tokens are single-use, so Bogey remounts the widget after every try. The `captcha` plugin is the example.

Keep per-person choices with `createPluginPreferences(manifest)`, whose
`usePreference(key, fallback)` reads and saves one value for the signed-in
person.

A plugin's windows (`windows` in the manifest) appear in Manage → Agenda's
add list once the plugin is on for the event, labelled as declared.

## Submission item types

A plugin can add kinds of answer to submission forms: a sketch pad, a star rating, a repository
picker. Declare them in the manifest and implement them in the runtime:

```ts
// manifest.ts
itemTypes: [
  {
    kind: "stars", // the form stores it as "<key>.stars"
    label: "Star rating",
    description: "Pick a number of stars.",
    // what an organizer sets on an item of this type, with the same field types as `settings`
    config: { max: { type: "number", label: "Most stars", default: 5, min: 1, max: 10 } },
  },
],

// runtime.tsx
itemTypes: {
  stars: {
    Field: StarsField, // what teams fill in; Bogey draws the label, help and errors around it
    View: StarsView, // how everyone else reads the answer: project page, gallery, judge's sheet
    validate: (value, item) => (/* a message, or null */),
  },
},
```

While the plugin is on for an event, its types appear in the form builder beside Short answer and
Link, with the `config` fields under them. `validate` is pure and synchronous. It runs in the form
as teams type and again on the server when they save, and again on submit for plugin items, with
`required` telling it whether an empty answer is a problem (not for a draft). An answer is text or
yes/no; a plugin that stores something structured writes JSON text, up to 20,000 characters. If
the plugin is later turned off, its items keep their answers, show them as plain text and accept
them unchanged, since nothing can check them any more.

## Ranking methods

The rubric (judges score criteria, Bogey averages and weighs them) is Bogey's own way to rank. A
plugin can supply another: the `extra-judging` plugin's pairwise comparison, peer rating, ranked
ballots and points budget, or a scored leaderboard. Declare it:

```ts
ranking: [{ key: "applause", label: "Applause", description: "Judges record how loud the room was." }],
```

An organizer picks it for a round under Manage → Judging → Rounds → **Ranked by**, once the plugin
is on. The contract is small:

1. **The plugin's panel replaces the rubric.** The `judgingPanel` slot draws on the judge's sheet
   for a round whose method is `<key>.<method>`; judges' assignments, windows and queue are core's.
2. **The plugin writes scores through its own function.** A `security definer` function in the
   plugin's migration checks who is calling (`private.has_permission(event, 'judging.score')`, the
   round's window with `private.round_window_open`) and then calls
   `private.set_ranking_input(round, submission, '<key>.<method>', score, detail)`. That is the only
   way into `ranking_inputs`, and it refuses a round the method doesn't rank. Higher is better.
   `detail` (up to 4 KB) is yours: the results list carries it.
3. **Bogey ranks, advances and publishes from those scores.** `rank_submissions` uses
   `ranking_inputs` for such a round, so awards, advancing "the top N", exports and the published
   snapshot work as they do for a rubric. Entries the method never scored are left out of the round's
   ranking.

The Hello example's `hello.applause` is the smallest working one: `migrations/0_applause.sql` and
`ApplausePanel`. A plugin that is later turned off leaves its round marked with the method; judges are
told the round can't be scored, and the organizer switches the round back to the rubric.

## Session types

`sessionKinds` adds types to the agenda, merged with the event's own while the plugin is on:

```ts
sessionKinds: [{ key: "duel", label: "Duel", icon: "gamepad", tone: "orange" }],
```

Sessions of that type are stored as `<key>.duel`. The `sessionPanel` slot draws on the page of such
a session (the one staff open for attendance). A session whose plugin is turned off keeps its type and
shows it as a plain one.

## Languages

Two things, which a plugin can do either or both of.

**Your plugin's own text.** Write it once in English with `createPluginMessages`, and `useT()` gives a
`t` typed by those keys and `{slots}`:

```ts
// manifest.ts
translations: ["es"],

// shared.ts
export const { useT } = createPluginMessages(manifest, {
  "board.title": "Scores for {name}",
  "board.empty": "{count, plural, one {# team hasn't} other {# teams haven't}} scored yet.",
});

// runtime.tsx: one per `translations` entry, with the same keys
messages: { es: async () => (await import("./es.json", { with: { type: "json" } })).default },

// in a component
const t = useT();
t("board.title", { name: event.name });
```

Bogey loads the person's language for every installed plugin and keys it `<plugin>.<key>`, so your keys
never collide with core's or another plugin's. Where there's no translation, the text shows in English.
Translating your plugin into a language doesn't add that language to Bogey; that's the next part. To let
a language plugin translate your text into languages you don't ship, set `shares: { messages: true }`
([Building on other plugins](#building-on-other-plugins)).

**A language for Bogey.** `locales` adds languages to Bogey, and the runtime's `catalogs` supplies each
one's messages:

```ts
locales: [{ code: "es", label: "Español" }],
// runtime.tsx
catalogs: { es: async () => (await import("./es.json", { with: { type: "json" } })).default },
```

A catalog maps the keys in Bogey's English messages (`packages/config/src/messages.ts`) to text, and
the keys of plugins that share their messages (`<plugin>.<key>`) too. What shows where it has no entry is the language plugin's `missing` setting: English by default, another language, or the key itself; a key that exists nowhere shows as itself and never breaks a page. The language
appears in Account → Preferences → Language. See [Translating Bogey](guides/translating.md) and
[ADR 0024](adr/0024-languages.md).

The language isn't in the URL (no `/es/...`): Bogey is an app people sign in to, and its links are
shared between people who read different languages. It comes from the account, then a `locale`
cookie, then the browser's `Accept-Language`, so server rendering and `<html lang>` agree. Labels in
the manifest (route labels, settings) are English for now.

## Server routes

A plugin can answer HTTP requests at `/api/x/<key>/<path>`: a webhook receiver, a data feed, an
endpoint its own page calls.

```ts
// manifest.ts
serverRoutes: [{ path: "/greeting", method: "GET" }],

// runtime.tsx
serverRoutes: {
  "GET /greeting": (request, { supabase, user, eventId }) => Response.json({ hello: user?.email }),
},
```

The handler gets the `Request` and a context with the caller's own Supabase client (`supabase`, and
`supabaseFor<MyDatabase>()` for the same client typed for the plugin's own tables), the signed-in
user (or `null`) and, when the URL has `?event=<id>`, that event's id after checking the caller can see it
and the plugin is on for it. The rules:

- **Everything runs as the caller.** There is no service role, so row-level security decides what the
  route can read or write. A route that needs more calls a `security definer` function that checks its caller.
- **Only declared routes exist**, by exact method and path. A segment like `:slug` (`/contests/:slug/scoreboard`) matches
  one word of letters, digits, `-` and `_` and arrives in `params`; a path with no parameters wins over one with. Anything else is a 404 and never reaches the plugin.
- **A write from another website is refused** (`Origin` or `Sec-Fetch-Site`), since the session is a cookie. A request
  with neither header, such as a server calling, has no cookie of a browser to abuse; authenticate it yourself.
- **Responses can't set cookies**, and default to `Cache-Control: private, no-store`.
- **Request bodies over 1 MB are refused** unless the route declares `maxBodyMb` (1 to 64) and reads the body with `ctx.body()`; a handler that throws answers 500 with no detail.
- There is no rate limit. A route that does real work should bound it.

## Event types

Some plugins are a whole kind of event, not an add-on to one: a contest platform, a
code-golf arena. Declare `scope: "org"` and `eventTypes`, and the plugin is offered
by the organization instead of switched on by each event:

```ts
scope: "org",
eventTypes: [
  {
    key: "contest",
    label: "Challenge contest",
    description: "Individuals or teams solve problems against a clock.",
    kind: "contest", // the core kind it starts as: its windows and default schedule
    teamSize: [1, 1], // how the form starts
    settings: { scoring: "golf" }, // optional: the plugin's settings the event starts with
  },
],
```

- Organization → Plugins chooses which installed plugins the org offers, as for any
  plugin. An org-scoped one is used by creating an event of its type.
- **New event** lists the types of the plugins the org offers, beside Hackathon.
  Only org admins create events, so only they create these. The event starts with the
  plugin on (`create_event(..., p_plugin)` writes it and refuses a plugin the org
  doesn't offer).
- Manage → Plugins shows the plugin on that event without a switch; its settings
  are still edited there.
- An event type is a name for "this plugin is on from the start". It isn't stored
  separately, and the database still checks `private.plugin_enabled` as usual.

`eventTypes` needs `scope: "org"`, and `scope: "org"` needs at least one event type. A type's
`settings` must be settings the plugin declares, at values that fit them; they're saved as the
event's own right after it's created.

## Limits

A plugin can declare limits, like core's participants per event, that platform admins set for the
whole instance (Instance → Plugins) and per organization (Instance → Organizations → Limits):

```ts
limits: {
  maxMemoryMb: { label: "Most memory a problem can ask for", unit: "MB" },
  maxProblemsPerEvent: { label: "Problems in one event" },
},
```

Names are camelCase and a limit is none until it's set. The plugin's SQL enforces it, on the write
that would go over, with the same helper core uses:

```sql
v_limit := private.org_limit(private.event_org(new.event_id), 'my-plugin.maxMemoryMb');
if v_limit is not null and new.memory_mb > v_limit then
  raise exception 'at most % MB', v_limit using errcode = '23514';
end if;
```

An org's override wins over the instance's value, and platform admins and the service role are exempt
in the triggers core ships; do the same in yours. A limit has no usage count in the lists, since only
the plugin knows what to count. The instance's values live in the settings namespace
`plugin.<key>.limits`.

## Settings

Types: `boolean`, `number` (`min`, `max`), `string` (`placeholder`,
`multiline`) and `select` (`options`). `settings` in the context is always
complete: stored values that don't fit their type fall back to the default.

`showWhen` shows a setting only while another one of the plugin's settings (declared
before it) holds one of the listed values, so a form asks only for what applies:

```ts
mode: { type: "select", label: "Mode", default: "monitor", options: [/* off, monitor, enforce */] },
maxViolations: {
  type: "number",
  label: "Times someone can leave before submissions stop",
  default: 3,
  min: 1,
  showWhen: { setting: "mode", in: ["enforce"] },
},
```

A hidden setting keeps its stored value and still resolves to it, so code that reads it
should check the setting it depends on too. Chains work: a setting hidden by its own
condition hides whatever depends on it. `isSettingVisible(manifest, name, values)` answers
the same question for your own forms.

`showWhen` can also be a list, which has to hold in full. A route takes it too, with the
same shape, to list its tab only for some of the plugin's events: a plugin with several
event types keeps a `format` setting (which `eventTypes[].settings` presets) and lists each
format's pages by it. A route that isn't listed still opens by its address.

`scope` is the lowest level a setting can be changed at: `"event"` (the
default), `"org"` or `"instance"`. Values resolve instance → organization →
event like core settings, and the editors show only what can be set at their
level. Saving checks the value against the manifest on the server.

`lock` is the other way to keep a setting at one level: `lock: "instance"` lets only the instance set it, for every
organization and event, and `lock: "org"` lets an organization set it for its events. Unlike `scope`, which hides a setting
below its level, a lock shows it read-only there ("Set by the instance for every organization") with the value that
applies. A setting has one or the other. The Languages plugin locks its "When a message isn't translated" choice at the
instance, so every organization shows missing translations the same way.

### Where settings show

At the event level, a plugin's settings sit in its row on Manage → Plugins. Settings that belong with something
Bogey already has (lockdown with network limits, a ranking method's knobs with judging) can go there instead, as titled
sections:

```ts
settingsSections: [
  { key: "lockdown", title: "Lockdown", page: "security", settings: ["mode", "maxViolations"] },
],
```

`page` is one of Manage's pages (`MANAGE_SETTINGS_PAGES`: `details`, `agenda`, `security`, `registration`, `people`,
`teams`, `divisions`, `submissions`, `prizes`, `certificates`, `judging`, `announcements`, `email`, `messages`) or a page
of the plugin's own, declared in `settingsPages` and listed under Plugins in Manage's sidebar
(`/events/<slug>/manage/x/<key>/<page>`):

```ts
settingsPages: [{ key: "contest", label: "Contest" }],
settingsSections: [{ key: "scoring", title: "Scoring", page: "contest", settings: ["scoring", "penaltyMinutes"] }],
```

A settings page can instead name one of the plugin's own Manage routes (`route: ""`); it then has no sidebar entry of its
own, its sections reach that page as `settingsSections` in its context, to render where they belong, and links and search
lead to that route under its label. A page without a route can't share its key with the first segment of one of the
plugin's Manage routes, since both would open at `/events/<slug>/manage/x/<key>/<page>`.

A setting belongs to one section at most; the rest stay in the plugin's row, which links to its sections. Sections
show only while the plugin is on for the event, carry its name, and are found by Manage's search. Organization and
instance pages still show every setting in the plugin's row. `definePlugin` checks the pages and setting names.

## Notifications and email

Core has a bell (a `notifications` table people read in the menubar) and an **email outbox**
that Bogey's own mail goes through. A plugin reaches people the same way.

`notifications` declares kinds, namespaced `<key>.<kind>`. People choose bell, email or both for each
kind in Account → Notifications; `email: true` makes email the default (people can still turn it
off). Send one with `createPluginNotify`, which only accepts declared kinds:

```ts
import { createPluginNotify } from "@bogey/plugins";
import manifest from "./manifest.ts";

const notify = createPluginNotify(manifest);
await notify.send("greeted", {
  eventId,
  users: [userId],
  title: "Ada greeted you",
  link: `/events/${slug}/x/hello`,
  permission: "hello.greet", // one of the plugin's own permissions, or "event.manage"
});
```

The `notify_event` RPC refuses a plugin that is off for the event, a sender without the named
permission, and recipients who aren't members of the event. Up to 200 people per call.

`emails` declares messages with wording of their own. They appear in Manage → Email (and the org and
instance email settings) beside Bogey's, where organizers can edit them, and are sent through the
outbox with the same layout, per-org daily limit and unsubscribe link. Variables `event`, `link`,
`org`, `platform` and `email` are always available.

## The database

A plugin's tables, policies and functions live in `migrations/`, one file per
change: `1_init.sql`, `2_add_scores.sql`, and so on, applied in number order
after core's. Never edit a file that has shipped; add the next one.

```
bogey plugins status  [key...] --db-url postgres://...   applied and pending
bogey plugins migrate [key...] --db-url postgres://...   apply what's pending
```

Each file runs in its own transaction and is recorded in
`supabase_migrations.plugin_migrations`, so `migrate` is safe to repeat, and
`bogey upgrade` runs it after core's migrations. An older plugin with a single
`schema.sql` and no `migrations/` folder is treated as migration 0.

### A migration can only add

A migration runs between `private.plugin_migration_begin('<key>')` and
`private.plugin_migration_end('<key>', ...)` (`migrate` adds them; `bogey plugins sql` prints them). Begin
takes a snapshot of the database's objects and end compares:

- **Everything new is recorded under the plugin** in `private.plugin_objects`: tables, views, sequences,
  functions, types, schemas, policies and triggers (on its own tables or on Bogey's), indexes on Bogey's
  tables, publication entries, cron jobs and storage buckets. That record is what
  [`remove`](#removing-a-plugin) takes out. A table's own indexes, constraints, policies and triggers go
  with it and aren't recorded apart.
- **It may change or drop only what it made.** Adding a column to `public.events`, replacing a core
  function, changing a grant on a core table, adding a value to a core enum or dropping anything of
  Bogey's fails the migration and rolls it back, naming each change. Keep the plugin's data in its own
  tables keyed by Bogey's ids (`event_id uuid references public.events on delete cascade`), and its logic
  in its own functions.
- **It can't create extensions.** An instance installs those; say in the README what the plugin needs.
- **Another plugin's objects are off limits** unless that plugin shares them; see
  [Building on other plugins](#building-on-other-plugins).

Rows a migration puts in Bogey's tables are fine where they're keyed by the plugin, since `remove` finds
them by key: roles with `source` set to the plugin, permissions `<key>.<permission>`, settings
`plugin.<key>`. Don't write other rows into Bogey's tables from a migration; `seed.sql` is for demo data.

Name what you create after the plugin (`<key>_scores` with dashes as underscores, `bogey-<key>-...` for
a cron job), so it can't collide with another plugin or a later core table, and a person reading the
database can tell whose it is.

Follow core's rules:

- Every table has RLS and policies in the same file, and every policy checks
  `private.plugin_enabled(event_id, '<key>')` along with the usual
  `private.has_permission(event_id, '<key>.<permission>')`.
- Participant writes that should respect an event's network limit call
  `private.network_allowed(event_id)`.
- `SECURITY DEFINER` functions check their caller first, and set
  `search_path = ''`.
- `seed.sql` may define `public.<key>_seed_demo(p_org uuid)`; `bogey seed
  demo` calls it.
- pgTAP tests in `tests/` run after the migrations.

A conversation can carry a plugin's topic, `<key>.<kind>:<id>`: start one with
`startConversationFn({ data: { eventId, subject, body, audience, topic } })` from
`@bogey/db/queries/messages`, and the plugin's `conversationTopic` slot shows what
it's about to everyone who can read it. Load that through RLS, since the topic is
whatever the person who started the conversation sent.

To update a page when rows change, add the table to the `supabase_realtime` publication in your
migration and call `useLiveInvalidate("<table>", queryKey, { filter })` from `@bogey/db/realtime`;
RLS decides which rows each viewer is told about.

Core's generated types leave plugin tables out, so a plugin types its own:
write its schema's `Database` type (what `supabase gen types` writes for its
migrations) and read through `browserClientFor<YourDatabase>()` from
`@bogey/db/browser`. It's the same browser client and session as Bogey's, typed
for your tables; queries run as the signed-in person under RLS. The challenges
plugin's `db.ts` is an example.

To write an audit entry, declare the action in the manifest's `actions` and
log it with `createPluginAudit`:

```ts
const audit = createPluginAudit(manifest);
await audit.log(eventId, "checked_in", { method: "qr" });
```

Only declared actions type-check. Underneath it calls
`public.log_event(event, '<key>.<action>', meta)`, which plugin SQL can call
too, and which refuses actions from plugins that aren't enabled for the
event. Organizers see the entries in the event's **Audit log**, filtered under
the plugin's name. Give each action a label so the entry reads as a sentence
after the person's name, instead of as `<key>.<action>`:

```ts
actions: ["checked_in"],
actionLabels: { checked_in: "checked someone in" },
```

## Signals

A signal says something just happened in this browser tab: "you sent a message", "your solution was
accepted". Another plugin can react to it; the Sounds plugin plays a sound. Declare yours and emit them
where your code already knows (a mutation's success), never by polling for them:

```ts
// manifest.ts
signals: [{ key: "solved", label: "You solve a problem" }], // `<plugin>.solved`

// anywhere in the runtime
const signals = createPluginSignals(manifest); // from @bogey/plugins/signals
signals.emit("solved", eventId);
```

Listen with `onSignal((signal) => ...)`, which gets `{ key, eventId }` for core's signals and every
plugin's, and returns the function that stops listening. `allSignals(installedPlugins())` lists them all
with their labels, so a listener can offer signals it has never heard of. Core emits
`announcement.posted`, `announcement.urgent`, `announcement.sent`, `message.sent`,
`conversation.started` and `notification.received` (`CORE_SIGNALS`).

Signals stay in the tab and never reach the server. An emit with nobody listening is a loop over an empty
set, so emitting costs nothing when no plugin listens. Labels are written from the point of view of the
person in the tab, since that's who hears about them.

## Building on other plugins

Plugins can build on each other, but only where the other one allows it. A plugin says what it lets
others build on with `shares`, and a plugin that builds on another says so with `requires`:

```ts
// the plugin others build on
shares: {
  messages: true,                                   // language plugins may translate its text
  sql: ["challenges_scoreboard", "challenges_problems"], // SQL others may reference, by bare name
},

// the plugin that builds on it
requires: ["challenges"],
```

- **`requires`** lists plugins this one needs installed. Bogey skips a plugin whose required plugins
  aren't installed and on for the instance, with a reason on Instance → Plugins (and skips plugins
  that require a skipped one), and `bogey plugins remove` refuses to remove a plugin another one requires.
- **`shares.sql`** names the tables, views, functions and types other plugins' SQL may use. When a
  migration builds on another plugin's object (a foreign key to its table, a view over it, a policy or
  trigger that calls its function, or a function whose body names it), that plugin must be in `requires`
  and the object in its `shares.sql`, or the migration fails. A function body is checked by the names it
  mentions, since Postgres records no dependency for it.
- **`shares.messages`** lets other plugins translate this plugin's text. A language plugin's
  `catalogs` can then hold its keys (`<key>.<message>`) beside Bogey's, so a language pack covers the
  plugins too. Without it, those keys are ignored. The plugin's own `messages` still win for the
  languages it ships.

Signals need no permission: any plugin can listen to any plugin's (see [Signals](#signals)).

## Updates and the CLI

```
bogey plugins list              installed plugins, which are disabled, and which don't fit this Bogey
bogey plugins info <key>        version, author, source
bogey plugins outdated          newer versions in each plugin's repository
bogey plugins status [key...]   which of its migrations a database has applied
bogey plugins migrate [key...]  apply the pending ones
bogey plugins remove <key>      uninstall: everything it made, its rows in Bogey's tables, its files
bogey plugins sql [key...]        migrations and seed.sql, for psql
bogey plugins new <key> --repo=github:you/repo
```

The CLI reads manifests as text and never runs plugin code, so inspecting a
plugin you don't trust yet is safe.

## Security

A plugin runs inside the app with the same access as Bogey's own code: its
pages can read anything the signed-in person can, and its SQL runs as the
database owner when you apply it. Install only plugins you'd merge into your
fork. Row-level security is still the boundary for what people can do; a
plugin's permissions and roles only work through its policies.

## First-party plugins

`challenges` ships with Bogey. The rest are kept in [bogeyx](https://github.com/0xethen/bogeyx) and listed in
its `index.json`; `bogey plugins search` finds them and `bogey plugins add <key>` installs one. Finding a team used to be the
`team-matching` plugin; it is part of Bogey now (the Team page and Manage → Teams).

| Plugin          | What it adds                                                                                                                                                                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `challenges`    | Ships with Bogey. Programming contests (problems, a judging runner in Docker sandboxes, ICPC, IOI and golf scoring, a scoreboard, jury tools, problem packages) and capture-the-flag events (flags, dynamic scoring, hints that cost points, first blood). |
| `lockdown`      | Full-screen and tab-switch monitoring for contests, with a companion browser extension and Safe Exam Browser checks.                                                                                                                                       |
| `sounds`        | Your own sounds for what happens in an event, cues timed to the schedule (a song that ends when hacking does), and background music.                                                                                                                       |
| `extra-judging` | More ways to rank a round: pairwise comparison (Gavel-style), peer rating by participants (game-jam style), ranked ballots (Borda count) and a points budget.                                                                                              |
| `leaderboard`   | Kaggle-style scored prediction files against hidden answers, with a public and a private board.                                                                                                                                                            |
| `github`        | Fill a submission from a repository's README and publish projects to a GitHub profile README.                                                                                                                                                              |
| `i18n`          | Other languages for Bogey, starting with Spanish.                                                                                                                                                                                                          |

Each plugin's README says how to set it up.
