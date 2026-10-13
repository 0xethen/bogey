---
name: bogey-admin-ux
description: Bogey (hackathon platform) organizer and admin UX — where Manage, Organization and Instance pages live, how they're navigated, and the editing patterns they share. Use when editing apps/web/src/routes/_authed/events/$slug/manage/**, org/** or admin/**.
---

# Bogey organizer and admin UX

## Three levels

- **Manage** (`/events/$slug/manage/*`): one event, for people with
  `event.manage`. A sidebar (`SettingsLayout`, see below) in
  groups: Overview and Audit log; Event (Details, Homepage, Agenda, Security, Plugins);
  People (Registration, People, Teams, Divisions); Competition (Submissions with
  Submission forms under it, Judging); Communication (Announcements, Messages: settings
  only; posting and answering happen on the event's Messages tab). Security holds publishing (draft, unlisted, public), who can join (invite-only and the rest), the network limits and any other security setting; plugins put
  sections of their settings on these pages (`settingsSections`, rendered by
  `<PluginSettingSections page>`, which every page ends with) or on pages of their own. Badges show what needs attention (pending people, open questions).
- **Organization** (`/org/*`): org admins and owners. Tabs (`ORG_TABS`, also the
  account menu's Organization submenu): Events (`/org/events` redirects to `/events`),
  Members, Plugins, Audit log, Settings. Settings is a sidebar of pages: General,
  Sign-in methods, Event defaults, Email, Search engines.
- **Instance** (`/admin/*`): platform admins. Overview (counts, and a warning when
  the database's migrations don't match the app), Organizations, Admins,
  Deletions, Plugins, Settings (General, Accounts and sign-in, Event defaults, Limits,
  Email, Search engines, Client IPs).
- **Account** (`/account/*`): Profile, Preferences, Accessibility, Notifications, Keyboard
  shortcuts, Sign-in and security (`?mfa=admin` lands there), and Plugins when a plugin
  has a preferences panel.

## Settings sidebars

- Manage, Org settings, Instance settings and Account share `SettingsLayout`
  (`apps/web/src/components/settings/layout/`): groups of pages with icons, collapsing to icons
  (remembered per person, preference `core:settings_sidebar_open`; layouts prefetch
  `preferencesQueryOptions` so it doesn't jump), a drawer on phones. Page links are resolved
  hrefs (`to: string`), like the tab row. Manage's header is `EventSwitcher`: the org's events
  the person manages, keeping the current page.
- The search at the top finds settings, not only pages: each page lists what's on it in
  `staticData.settings`, beside what it renders, using `searchSection(title)` (a
  `Screen.Section`, anchored by its title as a slug), `searchSettings(namespace, keys)` (registry
  rows, anchored `namespace.key`) and `searchFields(schema, section)` (labels from the schema's
  meta). Adding a section or setting to a page means adding its entry.
- `components/settings/`: `layout/` (the sidebar and search), `fields/` (`SettingFields`,
  `SettingRow`, network lists), `sections/` (Email, Event defaults, Sign-in methods, plugin
  settings) that more than one level renders.
- The organizer surface is not a separate app: participants, judges and
  organizers share routes, and "View as" previews another role's view.
- Instance identity (name, theme, disabled plugins) lives in `bogey.config.ts`,
  a tracked file, and is shown read-only.

## Pages

- Each section is a real route with a purpose; no tab panels holding unrelated
  forms. Titles and breadcrumbs come from `staticData.title` or a loader's
  `title`, without repeating the parent.
- Windows (ADR 0004) are what open and close things: registration, teams,
  submissions, judging, results, gallery, sessions, plus plugin windows. Edit
  them on Agenda, which also holds sessions and session types. There are no stages.
- Everything a Manage page shows an organizer links to where it's fixed.

## Editing

- Existing data is edited in place through the app-wide save bar, no per-section
  Save buttons; creating something has its own submit button (details:
  `bogey-frontend-conventions`, Forms). Bigger creations (announcements) use
  `CreateDialog`: title and body on the left, settings on the right, stacked on phones.
- Dialogs are mounted once and opened from anywhere with a Base UI handle: a
  plain `<DialogTrigger handle={...} render={<Button />}>Label...</DialogTrigger>`,
  never a bundled "XButton" component.
- Destructive actions are `<Button confirm={{ title, description, label }}>`, naming
  what will be lost. Icon-only ones (a trash can) carry `aria-label` and `title`
  ending in "...". Labels of actions that open something end with "...".
- Lists people fill in (questions, submission items, criteria, sessions) are
  `EditableList`s with Duplicate and Remove (see `bogey-frontend-conventions`, Forms).
- The event home is customized on the page itself (`?customize=true`). Manage →
  Homepage explains the blocks and has the Customize button. Blocks are
  header-and-content cards dragged whole, edited with their pencil, added from a
  palette grouped by `BLOCK_GROUPS`. The layout is the `home` setting; pictures
  upload to the public `event-assets/<event_id>/` bucket.

## Audit log

- The audit log is the org admins': Organization → Audit log, a `DataTable` filtered
  by kind, event, person (`SearchSelect` of members) and a `DateRangePicker`, all in
  search params, 50 at a time. Manage → Audit log is a link there with the event
  picked, shown only to org admins. Labels come from `ACTION_LABELS`; details are one
  readable line, never raw JSON or ids.
