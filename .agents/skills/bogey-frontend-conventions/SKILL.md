---
name: bogey-frontend-conventions
description: Bogey (hackathon platform) frontend conventions in apps/web and packages/ui — where a component goes (packages/ui, components/, routes/**/-components), CSS/theming tokens, TanStack Router chrome/nav/title system, TanStack Query defaults, forms and editable lists, timezone/clock handling. Use when adding or moving a component, or editing apps/web/src or packages/ui/src.
---

# Bogey frontend conventions

## Where code lives

Components sit at the narrowest level that holds every user:

- `packages/ui/src/components`: general components with no Bogey domain in them
  (buttons, dialogs, form controls, `EditableList`, `OTPField`, the save bar), in
  shadcn style over Base UI. A new reusable look goes here first.
  `packages/ui/src/lib`: the form kit (`form.tsx`) and the save bar (`unsaved.tsx`).
- `apps/web/src/components/<area>`: components **shared** by two or more routes
  (`event`, `settings`, `navigation` for the header, menus and chrome).
  `components/event/` is split by area (`messaging/`, `team/`, `submission/`,
  `judging/`, `agenda/`). `components/navigation/header/` is the chrome (menubar,
  tabs, `NotificationBell`, `AccountMenu`); the authed header's `end` slot is
  declared in `_authed/route.tsx`.
- `components/app/`: overlays mounted once by a layout (`CmdK`, `ShortcutsHelp`,
  `SignOutDialog`, `PreviewGate`). A trigger calls the dialog's handle; it never
  renders the dialog. `CmdK` and `SignOutDialog` are mounted in `_authed/route.tsx`,
  `ShortcutsHelp` in `__root.tsx`.
- `apps/web/src/routes/<path>/-components/<name>.tsx`: a component only one route
  uses, beside it (`_authed/-components/two-factor.tsx` for Account,
  `events/$slug/-components/home/` for the event home). The `-` keeps the router from
  reading it as a route. Between the two, a component shared by sibling routes goes
  in the nearest shared route folder's `-components/`. When it spreads further, move
  it up to `components/`.
- `apps/web/src/lib`: app logic and hooks with no markup: the viewer and session
  (`viewer.ts`), ⌘K (`commands.ts`), shortcuts, settings mutations, plugins, windows.
  Hooks live beside what they're about; generic ones in `lib/hooks/`. `lib/server/`
  holds `*.server.ts` only; ambient types are in `globals.d.ts`.
- `packages/db/src/queries/<domain>.ts`: server functions and their query options,
  exporting only those (plain server-side helpers stay module-private).
- Pages read the session from route context; chrome uses `useSession()`.

## CSS / theming tokens

- Never hardcode px for spacing/radius that should track the theme. Themes vary
  `--spacing`/`--radius` (default `0.25rem`/`0.625rem`; a square theme might use `0rem` radius),
  so a fixed px value is only ever right in one theme. Derive layout heights
  (`--layout-offset`, `--nav-height`, `h-safe-*`) as multiples of `--spacing`.
  `apps/web/src/index.css`.
- Every theme file lives in `packages/ui/src/styles/themes/<name>.theme.css`
  and must be explicitly imported in `themes.css` — only import themes actually
  shipped to the client.
- Chrome (preview banner, menubar, tab row) renders as one sticky stack, not
  independently-sticky siblings (multiple `top: 0` elements overlap). Each
  bar's presence offsets the ones below it. `navigation/header/` (menubar, tab row, preview bar, clock) and the
  Manage sidebar all read the same stacking CSS variables.
- `Panel` (packages/ui) supplies only radius/border/background/`--panel-spacing`,
  no padding by default — for edge-to-edge rows use `PanelSurface`, or opt into
  padding via `p-(--panel-spacing)`.
- `.typeset` auto-styles every descendant `<a>` (underline, weight 500) —
  a `Button` rendered `as` a `Link` needs the `data-slot` exemption in
  `utilities.css` (specificity 0,2,0, loaded after typeset.css) or it looks
  like body text instead of a CTA.
- The pointer cursor comes from one selector in `utilities.css` (buttons, links,
  `[role=button]` and kin, minus disabled ones and text inputs); components inherit it.
  Text-entry controls with a button-ish role, like combobox inputs, set `cursor-text`.
- CodeMirror editor theme (`packages/ui/src/components/code-editor.tsx`) is
  built from Bogey's own CSS variables, not a canned theme, so self-hosters'
  brand colors apply automatically.

## Router chrome / nav / title system

- Route header declarations (`header: {...}` static route option) **merge down
  the match tree** (ancestor + descendant combine), not "deepest wins" — a
  child route adds only the piece it needs (e.g. a tab row) without restating
  what an ancestor already declared. There is exactly one render site,
  `__root.tsx` → `RouteComponent`.
- The tab row (`header: { type: "nav", nav }`) is either a fixed `RouteTab[]` or
  a component defined in the route file that reads its own route with
  `Route.useMatch({ shouldThrow: false })` and renders `RouteTabs`. That keeps
  route context typed (no `match.context as ...`), and it renders on the server,
  unlike a context+effect version that pops tabs in after hydration. The header
  sits above the route, so read the context only when `match.status` is
  `"success"`: a match whose `beforeLoad` threw (not found, redirect) has none.
- No router hooks (`useMatches`, `useRouter`, etc.) may be called in the
  document shell component itself — `useMatches()` works during SSR but throws
  on the client because the shell renders outside the router at that point.
  Anything needing matches belongs in the root route's `RouteComponent`. `useRouter({ warn: false })`
  returns `null` outside a provider instead of throwing, which is how one
  unconditional hook call works across server/client.
- `data-header-type` (which drives `--layout-offset`) is set in a **layout
  effect**, not a regular effect — running after paint flashes one frame at the
  wrong content height on every navigation between header types.
- Titles: `staticData.title` is a static name (or `{ page, breadcrumb }`). When
  the name depends on data, the route's loader returns `title` in the same
  shape and `lib/routing.ts` reads it with a runtime check, falling back to the
  static one while loading. Nothing in `staticData` takes the match: a function
  typed against the registered router's matches is circular and silently
  widens the router to `unknown`.
- The ⌘K menu (`CmdK.tsx`, built by `lib/commands.ts`) lists signed-in
  routes from the router itself: a route shows under its title unless it sets
  `command: false`. `command: { group, when }` on a layout applies to every
  route under it, so gate `/org` or Manage once, not per page. `when` takes the
  `Viewer` from `lib/viewer.ts`, whose event checks (`hasTeamPage`, `manages`,
  ...) are the same ones the event tabs use. Paths with params other than
  `$slug` are left out; `$slug` fills from the current event.
- "Row not found" and "row exists but forbidden" collapse to the same 404 —
  RLS returns no row in both cases, and distinguishing them in the UI would let
  a viewer confirm the existence of events they can't see.
- Plugin pages mount under one splat route each: signed-in pages at
  `/events/<slug>/x/<key><path>`, `public` ones at `/x/<key><path>`. Links to them
  go through `createPluginNav(manifest).Link`, typed by the manifest's paths, which
  stays in the event being viewed.

## TanStack Query defaults

- Default `staleTime` (`apps/web/src/router.tsx`) is tuned to avoid refetching
  the same roster on tab switches while self-correcting a stale window or score
  reasonably fast. Use a shorter per-query override only when the value is
  itself a deadline.
- `refetchOnWindowFocus`/`refetchOnReconnect` are both on — an organizer runs
  the app in a background tab for hours on venue wifi, and returning to the tab
  is exactly when a stale screen is most likely wrong and most likely trusted.
- Prefetch data that renders in the initial view (plugin settings, dashboard
  panels) in the loader so it's in the SSR payload — avoids a visible
  flash-then-correct.

## Preview / "view as role"

- Preview only narrows the UI — never touches session, cookies, or RLS. A
  previewing admin retains full real access underneath. It answers "has X
  shown up for them yet," not "what can this role actually do" — using it to
  test authorization gives wrong answers. State lives in `sessionStorage`
  (never sent to server), so it can't leak into RLS and doesn't survive tab
  close.
- Route guards use the real session and access (`can()`), intentionally; the
  areas a preview mustn't reach (Manage, Organization, Instance) are wrapped in
  `PreviewGate`, which closes them while previewing a role that couldn't open
  them, with a button to stop previewing.
- `owner` is excluded from the pickable preview-role list (previewing only
  narrows, so previewing the top role is meaningless).

## Connection / offline UX

- "Can't reach the server" (`lib/connection.ts`) counts only network failures
  (`unavailable`, or a failed fetch) of queries and mutations: a forbidden or
  missing row is an answer, not an outage. It needs two within a minute, and
  clears on the next success or a minute after the last failure.
  `navigator.onLine` only reports device connectivity, not backend
  reachability, so "You're offline" is a separate signal.

## Clock / deadlines

- Deadlines are enforced server-side against Postgres time; client clock drift
  is measured once from the loader's already-fetched value, not re-measured
  per tick (drift within one sitting is negligible, and per-tick would mean a
  request per tick). Countdown reads the event id from the matched route
  loader, never parses it from the URL slug — `eventWindowsQueryOptions` expects
  a uuid, and feeding it a slug silently makes every call fail closed via
  `requireId`.
- A closed submission window renders a lock icon in the same header slot a
  countdown would occupy — rendering nothing when closed conflates "closed"
  with "no deadline set."

## Forms

- Every form is TanStack Form **v2 alpha** through the kit (`@bogey/ui/lib/form`):
  `useAppForm`, validators as arrays (`rewardEarlyPunishLate(schema)`, `{ ...remoteCheck, run }`),
  `field.value`/`field.meta`/`field.errors` (never v1's `field.state`), `form.ArrayField` or
  `form.Field` render props for lists, `createValidationError(...)` returned from `onSubmit`,
  `appFormOptions.strictSchema({ defaultValues, validators })` when selects need the schema's
  unions. The local v2 docs are in `.vault/tanstack-form-v2alpha-docs`.
- **The Zod schema describes the form.** Each key carries `.meta({ label, placeholder })` and
  `.describe("...")`; the kit's field parts read them for the form's path (`useAppForm` remembers
  the Zod schema among its validators), so a field is just
  `<form.Field name="slug">{(field) => <field.SlugField required />}</form.Field>`.
  `field.Label`, `field.Legend` and `field.Description` with no children, and every control's
  placeholder, come from the schema too. A description that depends on the value goes on the
  schema, last in the chain: `.register(fieldHelp, (handle) => t("profile.handleHelp", { username:
  handle }))` (typed by the field's input; not a `.meta()` key, which would make schemas invariant).
  A prop overrides the schema for one use. Data-driven forms (registration questions)
  build their schema with each question's `.meta`. Outside the kit's parts, read it with
  `schemaMetaOf(field)`. Shared fields (`eventFields`) carry their meta once.
- A form-level schema in `staticData` (see Manage search) must be declared above `Route`.
- Native `<input type="datetime-local">` is avoided (inconsistent/missing
  picker across browsers) in favor of separate date+time controls; the value
  format stays `YYYY-MM-DDTHH:mm` so it's a control swap, not a data-shape
  change.
- Form-level validators route every issue to both `state.errors` and, if the
  issue carries a path, to that field — `<FormError />` must render only
  `state.errors` minus what's already shown on a field, or errors repeat.
  (`packages/ui/src/lib/form.tsx`)
- Field-linking callbacks are named `onValueChange`, not `onChange`, because
  they run *in addition to* the field's own update, not instead of it.
- Forms keyed on a row id (so they remount fresh once loaded data is known)
  beat syncing query data into form state via `useEffect` — the effect version
  overwrites in-progress typing on every refetch.
- Editors for things people fill in (registration questions, submission items,
  judging criteria, sessions) show each entry as its audience will see it, using the
  same component they see (`QuestionPreview`, `SessionCard`, `CriterionField`), in
  `EditableListItem` (`preview`/`editing`, a filled check button to finish). One card
  edits at a time; one that can't be saved yet stays open so its error is visible.
  The card adapts: `handle` (a grip, or drag the whole card), `editWith` (click the
  card, or an Edit button), `title` (a header row naming the card, its buttons beside
  it). `EditableListGroup` lets cards move between lists (sessions between slots, home
  blocks between columns) and takes new ones from `EditableListSource` palettes; it
  moves items in state as they pass, so React owns the DOM.
- Date pickers render as `PickerField`/`PickerButton` so they match the inputs beside
  them. Codes use `OTPField`.
- Every page that edits things has a form or a save-bar control; there's no ad-hoc
  `useState` + Save button form.
- One save bar for the whole app: `apps/web/src/components/unsaved-changes/` holds the
  provider, the bar, the leave guard, `useDraft` and `useUnsavedState`, mounted in
  `__root.tsx`. `@bogey/ui/lib/unsaved` is only the port that forms and plugin pages report
  into (`useUnsavedEntry`). Anything that edits existing data joins the bar instead of having
  its own Save button: forms render `<form.Form unsaved="save">`, single values use
  `useDraft(saved, save)` from the app component, anything else
  `useUnsavedEntry({ dirty, save, reset })`. `SettingFields` always drafts into it.
  "Dirty" means different from the saved value (`!isDefaultValue`), not "was touched", so
  editing a value back hides the bar.
- A preference can't be stored as `null` (the column is not null); use `false` for "off".
- Leaving a page with unsaved edits is blocked with `useBlocker`; instead of a dialog the
  bar shakes and focuses Save. Reload and close still ask (`beforeunload`). Mod+S saves
  (TanStack Hotkeys), also from inside inputs.
- Forms that create something or are submit-like (new event, Submit project, scoring)
  keep their own button and render `<form.Form unsaved="draft">`: leaving is blocked and the bar
  only offers Discard. Submitting may navigate, so it isn't blocked while submitting.

## Keyboard shortcuts

- App-wide shortcuts are listed in `SHORTCUTS` (`apps/web/src/lib/shortcuts.ts`) and
  registered with `useShortcut(id, callback)`, never a bare `useHotkey` with keys
  written inline: people rebind or turn them off on Account (stored per person in
  `user_preferences`, namespace `core`), and the help dialog (Shift+/) lists every
  registration that has `meta.name`.
- A shortcut scoped to one element (like Mod+B in a Markdown field) uses `useHotkey`
  with `target` and `meta` (name, description, group) so it shows in the help while
  mounted.

## Announcements

- Who sees one is the database's call: `everyone`, or rows in
  `announcement_audiences` (roles, divisions, teams). Reads are per account
  (`announcement_reads`), so unread counts follow people across devices.
- Announcements are a channel in Messages (`?c=announcements`, the default), listed above
  conversations and drawn with the same `ChatMessage`/`ChatFeed` (`components/event/messaging/chat.tsx`).
  Everyone has the Messages tab, organizers included (they answer there); conversations show
  only where `chats()` allows them, read with the previewed access so "view as" narrows it.
  Manage → Communication only holds settings. The old `/announcements` routes redirect there.
- The composer is `NewAnnouncementDialog`, mounted once in the event layout for
  managers; open it with the `newAnnouncement` handle from any page.
