# Changelog

<!-- Welcome to the Bogey Changelog! -->
<!-- What changed in each release, newest first. `bogey upgrade` prints the entries
an upgrade brings in, so write them for whoever runs an instance: what they'll
notice, and anything they have to do under **Upgrade notes**. A release that fixes
a vulnerability has a `### Security` section naming the affected versions and the
advisory (see docs/contributing.md#security-releases). -->
<!-- This file is also used on the Releases page. -->

## Unreleased

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
