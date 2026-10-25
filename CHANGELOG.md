# Changelog

<!-- Welcome to the Bogey Changelog! -->
<!-- What changed in each release, newest first. `bogey upgrade` prints the entries
an upgrade brings in, so write them for whoever runs an instance: what they'll
notice, and anything they have to do under **Upgrade notes**. A release that fixes
a vulnerability has a `### Security` section naming the affected versions and the
advisory (see docs/contributing.md#security-releases). -->
<!-- This file is also used on the Releases page. -->

## Unreleased

- Manage → Teams: **New team** can pick its members from participants without a team, and each team's details have an **Add a participant** search, so a walk-in can be put on a team in a couple of clicks.
- SparkCloud: `bogey-upgrade` keeps a custom logo (or any file in `public/brand`) whole. It was served cut off at the size of the image's own file.

## 2.4.10 (2026-10-25)

- **Check in before using the event** (`checkin.requiredToEnter`, under Registration → Check-in): a participant who hasn't checked in sees only their badge, with a note to show it at the desk, and can't open teams, submissions, messages, the agenda or anything else in the event; the database refuses it too. The event opens on its own the moment they're checked in. It includes **Check in before competing**.
- Check-in, People, Review, Teams and Submissions have a refresh button that reloads their lists, for people and teams added since the page opened.
- Creating, joining or leaving a team now updates everything else that depends on it, like the submission page, at once instead of after a reload.

### Upgrade notes

- Adds the `checkin_gate` migration; `bogey upgrade` applies it. It replaces `private.event_gate` and `private.check_in_ok`.

## 2.4.9 (2026-10-25)

- Criteria can be pasted in from a rubric written as text: each criterion's name, then its scores (`0 points.`, `1-3 pts:`) with what earns them, with lines like `Row A` starting a criterion. **Import criteria** on the criteria page is now an editor like the roster import's: paste a rubric or a spreadsheet, or drop a CSV, Excel or text file into it, check the criteria it found and any lines it couldn't read, then **Add to criteria**.
- Organizers can upload a PDF under **Guide for judges** on the criteria page (`judging.guide`). Judges switch between **Project** and **Guide** beside the score sheet to read it. Only judges and organizers can open it.
- Moving between projects with J and K, or the arrows, is immediate: the projects either side are loaded ahead, and a project that isn't shows its page with placeholders while it loads, instead of waiting on the old one.
- The judging page's project and score columns are no longer boxed in; the divider between them still resizes them, and both start at the top for each project.

## 2.4.8 (2026-10-25)

- Registration questions and submission items can be for chosen divisions and tags only, under **Only for** when editing one. People are asked a question when they're in one of its divisions or hold one of its tags; before they join, their division is the one their invite link puts them in. A team fills in an item when it's in one of its divisions or a member holds one of its tags. Deleting a division or tag drops it from these lists, and copying an event carries them over to the copy's divisions. The check-in kiosk asks walk-ins only the questions for everyone.
- Submission forms open on their own page from **Submissions → Forms** instead of expanding in the list.
- **Smallest team** and **Largest team** moved from **Details** to a **Team size** section on **Teams**. **Teams** is always in the menu now; for a solo event it holds just that section.
- The overview's **At a glance** numbers come first on the page, and each opens its page (People, Teams, Submissions, Judging).
- Judges can move a project to another division from its score sheet, under **Division**. The whole team moves, its members get a notification, and the move is audited. Only divisions the project's form is open to are offered. Turn it off with **Judges move projects between divisions** in the judging settings (`judging.judgeDivision`, on by default). Teams see their division at the top of their submission page.
- A division participants can't pick has a new **Participants see it** switch (off by default). Off, it's left out of the divisions participants choose from, except for the people already in it.
- Once a participant chooses their team's division, their teammates can't change it; only they or an organizer can, until they leave the team.
- **Tags** moved under **People** on the manage page (`/manage/people/tags`; the old links redirect), and **Public gallery** comes after **Submission forms**.
- Steps in a stepper no longer cut off the current step's name on narrow screens.
- The done button on an item being edited in a reorderable list is outlined.
- Multi-select fields shown beside their label (like a tag's **Also lets them**) fill their column instead of shrinking to a sliver.

### Upgrade notes

- Adds the `audiences` migration; `bogey upgrade` applies it. It adds `division_ids` and `tag_ids` to `submission_items`, and replaces `register_for_event`, `invite_link_view`, `check_in_walk_in`, `save_submission_form`, `clone_event` and `private.submission_problems`.
- Adds the `judge_division` migration; `bogey upgrade` applies it. It adds `set_submission_division` and a `judging.division_set` notification kind.
- Adds the `division_choices` migration; `bogey upgrade` applies it. It adds `divisions.visible` and `teams.division_chosen_by`, and replaces `choose_division`, `choose_team_division`, `clone_event` and `private.guard_team_update`.

## 2.4.7 (2026-10-25)

- Faster reads for big events: row-level security asked "may this person manage (or view people in) this event?" once for every row it checked, so reading an event's members as a participant took most of a second at 400 members and grew with the event. Policies now work out the caller's events once per query (`private.events_where`); reading 50 members of a 400-person event went from about 860 ms to 6 ms, and profile lists from about 270 ms to 70 ms. The challenges plugin's organizer checks do the same.
- `SUPABASE_INTERNAL_URL` (optional) is where the server reaches Supabase, such as a gateway on the same machine, instead of going out to `SUPABASE_URL` and back. Browsers, auth cookies and the links Bogey hands out keep using `SUPABASE_URL`.
- SparkCloud: the box stays under its 200-task cap. At about 170 tasks idle, a few dozen visitors were enough for Postgres to fail to start connections, so pages returned 500s and GoTrue and PostgREST crashed. Runtimes now use two threads of each kind instead of one per core, Postgres runs no parallel query workers, and Studio and pg-meta start only with `bogeyctl start meta studio`; the box idles at about 100.
- SparkCloud: the web app talks to Supabase through Caddy on the box instead of out through SparkCloud's proxy and back. Caddy gives every service the visitor's address as the only `X-Forwarded-For` entry, so network limits see the visitor rather than the proxy, and GoTrue now rate-limits sign-ins, codes and token refreshes per visitor (it didn't limit them per address at all before), with the all-in-one's limits.
- SparkCloud: Realtime has the all-in-one's limits, 500 connections, 250 joins and 500 messages a second, instead of Realtime's defaults of 200, 100 and 100, which turned away the 201st open tab and dropped messages.

### Upgrade notes

- Adds the `permission_event_sets` migration (and the challenges plugin's `12_permission_event_sets`); `bogey upgrade` applies them. It replaces about 100 policies with equivalent ones and changes `private.can_see_profile` to take the caller's events; a plugin that calls `private.can_see_profile(uuid)` itself needs updating.
- SparkCloud: Studio and pg-meta no longer start on their own. Start them with `bogeyctl start meta studio` when you need them.

## 2.4.6 (2026-10-25)

- The web server exits when it's told to stop. Since 2.4.1 a channel opened for "View as" kept the process alive after it closed its server, so a restart without a forced kill left the app down: on SparkCloud, `bogeyctl restart web` and `bogey-upgrade` waited forever and the site returned 502; under Docker, stopping the container took the full 10 seconds.
- SparkCloud: `bogeyctl restart` sends SIGKILL to a service that hasn't exited 10 seconds after SIGTERM, as `docker stop` does, and `bogey-upgrade` does the same when it switches or rolls back the app. Rolling back now restores the previous box scripts (it failed with "cannot stat run.prev/run/*").
- SparkCloud: the box installs `libatomic1`, which the Node 26 in 2.4.5's image needs; `bogey-upgrade` installs it on boxes that don't have it before it migrates.

## 2.4.5 (2026-10-25)

- Every dependency is on its latest release, with no exact pins left in the catalogs or overrides: TanStack Router/Start/Query/Table/Virtual, React 19.3.1, Supabase JS 2.118, Recharts 3.10, nodemailer 10.2, TanStack Hotkeys 0.17, and the plugins repo on Vite+ 1.4. Contributors need pnpm 12.15.0 (downloaded automatically through `devEngines`). The Docker image now runs on Node 26. This prepares the release for the load testing discussed in "how can we stress test bogey...".
- The keyboard shortcuts list and the devtools Hotkeys tab read TanStack Hotkeys' new single list of registrations; a shortcut that's turned off is still left out.

## 2.4.4 (2026-10-25)

- Judging: tiebreakers. Under **Judging → Results → Tiebreakers**, organizers list what decides between projects with the same score, in order: a criterion, the score before evening out judges, more judges, or submitted first. Projects are now ranked on their full score rather than the rounded one, results mark ties as "tied" or "tie broken", and tied projects are listed in a fixed order. Advancing the top N takes everyone still tied for the last spot unless **Advance ties for the last spot** is turned off (before, it picked among them arbitrarily).
- Manage pages are capped at a wide width instead of filling the screen, and table rows are a little taller.

### Upgrade notes

- Adds the `judging_tiebreakers` migration; `bogey upgrade` applies it. Rankings now use the unrounded score, so projects that showed the same rounded score may now rank apart, and advancing the top N takes everyone tied for the last spot (turn off **Advance ties for the last spot** to keep exactly N).

## 2.4.3 (2026-10-24)

- SparkCloud: `bogey-upgrade` no longer fails to build when `brand.theme` names one of the instance's own themes ("brand.theme: Invalid input"). `bogey themes` now runs without reading bogey.config.ts, since that config is checked against the theme list it writes.

## 2.4.2 (2026-10-24)

- Contributors: `tsc` at the repository root checks only the root files, and `vpr typecheck` runs tsc in every package (never cached).
- Loaders use TanStack Query's `queryClient.query` instead of the deprecated `ensureQueryData` and `fetchQuery`; nothing changes for users.

## 2.4.1 (2026-10-24)

- "View as" now applies to the data too, not only the screens: while previewing a role, the database answers as that role, so a participant preview no longer shows hidden test cases or anything else that role can't see. The preview is kept for the browser session across tabs rather than per tab.
- SparkCloud is a supported way to run Bogey: `deploy/sparkcloud` has an installer for a fresh box and the scripts that run the all-in-one stack without Docker (see docs/self-hosting/sparkcloud.md). Its `bogey-upgrade` builds this instance's own themes (`/srv/bogey/themes`) into the app alongside plugins, and installs each release's box scripts.
- `bogey -v` (or `--version`) prints the versions of Bogey, the plugin API, Node and each installed plugin.
- Manage > Judging counts every sheet a judge finished as done, including projects that weren't assigned to them, and shows how many of those were unassigned.
- Plugins can declare network areas, so an event can limit a plugin's pages to its networks; the challenges plugin offers its contest, and sending a solution or a flag from outside the network is refused.
- The blocked-access list in Manage > Security says which area each refused attempt was in.
- Challenges: partial-credit problems can score each subtask by its best result across all of a team's solutions (IOI since 2017), next to the best or last solution. The IOI style now picks it.
- Challenges: "Tests a solution runs" can run every test of a pass/fail or shortest-code problem instead of stopping at the first failure, so each test's result is known.
- Challenges: the ICPC penalty and solve times can count seconds instead of minutes; the scoreboard then shows solves as 47:05 and the Contest API export writes RELTIME.
- Challenges: "Show tries waiting for a verdict" can hide pending tries, including those behind the freeze, from the public scoreboard. The jury view always shows them.
- Challenges: adding a problem offers "A problem package" under "Or start from", next to the problem bank.
- **Upgrade notes:** run `bogey db migrate` before updating the runner; a new runner records IOI judgings with each test group's points, which the database needs challenges migration 10 for.
- Account → Notifications and Sign-in & security use the same label, description and control rows as the other settings pages.
- Admin → Plugins limits and agenda session seats are number fields; an empty plugin limit reads "No limit", and empty or 0 seats read "No limit".
- Instance limits (Admin → Settings → Limits) and plugin limits accept 0, which allows none: 0 MB of storage or uploads turns uploads off for every organization. Leave a limit empty for no limit.
- Links and other controls inside a hidden spoiler only work once it's revealed, so clicking a spoiler shows it instead of opening the link under it.
- Draggable list rows show their actions only on hover or keyboard focus on wide screens with a mouse, so titles in narrow places like the homepage editor's side column are no longer cut off. Touch and narrow screens still show them.

## 2.4.0 (2026-10-24)

- Check-in desk: a Register button next to "Register and check in" adds a walk-in to the roster without checking them in.
- Manage → People roster import: **Autocorrect values** is picked before you add a roster, defaults to as much as possible, is remembered for next time, and stays fixed for the whole import. To change it, use **Start over...**, which clears the import.
- Manage → Submissions: the public gallery settings are now their own Public gallery subtab; old #gallery links go there.
- Menus, selects, popovers, tooltips and dialogs fade and grow out of their trigger with one short, shared animation, and hover colors on buttons, rows, links and menu items ease in. Reduced motion turns all of it off.
- Rows in lists keep one minimum height with their icons lined up, table rows are the same height whether they hold text or a button, and action columns sit at the right edge.
- Draggable lists (tags, judging criteria and demos, registration and submission forms, sessions, divisions, pages, prizes, awards) share one look: the same drag handle on every row, actions at the end, a lifted row and a drop line while dragging, and Alt with an arrow key on the handle to move a row.
- Customizing the event homepage: click a block to change it in a side panel while the page updates in place; add blocks from a searchable picker (or the "Add a block..." button under each column), and move a block to the other column from its panel. On narrower screens blocks open for editing in place.
- Homepage blocks can be hidden: they keep their place and settings but nobody sees them. Manage → Homepage marks hidden blocks.
- Dragging respects reduced motion, from the system or the account's accessibility setting.
- Copying an event: every "What to copy" option says what it copies, and Judging sits nested under Submission forms, greyed out with a tooltip while forms are off.
- New event and Manage → Details: the web address has its label above the input like Name, and Starts and Ends sit side by side with their labels above.
- Badges and actions on expandable rows (like Installed on Admin → Plugins) now come before the chevron instead of after it.

- Number settings where 0 means no limit or off (capacity, team leave limit, passkeys, reminders, the check-in code email, the judging disagreement flag, tries per problem) show an empty field reading "No limit" or "Off" for 0, and leaving one empty saves 0. Their descriptions no longer explain the 0.
- Settings, plugin settings, account preferences and forms share one field layout: numbers and selects sit at the right edge of the row, numbers are narrower, and the drag handle on a number sits before it.
- Manage → Agenda is now the windows page (opens, closes, reminders, what participants see); **Sessions** (formerly Session types) lists the event's sessions above the session types. Old links redirect.
- Network limiting can be limited to chosen areas: sessions and check-in, teams and divisions, questions and team messages, submissions, or voting. With none chosen it applies everywhere in the event, as before.
- Judging: the sheet shows only "Saving..." while saving, "Your scores" no longer has its own border, and the project and scoring panels are separate cards. **Flag...** asks whether to flag the project for deliberation or declare a conflict. K is now next project and J previous.
- Judging: a judge without assignments who marks a project done now sees it counted in "X of Y done" (it stayed at 0 because only assigned projects could be marked done). Needs the new `sheet_completions` migration.
- Inline code in pages and Markdown shares one look: a monospace pill with a light accent background. Code blocks are unchanged.
- `bogey watch` only reacts when a file its generators read actually changes (gitignored files excluded), stays silent when nothing is out of date, and prints the baseline advice once per real change. The release command no longer prints "vpr vpr". CI formats the code with `vp fmt` before checking, and on main commits any formatting back.
- Screens can put a button left of the title; back buttons on project pages, the problem page and the problem editor now sit there as icon buttons with a tooltip naming where they go.
- Icon-only buttons across the app show a real tooltip instead of a slow browser title, and disabled buttons (limits reached, nothing to act on, a language that can't run in the browser) say why when hovered.
- The contest scoreboard's headers and cells explain themselves with tooltips (solved, penalty, length, problem names, first solve).
- Certificates have a design editor: Manage → Certificates → **Edit design** on each kind opens an A4 page (landscape or portrait) where text boxes, pictures (logos, signatures), a background and the verification QR code are dragged, resized and snapped to guides, with a preview for a sample recipient beside it. Text boxes take `{{name}}`, `{{award}}`, `{{event}}`, `{{date}}`, `{{org}}`, `{{code}}` and `{{link}}`, and **bold** and _italic_. The verification page, **Print all...** and the preview all draw from the same layout, so what prints matches what you saw.
- Organization → Settings → Certificates holds the organization's designs, which events use until they customize their own. **Customize for this event** copies the organization's design and its pictures into the event, so changing or deleting either never breaks the other.
- Pictures for a design upload to the event's (or organization's) folder. Removing a picture or swapping the background deletes the old file once the design is saved, not while you edit, so discarding is safe; going back to the standard design deletes its pictures, and an organization's files go with it.
- Certificates are off until an event turns them on, and only per event: the organization can no longer switch them on for every event. **Turn on certificates...** asks which kinds the event gives (participation, award, judge, volunteer), then lists each one to set up now or later; what's left shows under **Set up certificates** and in **Needs you** on the Manage overview. Events that already issued certificates keep them on.
- A certificate's background can be a page designed elsewhere: **Background...** in the editor takes a PNG, JPG or SVG, or a slide from a `.pdf` or `.pptx`, and turns the page to match. **Import slides...** reads one deck and gives a slide to each kind of certificate at once. Decks are read in the browser and only the picked slides are uploaded, as pictures. A background can fill the page, show all of it or stretch.
- The Certificates page shows only the kinds the event gives, and a standard design says so in the editor with **Background...** and **Keep the standard design**.
- The menubar's right side is two groups: icon buttons (plugins' buttons, like event sounds, then notifications) and menus (the account menu), the same height and spacing. The account menu's trigger reads "Account menu for <name>" to screen readers.
- The tabs under the menubar are one navigation menu: tabs with a menu open a dropdown on hover, and moving between them slides one dropdown from tab to tab instead of closing and reopening. It doesn't animate with reduced motion.
- Hovering Agenda lists each session with its **Main page**, and **Attendance** for those who take it.
- Fixed a hydration warning from plugin buttons in the menubar (event sounds' mute button).
- Fixed a crash ("Cannot read properties of undefined (reading 'id')") when the server couldn't be reached while viewing an event: the page now shows Bogey's retryable error inside the app shell, and an unreachable suspension check no longer takes down the whole app.
- The public gallery has a Grid / List toggle for viewers, remembered in their browser (or set with `?view=`). Grid uses CSS grid-lanes where the browser supports it and a normal grid elsewhere. Project cards end in a footer with votes, likes and comments, the same in both views. The gallery "Layout" and "Visitors can switch the layout" settings are gone; stored values are ignored.
- Lists across the app share one row style: devices, passkeys, notification and shortcut settings, blocked people, hostnames, certificates, templates, the event schedule and the danger zone now look like the other lists instead of stacks of bordered cards.
- The theme's accent is fainter, and the brand color is kept for main buttons and things that are on: page links, hovers, icon chips, drop targets and selected tiles no longer turn orange. The home page's Information list is a plain list of links.
- Following a link to a setting or section (like `#sessions`) flashes it in the faint accent instead of the brand color.
- Agenda time slots are separated by a rule instead of a box around each, so sessions are the only cards on the page.
- Timezone pickers (preferences, new event, event details) and the audit log's event filter are searchable.
- Button styles are consistent: one main button per group, outline for row and toolbar actions, and quiet red buttons for removing things.
- Fixed **Export CSV** on Manage → People (and the teams, projects, scores, audit and submission-files exports) failing on rosters of a few hundred people, where Chrome showed "members.txt: Site wasn't available": the export asked the database for every person's name in one request too long for the gateway, and now asks in chunks.
- Long tables (people, teams, the audit log, instance people) show 25 rows a page to start with.
- A table row's details line up with the row's first column instead of starting under its checkbox and arrow, and an open row and its details share the page background instead of two shades of grey.
- Roster import: the "things require your attention" list is compact and scrolls inside its box on big rosters, with how many are decided and **Take the suggestions** at the top. Every piece of evidence names its roster lines (`Lines 4, 9: Ethan and Danny wrote "Byte Me 3"`), and each number jumps to that line in the editor.
- Roster import: **Review corrections** gathers three or more of the same kind (like teammates matched by a similar name) under one heading that opens to the list, and long lists of corrections or errors scroll inside their box.
- Challenges: Manage → Contest starts with **Start from a style**: ICPC style (teams of up to three, pass/fail, 20 penalty minutes, verdicts only, a frozen last hour), IOI style (on their own, partial credit, the best solution counts, 50 tries, every test's result) and Code golf. Picking one lists each setting it changes, from the current value to the new one, before you apply it; the settings can still be changed one by one afterwards.
- Challenges: two new contest settings, "Type of new problems" (pass/fail, partial credit or shortest code, or whatever suits the contest style) and "Which solution a partial-credit problem scores" (the best one, as before, or the last judged one).
- Challenges: "Penalty per wrong answer" shows 20 minutes by default, the value scoreboards already used when it was never changed.
- Challenges: a problem's editor tabs have their own addresses (`/jury/two-sum/tests`, `/jury/new/limits`), so the browser's Back goes to the previous tab; old `#tests` links still land on the tab. Moving between tabs keeps unsaved changes.
- Challenges: adding a problem from the problem bank is on the **Add a problem** page (**Or start from → The problem bank**) instead of a button on the Jury page.
- Plugins can offer `settingsPresets` on a settings page, and a splat with slashes is a deeper path (`<Link to="/jury" splat="two-sum/tests">`). See docs/plugins.md.
- The challenges runner no longer holds the service-role key. `bogey runner add <name>` makes a runner key, which can only claim judgings, read the tests of the ones it holds and record verdicts; `bogey runner keys` lists keys and `bogey runner revoke <name>` stops one. A runner with the service key still works, with a warning, and `bogey doctor` (and `doctor --remote`) says what to change.
- The runner no longer gets the Docker socket. In the all-in-one, `docker-proxy` holds it and lets through only the container calls the runner makes, and only for sandboxes with no network, no capabilities and the runner's limits; `runner-gateway` passes on only the runner's database functions. The runner, the proxy and the gateway sit on internal networks of their own, and Caddy no longer shares a network with Postgres.
- Every sandboxed run (compiling, tests, checkers, run scripts) is tighter: file-size, process and core-dump limits, a `noexec` `/tmp` outside compiling, no pulls, no container logs, one deadline per judging, links and FIFOs a checker or run script plants are ignored, and the runner's base images are pinned by digest. `BOGEY_RUNNER_RUNTIME=runsc` runs every sandbox under gVisor.
- A program that prints a NUL byte no longer ends its judging as a judgement error.
- `deploy/runner/` runs the runner on a machine of its own, and [Runner security](docs/self-hosting/runner-security.md) has the threat model and the set-up. Upgrading the all-in-one's runner: copy the new `compose.runner.yml` and `Caddyfile.runner`, make the work folder belong to uid 1000, run `bogey runner add runner` and set `BOGEY_RUNNER_KEY` in `.env` (plugin migration `challenges 9_runner_keys`).

**Upgrade notes:** run `bogey db migrate` (migrations `20261024090000_certificate_designs`, `20261024110000_gallery_view_modes` and `20261024132236_certificate_kinds`, and the challenges plugin's `8_contest_presets`). Existing certificate wording becomes a design of stacked text boxes with the QR code below, so issued certificates look much as before until someone edits them. Manage links moved under their parent pages (for example `/manage/review` is now `/manage/people/review`); the old addresses redirect.

- Long tables have a search box and pages (25 or 50 rows, changeable under the table): Manage → Submissions, Judging (judges and projects), Results, Registration (invites), Certificates and Audit log; the organization's Members; and the instance's People, Organizations and Reports. Tooltips on buttons use the button's own tooltip.
- Manage → People's table has a search box (name, email or team), a "Show" select for everyone, checked in or not checked in, and Role and Division comboboxes that pick any number of roles (plugin roles included) and divisions, each showing how many people have it. "Reset" clears them. These replace the Filter popover.
- Manage → People can group its rows by team, role or division ("Group rows" in the table's toolbar). Each group has an arrow to collapse it, a count, and a checkbox that selects everyone in it; sorting and pagination work inside groups. The choice stays in the page's address.
- Manage → People has a "Columns" menu to hide and show columns, and every column with values sorts from its header.
- Manage → People stays fast with hundreds of people: a check-in, tag change or save in progress redraws only the rows it affects.
- Manage → People → Review's tables (waiting for review, waitlist) have a search box for name or email.
- Manage → People → roster import has a **Guessing** choice (none, some, or as much as possible; the default, as before) that applies to that import. It sets how freely Bogey guesses column meanings, matches divisions, sessions and teams by similar names, and merges similarly named teams.
- Criteria have their own page, Manage → Judging → Criteria, with the criteria, rubrics and the rubric-picking settings. Manage → Judging keeps progress, rounds, manual assignments, deliberation and calibration.
- Each criterion can say what its scores mean: "Guidance by score" takes bands like "1-3: slides only" and "7-10: works end to end", added one at a time or split evenly ("Split into 3"). Judges see the band their score falls in under the criterion as they score, and every band with "Show guidance".
- Criteria → "Import from a file" reads a rubric spreadsheet (CSV or Excel), with a column per score band ("Criterion, 1-3, 4-6, 7-10") or a row per band ("Criterion, From, To, Guidance"). Criteria with the same name take its guidance and new ones are added, for you to review before saving. "Download as CSV" exports the current guidance in the same shape.
- Rubrics can be assigned to divisions, from a rubric's "Divisions" on the Criteria page or a division's "Rubrics" on Manage → Divisions. A division with one rubric judges its projects on it without a pick; with several, its projects pick among them. A rubric with no divisions stays open to every project, and rubrics meant for other divisions aren't offered.
- Submitting is a stepper on the Submission tab: **Project** (the form), **Prizes** (when the team has prizes to enter, or a rubric to pick) and **Review**. **Next** saves the draft as you go, and the steps at the top move between them. Review shows what judges see first (the title, a tagline, the team, its division, the form and how much is answered, without the whole form), what's still missing with a link back to it, the gallery visibility switch, and **Submit**.
- On Review, teams in an event that lets them pick their division can move their whole team to another division. Divisions only organizers place people in, or that can't be left, stay as they are.
- Manage → Submissions → Forms → "Who submits this" sends a form to every team (the default) or only to teams in chosen divisions. Teams only see the forms for their division, and a team that moves out of a form's divisions keeps the draft it started but can't submit it.
- **New form** on Manage → Submissions → Forms opens its own page (`/manage/forms/new`) instead of a panel above the list, and shows the unsaved-changes bar with Save and Reset while you write it.
- New events are invite-only by default (`registration.mode`), so organizers choose to open registration instead of closing it. Events that never chose keep "Organizers approve"; an upgrade stores that for them.
- Organizers can add a message to the not-found and error pages: Manage → Details → "Error pages" for an event, Organization settings → "Error pages" for an organization, and Instance settings for the whole instance (`branding.fallbackMessage`, Markdown). The most specific one shows under the page's own text.
- A session's attendance page works on a phone: the check-in code shows with its QR code, and "Copy link to check-in" and "New code..." are labelled buttons sharing the full width. The code on the full-screen QR is larger. The roster only renders the rows on screen, so long rosters stay quick.
- The check-in kiosk's full screen button turns into "Exit full screen" (with its own icon) while in full screen, including when you leave with Esc.
- Divisions belong to teams: a team's division is its members' division, and people without a team keep their own. Manage → Teams is now a table (search, sort, filter by division, pages) with a **Division** column per team, and checking teams offers **Set division...** for all of them. On Manage → People, changing the division of someone who shares a team (or several picked people) asks whether to move their whole team or only them.
- **Match teams...** on Manage → Teams opens in a dialog.
- Copying an event keeps which divisions each submission form is for.
- Judging a project is a two-panel page: the project on the left (team, division, table or demo slot, round, submitted time, links, and every form the team submitted, each collapsible) and scoring on the right, with a handle to resize them. Scores save as you go; "Save and mark done" (Mod+Enter) opens the next unfinished project, the arrows (or J and K) step through your queue, and a bar shows your progress.
- When a judge finishes their queue, Judging shows what's next: flagged projects to discuss if they're part of deliberation, and other projects to browse if organizers allow it with the new "Judges can browse other projects" setting (Manage → Judging, off by default). Judges with assignments no longer see "Everything else" unless it's on.
- Messages: each message's actions (Copy text, Forward to announcements, Delete announcement) sit under one "..." menu that shows on hover, on keyboard focus and always on touch screens. Deleting an announcement still asks you to confirm.
- "Message a team..." picks the team from a searchable combobox instead of a plain dropdown.
- Manage uses the full width of the screen at every size. Short settings and fields (switches, selects, numbers, slugs, dates) put the label on the left and the control on the right on wide screens, and stack on narrow ones; long text, Markdown and multi-input rows stay stacked. The audit pages (event and organization) fit their page's width.
- Pages that are only a list now show a proper empty state with an icon and a short explanation when there is nothing yet: Prizes, Certificates, your plugin preferences in Account, Plugins for an organization and an event, and Deletion requests and Plugins in the admin area.
- Manage → Agenda is split into pages like Submissions: **Agenda** (the sessions), **Session types**, **Windows** (windows, reminders and what participants see) and **Attendance**. They are in the Agenda tab's menu, and old links to the sections (`#windows`, `#session-types`, `#attendance`, `#reminders`) land on the right page. Jumping to a section no longer washes the whole section in the primary color.
- Live demos have a presentation screen: **Present** on a panel (Manage → Demos, or the judge's queue) opens a full-screen view with the team presenting (title, team, table, members, division and prize tracks), a large timer for its slot that turns to a warning near the end and counts overtime, the scheduled times, who's up next and the panel's judges. The panel's judges and organizers move it along with **Next team**, go back, or restart the timer; every screen on the panel follows. Its settings drawer groups Timer, On the slide and On screen.
- The gallery slideshow can show each project's division and prize tracks and a seconds-left timer while playing. Its settings are grouped into Playback, On each slide and On screen, with "Reset to defaults".
- Countdowns roll: the event home's countdown block and the presentation timers slide each digit to its new value (still when the device asks for reduced motion).
- Side panels (drawers) have a separated header, a scrolling middle and a footer for their buttons.
- Markdown fields accept only what fits them. The toolbar is bold, italic, underline (`++text++`), link and spoiler, then **H1**/**H2** where headings are allowed, then field-specific buttons such as the announcement dialog's attach button. Messages and conversation threads don't take headings (announcements do); short descriptions (session, prize and form descriptions, callout blocks) don't take headings, code or images; a prize's value is plain text with bold and italic only. Syntax a field rejects shows as the text you typed, in the preview, wherever it's shown and in emails.

**Upgrade notes:** run `bogey db migrate` (migrations `20261022100000_criteria_guidance`, `20261022110000_form_divisions`, `20261022130000_access_default`, `20261023090000_team_divisions` and `20261023110000_presentations`). Links to Manage → Judging#criteria now land on Manage → Judging; criteria are at Manage → Judging → Criteria. Events with no stored registration mode keep "Organizers approve"; new events default to invite-only. Each team takes its members' most common division and its members follow it; teams whose members disagreed are listed as notices while migrating.

## 2.3.0 (2026-10-22)

- The gallery is a **Gallery** tab on the event's tab row (with an external-link icon, opening in a new browser tab) for whoever can open it, instead of a button on Home and Results. Organizers can hide, rename or time it under Manage → Pages → Tabs like any other tab.
- The gallery has a layout switch (an even grid, or lanes that pack cards tightly), banner images on cards, winner markers once results are published, a sort menu (newest, oldest, title, team, winners, most liked, most votes, most discussed, shuffled) and optional likes and comments for signed-in visitors. Manage → Submissions → "Public gallery" (the `gallery` settings) sets what's on; likes and comments are off by default, winners and banners on. Teams choose their banner from their project's images, and their card size when organizers allow it, from "Gallery card" on their Submission page.
- The slideshow is an icon beside the sort menu. It opens minimal, with auto-hiding controls (previous, play and pause, next, full screen) and a cog that opens a settings drawer for seconds per project, order, looping, autoplay and what each slide shows. It no longer loops by default.
- Manage → People is split into **People** (the members table with its filter dropdown for check-in status, roles and divisions, roster import and people also in other events), **Review** (registrations waiting for review, the waitlist and invited people, as tables with select-all, sorting and pagination; an "Answers" button opens each person's answers with Approve and Decline, and turns to an outline once opened). Tags is its own page under Divisions (the event's tags, with the organization's listed beside them and a link to edit them for org admins).
- On Manage → People, a person's team is a link to that team on Teams, opened and first in the list. Changing a participant's role away from participant, or their division while they're on a team, asks you to confirm and says what happens to their team. Table cells are vertically centered, and an error alert that appears off screen scrolls into view.
- A session's page and its attendance page link to each other, and the kind and category on a session's page are plain text instead of chips.
- The notifications popover scrolls when it has many items.
- Manage → Judging → "Manual assignments" holds both pins and conflicts. Pinning a judge to a team ("Always") assigns them to the team's projects already in judging, and auto-assign places pinned judges first, ahead of the even share and the excluded tags. A conflict ("Never") keeps them off the team and their scores for it don't count. A judge with a conflict with the team can't be pinned to it, and declaring a conflict removes the pin. Unpinning keeps the assignments the pin made.
- Each judging round has a format (Manage → Judging → Rounds → "Judged"). Online is how judging worked before: judges review their assigned projects on their own. With Live demos, teams present one after another to panels of judges: Manage → Demos sets up the panels (where, when the first demo starts, minutes per team, which judges), places every team on the panel with no conflicting judge and with any pinned judge, and shows each panel's order with times. Panel judges are assigned their panel's teams automatically, and they move "Next team" along from their judging page while organizers watch live. Teams see when and where they present, and how many teams are ahead of them, on the event home and their submission. Use one panel to have one group judge everyone. Offline rounds are judged outside Bogey: organizers enter each project's score under Manage → Judging → Results → "Offline scores", and results rank them like any other round.
- Manage → Demos → "Show teams their demo judges" (judging.demoJudges, off by default) adds the panel's judges to what a team sees about its demo slot.
- Manage → Judging is split in three: Judging (progress, rounds, manual assignments, criteria, deliberation), Demos (live demo panels and expo tables) and Results (offline scores, publishing, popular vote, awards, results).
- "Who takes attendance" (checkin.takers) accepts tags as well as roles, so anyone holding a tag like Volunteer can work the check-in desk and take session attendance whatever their role.
- The registration questions moved from Manage → Registration to their own page, Manage → Registration → Registration form.
- Manage → Messages lists the conversations waiting on an answer, each linking to where it's answered. Its badge in the sidebar stands out while any are unanswered, and otherwise counts the conversations that aren't closed.
- Manage → People, Manage → Teams and Instance → People show 25 rows a page, with a rows-per-page picker (up to 200) and page buttons. On People, the header checkbox picks the page, then offers to pick everyone.
- Pages that list many people (Manage → Teams and Judging, messages, the audit log, org members) no longer fail with "URI too long" on large events: names are looked up in batches. So do the challenges plugin's verdict lists and problem bank.
- Manage → People stays responsive with hundreds of people: ticking a checkbox or opening a registration redraws only that row instead of the whole table.
- On extra-wide screens, the Manage pages use the full width of the window.

**Upgrade notes:** run `bogey db migrate` (migrations `20261018150000_judge_pins`, `20261018170000_judging_formats`, `20261018190000_gallery` and `20261018200000_demo_judges`).

- Announcements no longer all pop up at once when you open an event after they went out (or are let in mid-day): only urgent ones do. Others pop up only if they're posted while you have the event open. Announcement pop-ups are a little wider.
- Manage → Pages → Prizes → "Prize instructions" (submissions.prizePrompt) replaces "Select the prizes you would like to be considered for." above the prizes on a team's submission, for instructions like "Higher places on the podium get first pick, then special awards!".
- Manage → Forms → "Submitted heading" and "Submitted message" (submissions.submittedTitle, submissions.submittedBody) replace "Submitted. GG!" and the line under it once a team submits. `{when}` in the message becomes when they did, like "2 hours ago".
- Manage → Pages → Prizes → "Prize images" (submissions.prizeImage) shows every prize's image as an icon beside it (the default) or as a banner across it. A prize without an image shows an empty dashed frame, so prizes line up.
- Clicking a step in "Ready to submit?" on a submission jumps to that field and highlights it.
- On a form with more than one submit button (Save and mark done / Save for later, Submit / Save draft), only the button you pressed shows a spinner and "Saving..."; the others are just disabled until it finishes.
- `packages/db/src/types/schema.gen.ts` is generated from `supabase/schemas`, with no database: `CORE_PERMISSIONS` (every permission the schema checks or grants, now behind `CorePermission`), `CORE_AUDIT_ACTIONS` (every action it writes to the audit log, now behind `CORE_ACTIONS`, so a new action fails type checking until it has a label) and `COLUMN_VALUES` (what each `check (column in (...))` allows; conversation audiences, team request directions, check-in methods, certificate orientations and profile visibility now come from it). `bogey types` writes it, `bogey types --schema [--check]` writes or checks only it, `bogey watch --schema` keeps it current while you edit the schema, and a test fails when the committed file is stale.
- `bogey preflight --people 250` (or `--event org/slug`, which counts the event's people) checks that the instance can take an event that size before doors open: Auth's sign-in, code-check, refresh and email limits, Realtime's connection cap, connections in use, failed background jobs, stuck mail and how old the last backup is, with the change to make for each. It's on the operator console's Status tab too. See docs/self-hosting/event-day.md.
- `/api/ready` answers 200 only when the database, Auth and Realtime answer and mail isn't stuck in the outbox (503 with the failing check otherwise), for uptime monitors. `/api/health` still only says the app is up.
- Live pages (scoreboards, check-in, judging) spread their refetches over a second and a half after a change, so a few hundred viewers don't all query the database in the same instant.
- The all-in-one compose, the Supabase overlay and `supabase/config.toml` size Auth's rate limits and Realtime's connection cap for an event of about 250 people (500 emails an hour, 500 sign-ins and code checks per 5 minutes, 500 Realtime connections). Sign-in runs on the Bogey server, so GoTrue counts every attendee against one address; the old defaults let 30 people sign in every 5 minutes.
- Projects spreadsheet: Manage → Submissions → Spreadsheet (and Manage → Judging → Results) downloads one row per project as Excel or CSV. Start from a preset (Basic, Basic with judging results, Judging sheet, Everything) and add or remove columns: members and their emails, division, tracks, table, every submission field, rank, score, each criterion's average, awards and votes. It replaces the old submissions CSV, whose link still works.
- Manage → Judging → "What judges can download" (judging.judgeExport) gives judges a Download spreadsheet button on their judging page: nothing (the default), projects, or projects with judging results. Members, emails, awards and votes stay with organizers, and blind judging still hides team names.
- Emails to reserved domains (`.example`, `.test`, `.invalid`, `example.com` and the like) are skipped instead of sent, so demo and test accounts never bounce.
- Tags: label people with tags like "Adult Judge" or "Mentor". Org admins make tags for every event (Organization → Members), and organizers make tags for their own event (Manage → People) unless the org turns "Events can make their own tags" off. Hand them out from the Tags column on Manage → People or on each org member. A tag can also give its holders permissions on top of their role, such as judging projects or checking people in.
- Judging rules: Manage → Judging → Progress saves judges per project and rules like "1 judge tagged Adult Judge and 1 tagged Student Judge on every project", optionally for one division. A rule normally keeps the work even and lets another judge fill in when tagged judges have their share; a strict rule makes tagged judges double up instead, and assigns nothing if a project can't get one. Judges with an excluded tag are never assigned. Assign judges now tops projects up to these numbers instead of adding more judges each time it's pressed.
- Account → Preferences → Home page picks where the logo (and "/") takes you: the default, All events, one of your events, or, for admins, the organization or instance home.
- A session's QR code on its attendance page opens full screen: hover it and click the expand button for a large QR with the code under it, to show a room from a laptop.
- Organizers see a pencil beside Take attendance on a session's page, which opens that session in Manage → Agenda.
- Challenges: Results is now Submissions (old links still work). It opens with a grid of the contest's problems, one square each colored by where the team stands (solved, tried, being judged, not tried) with a key under it; click one to see only its submissions. Submissions can be filtered by problem and verdict and sorted by time, problem or verdict.
- Challenges: Contest → Scoreboard → "Colors for solved and tried" picks the event's colors (solved in its main color, tried muted, the default) or green and red. The scoreboard and the Submissions grid both use it, with a key under each.
- Challenges: the scoreboard, Submissions, the problem list and the jury's pages update as verdicts come in, a problem changes, or an organizer opens or closes the contest, instead of every 30 seconds. The contest opening and closing on time reaches open pages at that moment.
- Challenges: a problem's page is titled "A. Ten" with its type and points under it ("Shortest code · 100 points"). Its input and output are tabs under the editor, and Run switches to Output while it runs.
- Challenges: the jury's problem page has a sidebar like Manage's settings: Details, Statement and Limits; Tests, Checking, Jury solutions and Try a solution; Files, Reuse, Package and Remove. Each tab has its own address (`/jury/two-sum#tests`), and a save that fails opens the tab with the problem.
- Challenges: Checking sets how output is compared (same words, exactly, numbers within a tolerance, or a compare script, which DOMjudge calls an output validator: `compare input answer feedback_dir < output`, exit 42 or 43) and an optional run script, DOMjudge's `run input output program...` in POSIX sh, for interactive problems or ones that call the program more than once.
- Challenges: the organization has a problem bank (Organization → Problem bank), outside any event and grouped by category. A jury saves a problem to it from the problem's Reuse tab, and adds one to their contest with From the bank... on the Jury page. Reuse also copies a problem straight to another of the organization's contests. A copy brings the statement, limits, scripts, tests and jury solutions (judged again there); the statement PDF and files stay behind.
- Challenges: on the Jury page, opening a solution shows a chart of its time on each test against the time limit, with failing tests marked.
- Lockdown 1.3: Safe Exam Browser fails closed. A passing check opens the event only to the sign-in that made it, so another browser signed in as the same person stays covered; each check spends a one-time nonce, so a captured header can't be replayed; and SEB failing a check (its configuration changed, or the key header is off) closes the event at once instead of three minutes later. With SEB required and nothing set up to match it, participants are told it isn't set up yet and Manage → Lockdown Browser warns that nobody can get in. An SEB with the wrong configuration says so.
- Turning lockdown (or any event setting) on reaches pages that are already open at once, and so does an organizer opening or closing a window.
- Challenges: once a contest is over its problems are hidden from participants, unless "Show problems after the contest" is on (Contest → Problems). By default a team waits for a solution to a problem to be judged before sending another ("Wait for a verdict before sending again", Contest → Solving). Submitting goes to a new Results tab listing every try, opened at the one just sent; a problem's page shows only the latest try. Clicking below the code in the editor puts the cursor at the end. Run `bogey plugins migrate challenges`.
- Lockdown: once problems can't be submitted (the contest window closes, or the submissions window without one), lockdown lifts. Safe Exam Browser quits on its own and a browser that had the event open goes to the scoreboard. The quit link on Manage → Lockdown Browser is now Bogey's own address, which the file always quits on; "Ask before quitting" is off by default. Allowed apps are faded and can't be changed while "Allow switching to other apps" is off, and aren't written to the file.
- A session's check-in code says when it works and where: "people enter it, or scan the QR code, on the session's page from 1:10 PM to 2:55 PM". The attendance page shows a QR code beside it that opens the session's page with the code filled in.
- Importing a roster files a column named like a registration question ("School", "Why did you join") under that question, so it lines up with what people answer on the form or at the kiosk. The demo hackathon asks for grade, school and why they joined, none required.
- Lockdown 1.2 has a page of its own, Manage → Lockdown Browser, which holds the Browser setting (moved from Security). With Safe Exam Browser chosen, Bogey writes the configuration there: what the browser allows (toolbar, reloading, new windows, downloads), which sites and apps are allowed, which apps are closed, and the quit password. It serves the file at a link that opens Safe Exam Browser, works out its Config Key so no key has to be copied by hand, and gives participants who open the event elsewhere an "Open in Safe Exam Browser" button. Keys added by hand moved there from the proctor page. Run `bogey plugins migrate lockdown`.
- Events shows a padlock beside events that run in lockdown, and a browser with a padlock when they need Safe Exam Browser. Plugins can show their own icon there with the `eventListIcon` slot.
- Manage → Pages also holds the event's custom pages (rules, a FAQ): add, edit, reorder and remove them, written in Markdown, each for people in the event or anyone, and optionally only while a window is open. They're listed under Home in the tabs.
- Windows can remind everyone in the event before they open: Set reminder... beside Remove... on each window in Manage → Agenda uses the event's default, no reminder, or its own number of minutes. The default (Agenda → Reminders, also used for sessions people signed up for) is now 5 minutes instead of 30; an event that had saved 30 keeps it. People can turn these off under Account → Notifications → Schedule reminders.
- Passkeys under Account → Security show the date they were added, and their name can be clicked to rename it. New passkeys are named Passkey 1, Passkey 2 and so on instead of after the time they were added.
- Lists you drag to reorder (session types, sessions, questions, criteria) line their text up with the grip and buttons, and the one being edited is highlighted in the theme's accent instead of its primary color.
- Sessions have pages of their own, at Agenda → the session's name. A session that takes attendance always has one, where participants check in with the room's code; any session can have page content too (Manage → Agenda → Page), like an intro or a slide deck link. Hovering Agenda in the tabs lists them, which Agenda → What participants see → List session pages under the Agenda tab turns off (for an organization or one event).
- The Check-in tab is only for whoever checks people in (Who takes attendance), and only for the event's desk. A session's attendance is under the session, at Agenda → the session → Take attendance (`/agenda/<session>/attendance`). Participants see their badge on the event home and check in to sessions on their pages.
- Prizes moved to Manage → Pages, beside the event's other pages, and are listed when you hover Home in the tabs. Old links to Manage → Prizes land there. The tab menus are tighter and highlight the item under the pointer in the page's background color.
- Viewing an event as a participant (or staff, or a judge) shows what that role sees: no Check-in desk, and no "Take attendance..." on sessions you don't host. The kiosk, badge sheet, table list, judging and a session's attendance page say they aren't part of the preview, and organizer-only buttons and drafts on Team, Submission and Results stay hidden.
- Manage → Registration → Who takes attendance picks the roles that work the check-in desk and take attendance in sessions (organizers and staff by default; organizers always can). The database enforces it.
- Settings set in `bogey.config.ts` say where: "Set in bogey.config.ts (security.deviceSignOut)".
- Choosing the default organization (Instance → Settings) no longer fails with "tenancy.appUrl can no longer be changed in the app" when `appUrl` is set in `bogey.config.ts`. Saving any instance setting next to one from the file had the same problem.
- `bogey release` cuts alphas, betas and release candidates. Without a version it asks patch, minor, major, a prerelease (which version, then which stage) or another version; from a prerelease it offers the next one, the later stages or the release. `bogey release beta` (or `alpha`, `rc`) moves a prerelease on to that stage, `minor --pre beta` starts one, and the bump that started it releases it (2.3.0-rc.1, `minor`: 2.3.0). It refuses a version that doesn't come after the current one. The stable release takes its prereleases' changelog sections into its own, so its notes cover everything since the last stable release.
- When a `bogey` command fails, it asks whether to copy the error (yes by default) and then whether to open https://github.com/0xethen/bogey/issues (no by default). The address is printed in full so you can paste it into another browser. Unexpected errors ask too.
- The CLI's links to GitHub (the issues page, `bogey docs wiki`'s default `--repo`) use `repository` from `bogey.config.ts`, or `upstream` when it's `false`, instead of 0xethen/bogey. `bogey upgrade`'s hint to add the remote uses `upstream`.
- `bogey release` no longer suggests `?sslmode=require` when a check fails. Bogey's database hints don't apply to the output of `vp check` or the tests. Elsewhere, a test file called `certificate.test.ts` is no longer read as a TLS error.
- `bogey release` run again while the last release is committed and tagged but not pushed offers to push it or undo it, instead of starting another version. `bogey release undo` deletes that tag and commit and keeps uncommitted changes.
- Account → Security shows passkeys like the authenticator app: one Passkeys row saying "Not set up" or how many are added, with "Add a passkey" or "Add another", and each passkey listed under it. Each person can add up to 5; set `security: { maxPasskeys }` in `bogey.config.ts` to change it (at most 9, or `0` to turn adding passkeys off). The database enforces it.
- Lockdown 1.1 holds its cover on the server: while a participant's cover is up (out of full screen, the required browser missing, or stopped), they hold no permission in the event, so its pages and data are refused even through the API, every page sends them to the event's home, and the tabs are hidden. Organizers are never covered. Plugins can do the same by defining a gate (`private.<key>_gate`; see docs/plugins.md).
- Manage → Pages arranges the event's tabs in a row like the tab bar: drag them into order, and click one to rename it, hide it, or show it only while a window is open (organizers always see it). Plugin tabs are included, and plugins can tie a tab to a window themselves (the CTF's Challenges tab shows while the contest is open). The active tab's underline now slides in.
- Walk-ins: New event asks who can check in (pre-registered only, or walk-ins too). Staff adding a walk-in at the desk now checks them in on the spot, making an account for their email when they don't have one. The desk links to a walk-in kiosk to open on a second device: walk-ins type their name and email, answer the registration questions, and are checked in.
- Settings are addressed as `#group.setting` everywhere (form fields, plugin settings, Account preferences and accessibility), and a link to one scrolls to it and washes it in a faint accent that fades. Hints that named a place ("Write it in Manage > Details", "Add it in Agenda") are now links to the exact setting.
- Capture the flag: challenges are edited on the Jury page, one page per challenge like a contest's problems, by organizers and the jury. Editing a challenge keeps its scoring, points, visibility and flag settings (it used to reset them). "First blood" is now "first solve". On phones, table actions (Edit, Delete, Rejudge) shrink to icons.
- New events start with the team board (find teammates) off and with participants' conversations with organizers off; turn them on in Manage → Teams and Manage → Messages. Programming contests and CTFs start with conversations between participants and judges on.
- Challenges: a try's tests are listed one per line with their time and memory, and the first failing test opens to its input, expected answer, output and errors. Samples, run output and compiler errors each have a copy button. Try a solution on the Jury page shows which test is running and which are still to come.
- Live screens (the check-in desk, Messages, notifications, Manage → People, Teams and Submissions) refetch at most about once a second during a burst of changes instead of once per change, and still end on the latest state.

### Upgrade notes

- Run `bogey preflight --people <n>` before your next event. An existing Realtime tenant keeps its old cap of 200 connections (the new compose values only seed new installs): preflight prints the `update _realtime.tenants` to run. On Supabase Cloud, raise Authentication → Rate Limits by hand; set `SUPABASE_ACCESS_TOKEN` and preflight reads them.
- Run `vpr bogey db migrate` and `vpr bogey plugins migrate`. Staff's `people.checkin` and `sessions.attendance` rows leave the role matrix: Who takes attendance (`checkin.takers`) decides now, and its default (organizers and staff) keeps things as they were. Lockdown 1.1's gate needs this release's `plugin_gates` migration. The team board and participants' conversations with organizers are now off by default, so an existing event that never set them turns them off; turn them back on in Manage → Teams and Manage → Messages (or at the organization level) if it uses them.
- The CTF's `ctf_scoreboard` returns `first_solves` and `ctf_challenges_for_team` returns `first_solve`, instead of `first_bloods` and `first_blood`.
- `vpr bogey plugins migrate` also brings challenges `6_live` and `7_bank_and_run_script`, and lockdown `4_seb_fails_closed` and `5_seb_session_nonce`.
- Rebuild and restart the challenges runner (`tools/runner`): an older one judges a problem that has a run script as if it had none.
- Lockdown 1.3 checks Safe Exam Browser with a nonce in the check's address, so a proxy in front of Bogey has to pass the query string through unchanged, as well as the `X-SafeExamBrowser-*` headers.

## 2.2.0 (2026-10-17)

- Announcements can go to the people in a session: everyone signed up for or placed in a session of a choose-one slot (a workshop, not lunch), plus its hosts. Pick it under Sessions in the composer's Audience.
- Rubrics for events with several themes: under Manage → Judging → Criteria, add a rubric per theme and put criteria in it; criteria left on Every rubric count for every project. Each project is scored on the shared criteria plus its rubric's. Judges pick a project's rubric on the score sheet (Judges pick the rubric, on by default), and teams can pick their own on their submission (Teams pick their rubric, off by default, showing rubric names or their criteria too). The results preview names each project's rubric.
- Judges can flag a project for deliberation. While it's flagged, the judges deliberating see each other's scores and notes on it, discuss it on the project's page and resolve it. Judging settings choose who deliberates (the project's judges by default, every judge, or nobody), can flag projects on their own when judges' totals are far apart, and hold publishing until flags are resolved (on by default). Organizers see every flag under Manage → Judging → Deliberation.
- About and For participants are now one About (Manage → Details), for members only by default: approved participants and the event's people see it, and applicants see that there's more once they're in. Share it with anyone who can see the event under Manage → Security → Before approval → About. For text everyone sees, add a Text block to the homepage. The public API's event `description` is About when it's shared, and empty otherwise.
- Manage → Danger zone has clean-ups for organizers: prune participants by any mix of never checked in, not on a team, no submitted project, divisions and sessions; decline everyone still waiting; reset judging; and remove all participants after a dry run. Each shows how many it touches and asks for the event's web address. Delete event now opens the same dialog, with a link to download an archive first. Unpublish moved out: set the event back to a draft in Security.
- Manage → Agenda is easier to follow: Session types come first, and each type now holds its own levels (Beginner, Advanced) instead of a separate list above the sessions. Only sessions of a defined type show a badge, so one-off tags like Check-in or Ceremony no longer appear; a type used by a single session says it doesn't need one. The demo agenda only types its talks and workshops.
- Organizers can stop a person or a team from messaging (Block... in a conversation's header): they can't start or reply to conversations until it's lifted under Manage → Messages → Blocked.
- Asking about a problem now opens the new conversation in Messages right away instead of the announcements channel until a refresh, and "About" on a problem's conversation is a link.
- The announcements channel's bottom bar explains itself, with New announcement... on the right.
- A scanned check-in code stays in the code box when it doesn't check anyone in, so it can be checked or fixed by hand.
- Participants can leave and join teams as often as they like by default; set Teams → Times someone can leave a team to cap it.
- The check-in desk's button says Check in, instead of keeping the last person's name after a scan.
- Your badge is its own home block (Badge), shown while the event has a Check-in window. New in-person events put it at the top of the side column; for an existing event, add it in Customize home. The format presets now only add session types several sessions share (workshops, talks, livestreams, office hours).
- Instance admins can allow password sign-in for anyone in Instance → People; the person sets their own password in Account → Security, and turning it off clears it and signs them out everywhere. Admins' own passwords (Account → Security) now actually work: the database used to throw every password away. Admin grants and password changes are listed under Instance → People → Changes.
- Instance → Organizations: Hostnames... lists an organization's hostnames, adds them and now removes them too (the next one becomes primary when the primary goes). Limits is its own page, the status button says Restrict... for an active organization, and right-clicking Open site lists every hostname to open.
- Account → Security shows where you're signed in and can sign out everywhere. Signing out one device or every other one is off by default, because a stolen session could use it to keep the real person out; set `security: { deviceSignOut: true }` in `bogey.config.ts` to allow it.
- The emails that carry a sign-in code or link (sign-in, sign-up, invitation, email change, reauthentication) are now set only in `bogey.config.ts` under `email.authTemplates`, so an admin account can't point everyone's sign-in links somewhere else. They no longer appear in Instance or organization email settings.
- Manage → People lists the event's people in a table: check people (or all of them) to set their role or division, check them in, or remove them at once. Role changes and removal skip you.
- Events can set the words before the submission countdown in the header (Manage → Agenda → What participants see → Countdown label). Tablets and computers show them; phones show only the time.
- Programming contests:
  - Code golf is scored by total length by default (problems solved, then the fewest characters), and the leaderboard shows it. A new **Length ranges** score gives points for each range of lengths, set per problem in the jury editor. Events that kept the old default ("in proportion") switch to total length; pick **In proportion** again to keep it.
  - **Run** uses the code as it is now: Python starts from a fresh namespace each run, so names from earlier versions no longer linger. Errors show only the lines from the participant's code, with a checkbox for the runner's lines.
  - **Show error messages** (Solving settings, on by default): off, judged solutions only say that they errored or didn't compile.
  - Each problem has a type: **Pass/fail**, **Partial credit** or **Shortest code**, shown on the problem list, the problem page and its details. One contest can mix them: the contest's scoring now only says how the scoreboard ranks, and each problem's type says what a solution to it is worth. Existing problems take the type of their contest's scoring; problem packages read and write `type: scoring`.
  - Problems live at `/problems` and `/problems/<problem>`, so the Problems link stays highlighted on a problem; old addresses redirect.
  - **Languages** is picked from a list of the instance's languages, and a new **Code editor** section turns autocomplete and line wrapping on or off for the contest.
  - A problem's details show when the contest starts and ends, with the exact time and how far off it is.
  - A problem's page no longer has Public and Jury tabs: the jury gets a **Jury view** button where the scoreboard link was, and the editor links back.

### Upgrade notes

- Adds the `session_announcements`, `rubrics_and_deliberation`, `about_for_members`, `clear_event_data`, `session_levels`, `chat_blocks`, `limit_wording`, `unlimited_team_leaves`, `password_logins` and `device_sign_out` migrations; `bogey upgrade` applies them.
- Wording you set in the app for the sign-in, sign-up, invitation, email change or reauthentication emails is ignored from now on, and Bogey's default wording is used. To keep yours, copy it into `email.authTemplates` in `bogey.config.ts` (see docs/configuration.md) and restart.
- The bundled `challenges` plugin adds the `2_golf_ranges_and_errors` and `3_problem_types` migrations; `bogey upgrade` applies them. The runner needs no update.
- `about_for_members` puts each event's old About in front of its For participants text. Events that only had About stay public (Before approval → About is set to share it); events that had both start members-only, so check those if part of About should stay public and move that part to a Text block. A homepage's For participants block becomes About, or is removed when the page already has one. `events.description_md` is dropped.

## 2.1.3 (2026-10-16)

- Passkeys work as a second factor next to an authenticator app (Account → Security), including for instance admins. The all-in-one turns them on for `BOGEY_HOST`; other setups set `BOGEY_PASSKEY_HOST` and GoTrue's WebAuthn settings (see docs/self-hosting/auth.md).
- Org admins can delete an event from its new Manage → Danger zone page, which also has Unpublish. Deleting asks for the event's web address, removes its files and is kept in the org's audit log. Set `events: { uiDeletion: false }` in `bogey.config.ts` to turn it off.
- The favicon comes from `brand.icons` in `bogey.config.ts`.
- `bogey event list`, `bogey event visibility` and `bogey event delete` manage events from the CLI, and the interactive menu has an Events section. `bogey event delete` works even with `events.uiDeletion: false`.
- `bogey org init` no longer makes a second "first" organization (which also took over the default org) on an instance that already has one; it points you to `bogey org create`. The menu hides it once there's an org, and only asks to go back to the menu after help.
- Organization limits now hold for everyone: platform admins, copying an event and the CLI can't go past them anymore. Promoting a member to admin, turning someone into a participant and reopening an invite link count too. To let one organization go further, raise its limit under Instance → Organizations.

### Upgrade notes

- Adds the `limits_for_everyone` and `event_deletion` migrations; `bogey upgrade` applies them.
- For passkeys, all-in-one: replace `compose.yml` with this release's. Self-hosted Supabase: copy the new `docker-compose.bogey.yml` overlay and set `BOGEY_PASSKEY_HOST` in both `.env` files.

## 2.1.2 (2026-10-15)

- Fixed the all-in-one `auth` service exiting at startup (`only localhost, 127.0.0.1, and ::1 are supported with http`): GoTrue refuses plain-http hook URLs to other hosts, so the Send Email hook now calls `web` through the `host.docker.internal` alias. Replace `compose.yml` with the one from this release's `bogey-all-in-one` tarball.

### Upgrade notes

- No database changes. Only the example fallback email templates in `supabase/templates` were regenerated (they now say "Example Organization"); instances using the Send Email hook aren't affected.
- All-in-one: replace `compose.yml` with the one from `bogey-all-in-one-<version>.tar.gz`, then `docker compose up -d`.

## 2.1.1 (2026-10-15)

- Fixed the all-in-one `compose.yml` failing to load (`services.realtime.healthcheck.test.1 must be a string`): the Realtime healthcheck is now quoted. Run `bogey setup --all-in-one` again (from the new image) to get the fixed file; your `.env` and secrets are kept.
- `bogey setup --all-in-one` run from the image no longer tells you to `cd /out`; it says to run `docker compose up -d` in the folder you mounted.

## 2.1.0 (2026-10-15)

- `bogey release sync <tag>` compares a GitHub release's notes with that version's section in `CHANGELOG.md` and, after showing the difference, overwrites them (`--yes` skips the question).
- Plugins can put a captcha on the sign-in forms with the new `authCaptcha` slot. The `captcha` plugin adds Cloudflare Turnstile or hCaptcha; Supabase Auth checks the token, so turn on its captcha protection after the plugin is set up. Check it out at [0xethen/bogeyx](https://github.com/0xethen/bogeyx)
- The Bogey Plugins repo ([0xethen/bogeyx](https://github.com/0xethen/bogeyx)) is now a Vite+ project, making it easier to link it directly in your project and getting rid of duplicate dependencies. Also some miscellanious changes to plugins
- Added Learn more links in the webui directly to the Bogey Wiki (0xethen/bogey/wiki) instead of referencing local files (like "See `docs/plugins.md`").
- Bogey now tells you when the version you run has a known security issue. Fixes are published as [GitHub security advisories](https://github.com/0xethen/bogey/security/advisories) that name the affected versions; while yours is one of them, instance admins see a banner on every page (they can dismiss it until another advisory comes out), `bogey doctor` reports it as an issue, and the operator console shows it next to the version. `bogey doctor` and the console also say when a newer release is out, with a link to its notes. See [Knowing when to upgrade](https://github.com/0xethen/bogey/wiki/self-hosting-upgrading#knowing-when-to-upgrade).
- Instance → Overview counts a release as newer than its own release candidates (2.1.0 is newer than 2.1.0-rc.1), and links to the upgrade guide instead of only naming `bogey upgrade`.
- After a release, `bogey db baseline` regenerates the setting defaults and notification kinds in `supabase/schemas` again (it used to refuse outright, so changes to `settings.ts` couldn't be regenerated), leaves the shipped baseline alone, and explains why the change belongs in a migration with a link to the docs. `--check` no longer expects the frozen baseline to match `supabase/schemas`.
- Fixed code scanning findings. Plugin versions, email addresses and Markdown excerpts are now checked with patterns that can't be made to run slowly by crafted input, and calendar exports escape `;` as RFC 5545 asks (event titles and locations with a semicolon were not escaped before). SQL strings and generated docs tables now escape backslashes too.

- The settings that decide who the database trusts now come from `bogey.config.ts`, not the app: `appUrl` (where the database calls the app to send queued email), `network` (the trusted proxies, hops and client IP header) and `security.requireAdminMfa`. Admins see them read-only, and the database refuses changes to them from any session, so a stolen admin session can't spoof visitor addresses, point the database's requests elsewhere, or turn off the admin second factor. See [Keys only the file sets](https://github.com/0xethen/bogey/wiki/configuration#keys-only-the-file-sets) and ADR 0029.
- New `bogey config check` and `bogey config apply` (also in the operator console). `bogey doctor --remote` reports when the database differs from the file.
- `security.headers` in `bogey.config.ts` sets the response headers: `frame-ancestors` (same origin by default), opt-in HSTS and an optional Content-Security-Policy. `X-Content-Type-Options: nosniff` and `Referrer-Policy` are always sent.
- `network.trustProxy` in `bogey.config.ts` does what `BOGEY_TRUST_PROXY=1` does; the variable still works.
- Anonymous visitors can no longer read the instance's network, tenancy and limits settings.
- The instance's name is no longer copied from the checkout's `bogey.config.ts` into the database's setting defaults, so an instance on the published image uses its own `brand.name` everywhere.

### Upgrade notes

- Run `bogey db migrate` (or `bogey upgrade`) for the `operator_keys` migration.
- Values you set in the app for these keys stay. To change them from now on, set them in `bogey.config.ts` and restart, or run `bogey config apply`. If every admin is locked out, `bogey mfa off` still works.

## 2.0.0 (2026-10-14)

Welcome to Bogey 2! We're out of alpha: Hackathons that run properly and are installable in one sitting, contests that actually judge, and try other formats and features with plugins.

> If you're curious, [this](https://github.com/hackgwinnett/bogey-flask) was "v1", a project scoring tool and Bogey's namesake/inspiration.

### Highlights

- **One install.** `bogey setup --all-in-one` and `docker compose up -d` run Bogey with Supabase and Caddy on one server; the image carries the `bogey` CLI. Supabase Cloud and your own Supabase are documented paths too.
- **A whole event.** Prizes teams enter, rounds that advance finalists, awards and a full-screen reveal, a popular vote, expo tables with offline scoring, fairness tools, check-in with badges, a waitlist, certificates, exports, copies and templates, and event archives.
- **Contests that judge.** The challenges plugin now ships with Bogey: a Docker runner, ICPC/IOI/golf scoring, Kattis problem packages and the Contest API export; lockdown adds a companion extension and Safe Exam Browser checks.
- **Teams that form themselves.** A team board on the Team page, and a matcher in Manage → Teams for everyone left over.
- **More formats as plugins.** Machine-learning leaderboards; Extra Judging (Gavel-style pairwise, game-jam peer rating, ranked ballots and a points budget); Discord, GitHub and Spanish.
- **Open by default.** A read-only API, calendar and news feeds, webhooks, public profiles, and sign-in with Google, GitHub, Microsoft, GitLab, Discord, Keycloak or company single sign-on.

### Hackathons

- Manage → Security holds the event's network limits and the security settings plugins bring (Lockdown's, for one).
- ⌘K lists every conversation you can see in the event, and Announcements.
- Prizes: a Manage page for them with sponsors, logos and winner counts; teams enter prizes from their submission (optionally capped), and they show on the event home, a Prizes page, and as a filter in the judges' queue.
- Team board: people without a team say what they're good at, teams say who they need, and they ask or invite each other; captains and invited people answer, and everyone hears by notification. Manage → Teams → **Match teams...** proposes teams for everyone left over (spreading skills, keeping divisions and time zones together) and applies them in one audited step. On by default (`teams.board`); it was the `team-matching` plugin.
- Awards: propose them from the ranking, add special ones, publish them with the results, and present them one by one, full screen. `judging.showRankings` decides whether participants also see the ranking (organizers only by default). The first publication notifies everyone.
- Judging rounds: advance the best entries into a final, with scores, judges, criteria and an optional window per round; finalists are notified.
- Expo judging: number the tables, print the list, judges see them in order with a Next button and can set an absent team aside, and scores saved while offline are sent when the connection returns.
- Fairness: even out harsh and generous judges, declare conflicts (judges or organizers, singly or from a pasted list), see how each judge scores, and get a warning before publishing entries with too few judges.
- Popular vote: a window, a Vote button on gallery cards and project pages, a cap per person, counts held back until results, and the winner proposed as an award.
- Teams can see judges' shared notes and, if you choose, per-criterion average scores after results are published.
- Check-in is part of Bogey, not a plugin: a desk for staff (scan, search, walk-ins, undo), QR badges on the event home and to print, self check-in with a venue code, a badge email, and an option to require it before competing.
- Certificates: wording per kind, claimed by people or issued to everyone, with a public page that proves each is real; print them all.
- Participant limit with a waitlist: once an event is full, new registrations wait and move in oldest first. Organizers approve or decline many registrations at once with a message.
- Registration questions can be dates, numbers, phone numbers, multiple choice, agreements and file uploads, and can depend on earlier answers (for example, guardian details for anyone under 18).
- Copy an event or save it as a template: dates shift to a new start, and you pick what comes along but never people or entries.
- Exports: registrations (with every answer), members, teams, submissions and their files, scores, results, awards, votes, attendance and the audit log download as CSV or ZIP from the page where the data lives, each recorded in the audit log.
- Event archive: Manage → Details → Download archive... and `bogey event export` / `import` copy an event to another organization or instance as a draft with new ids and moved dates; `--people` brings members, teams, submissions, scores and results too.
- Divisions are managed in Manage → Divisions; participants pick one when they first open the event unless `divisions.askOnJoin` is off.
- Messages is where everyone reads and answers conversations, organizers included; participants can message organizers by default.
- New hackathons start from in-person, online or hybrid settings, or from the defaults. Session types have their own levels.
- Teams can be disbanded by their captain (setting `teams.disband`).

### Notifications and email

- A bell in the menubar and Account → Notifications to choose bell, email or both for each kind.
- Bogey's own email (registration, invitations, deadlines, results) goes out from an outbox the database wakes every minute, with the same sender, layout, per-organization daily limit and one-click unsubscribe. Event organizers edit its wording under Manage → Email. Set Instance → Settings → App address for it to run.
- Messages for team joins, submissions, judge assignments, deadline and session reminders, and announcements with Also email.

### Contests and other formats

- Programming contests: the challenges plugin ships a runner that judges solutions in Docker sandboxes in C, C++, Java, Kotlin, Python, JavaScript, Rust and Go, with exact, token, float and custom checkers and IOI groups. The jury can rejudge as a reviewed set, ignore a solution, require verification and keep solutions with expected verdicts. Problems import from and export to Kattis / ICPC problem packages; the contest downloads in the ICPC Contest API's shape and the scoreboard is public as JSON.
- Lockdown can require a companion Chromium extension or Safe Exam Browser before submissions count.
- Capture the flag is a second event type of the `challenges` plugin (**Capture the flag** in New event), not a plugin of its own.
- `challenges` ships with Bogey (`packages/plugins/bundled/`): nothing to install, and `bogey db migrate` applies its tables. The runner is `tools/runner` and its images publish with each Bogey release.
- Plugin settings and pages can depend on the event: `showWhen` takes a list of conditions, and a route takes `showWhen` to list its tab only for some formats.
- New plugins: `leaderboard`, `extra-judging`, `github` and `i18n`. See `docs/plugins.md`.
- Webhooks post straight to Discord and Slack: a chat message in the service's format, with what people typed escaped. A refused delivery (`4xx`) isn't retried, and scheduled announcements are sent when they go up.
- A contest problem's statement can be a PDF instead of Markdown, and the Markdown one has **Add limits**.
- Organizers give people plugin roles (Challenges' Jury, Lockdown's Proctor) on Manage → People; each change is audited.
- "Extensions" are called plugins everywhere, and their pages moved from `/extensions` to `/plugins`.
- Extra Judging ranks a round four more ways: pairwise comparison (a Bradley-Terry fit of judges' picks, with absent teams and judge agreement), peer rating by participants, ranked ballots (each judge orders what they saw; a Borda count ranks the round) and a points budget (judges spread points like investors). All respect judge conflicts.
- The demo seed adds an IOI contest, a code golf contest and a CTF next to the ICPC one.

### Extending Bogey

- New extension points, all optional (Plugin API stays 1): their own kinds of submission answer, ways to rank a round besides the rubric, session types, server routes at `/api/p/<key>/...`, languages, notifications and emails of their own.
- Plugin libraries: `bogey plugins search`, `bogey plugins add <key>` and `bogey plugins library add github:<owner>/<repo>`.
- A plugin setting can be locked at the instance (for organizations) or at an organization (for its events): the lower levels see it read-only. The Languages plugin uses it for how missing translations show.
- Plugins can add ⌘K links and actions, account menu links, and say what they need (`uses`).
- Plugins can put sections of their settings on Manage's own pages (Security, Judging, Registration and the rest) or on pages of their own (`settingsSections`, `settingsPages`); their row on Plugins keeps the general ones and links to the rest.

### Reach

- Public API (`/api/v1`), agenda and personal calendars, Atom and RSS feeds, `hackathon.json`, and webhooks with retries and a delivery log.
- Profiles: a public page at `/u/<handle>` with a bio, links, shared projects, awards and events.
- Languages: Bogey can be shown in other languages. English ships; plugins bring the rest, starting with Spanish, which covers the whole app: pages, settings, the audit log, notification and email names.
- Email in other languages: people get email in their account's language. Email settings has a language switch for writing each language's version, and the Languages plugin translates Bogey's default wording and the footer (Spanish to start).
- Sign-in providers: Google, GitHub, Microsoft, GitLab, Discord, Keycloak and company single sign-on (SAML); people link and unlink them under Account → Linked sign-ins.

### Running it

<!-- bogey CLI (commenting without ticks for search purposes) -->

- An all-in-one compose (`deploy/all-in-one/`) runs Bogey with the Supabase services it needs and Caddy on one server.
- `bogey.config.ts` is read when the server starts: the name, theme, repository, update checks, security options or disabled plugins take a restart, not a rebuild. Themes, installed plugins and logo files are still part of the build. `bogey doctor` validates the file.
- The image carries the `bogey` CLI and `psql`: `docker compose exec web bogey db migrate`, `org init`, `backup`, `doctor`.
- `bogey console` starts an operator console for the machine only; `bogey queues` shows waiting mail and webhook deliveries.
- `bogey release` cuts a release and now insists on "Upgrade notes" when the database or the plugin API changed.
- Instance admins can cap the size of one upload per organization, and a suspended organization's data is closed to reads in the database.
- An audit log for every event and org, with filters.
- Accessibility: bundled Atkinson Hyperlegible and OpenDyslexic fonts, more contrast, wider text spacing, underlined links and reduced motion.

### Upgrade notes

- **From the 2.0 alpha, reset once.** The database baseline changed throughout and is rebuilt in place until 2.0.0 freezes it: `bogey reset` (it dumps first), then `bogey db migrate` and `bogey plugins migrate`. A fresh install needs nothing special.
- Set Instance → Settings → Tenancy → **App address** so the email outbox and webhooks can call the app.
- Google no longer shows by itself on the sign-in page: add it to the instance's providers after upgrading.
- Plugins need `api: 1` in their manifest, or Bogey skips them. `challenges` ships with Bogey and `bogey db migrate` applies it; drop it from `bogey.plugins.lock` if you installed it before. The SQL for `lockdown` and the other plugins is in the plugins repository; run `bogey plugins migrate`.
- `pairwise`, `peer-rating` and `team-matching` are gone: the first two are `extra-judging` (methods `extra-judging.pairwise` and `extra-judging.peer`), and team matching is part of Bogey.
- The Send Email hook points at `/api/auth/send-email`; check `GOTRUE_HOOK_SEND_EMAIL_URI` (or the hook setting on Supabase Cloud) after upgrading from an older address (see `docs/self-hosting/email.md`).
- Check-in was a parked plugin and Discord posting lived in core; both are replaced (check-in is core, Discord is a plugin). `integrations.discord` is gone.
