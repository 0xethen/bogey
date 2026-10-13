# Changelog

<!-- What changed in each release, newest first. `bogey upgrade` prints the entries
an upgrade brings in, so write them for whoever runs an instance: what they'll
notice, and anything they have to do under **Upgrade notes**.
This means you fork maintainers... I'm watching you! -->

## Unreleased

Bogey 2.0 is the first release: hackathons run properly and installable in one sitting, contests that actually judge, and the
other formats as plugins. This is the draft of its notes.

### Highlights

<!-- bogey CLI (commenting without ticks for search purposes) -->

- **One install.** `bogey setup --all-in-one` and `docker compose up -d` run Bogey with Supabase and Caddy on one server; the image carries the `bogey` CLI. Supabase Cloud and your own Supabase are documented paths too.
- **A whole event.** Prizes teams enter, rounds that advance finalists, awards and a full-screen reveal, a popular vote, expo
  tables with offline scoring, fairness tools, check-in with badges, a waitlist, certificates, exports, copies and templates,
  and event archives.
- **Contests that judge.** The challenges plugin now ships with Bogey: a Docker runner, ICPC/IOI/golf scoring, Kattis problem packages and the
  Contest API export; lockdown adds a companion extension and Safe Exam Browser checks.
- **Teams that form themselves.** A team board on the Team page, and a matcher in Manage → Teams for everyone left over.
- **More formats as plugins.** Machine-learning leaderboards; Extra Judging (Gavel-style pairwise, game-jam peer rating, ranked
  ballots and a points budget); Discord, GitHub and Spanish.
- **Open by default.** A read-only API, calendar and news feeds, webhooks, public profiles, and sign-in with Google, GitHub,
  Microsoft, GitLab, Discord, Keycloak or company single sign-on.

### Hackathons

- Manage → Security holds the event's network limits and the security settings plugins bring (Lockdown's, for one).
- ⌘K lists every conversation you can see in the event, and Announcements.
- Prizes: a Manage page for them with sponsors, logos and winner counts; teams enter prizes from their submission (optionally capped),
  and they show on the event home, a Prizes page, and as a filter in the judges' queue.
- Team board: people without a team say what they're good at, teams say who they need, and they ask or invite each other; captains
  and invited people answer, and everyone hears by notification. Manage → Teams → **Match teams...** proposes teams for everyone left
  over (spreading skills, keeping divisions and time zones together) and applies them in one audited step. On by default
  (`teams.board`); it was the `team-matching` plugin.
- Awards: propose them from the ranking, add special ones, publish them with the results, and present them one by one, full screen.
  `judging.showRankings` decides whether participants also see the ranking (organizers only by default). The first publication
  notifies everyone.
- Judging rounds: advance the best entries into a final, with scores, judges, criteria and an optional window per round; finalists are notified.
- Expo judging: number the tables, print the list, judges see them in order with a Next button and can set an absent team aside, and
  scores saved while offline are sent when the connection returns.
- Fairness: even out harsh and generous judges, declare conflicts (judges or organizers, singly or from a pasted list), see how each
  judge scores, and get a warning before publishing entries with too few judges.
- Popular vote: a window, a Vote button on gallery cards and project pages, a cap per person, counts held back until results, and the
  winner proposed as an award.
- Teams can see judges' shared notes and, if you choose, per-criterion average scores after results are published.
- Check-in is part of Bogey, not a plugin: a desk for staff (scan, search, walk-ins, undo), QR badges on the event home and to print,
  self check-in with a venue code, a badge email, and an option to require it before competing.
- Certificates: wording per kind, claimed by people or issued to everyone, with a public page that proves each is real; print them all.
- Participant limit with a waitlist: once an event is full, new registrations wait and move in oldest first. Organizers approve or
  decline many registrations at once with a message.
- Registration questions can be dates, numbers, phone numbers, multiple choice, agreements and file uploads, and can depend on earlier
  answers (for example, guardian details for anyone under 18).
- Copy an event or save it as a template: dates shift to a new start, and you pick what comes along but never people or entries.
- Exports: registrations (with every answer), members, teams, submissions and their files, scores, results, awards, votes, attendance
  and the audit log download as CSV or ZIP from the page where the data lives, each recorded in the audit log.
- Event archive: Manage → Details → Download archive... and `bogey event export` / `import` copy an event to another organization or
  instance as a draft with new ids and moved dates; `--people` brings members, teams, submissions, scores and results too.
- Divisions are managed in Manage → Divisions; participants pick one when they first open the event unless `divisions.askOnJoin` is off.
- Messages is where everyone reads and answers conversations, organizers included; participants can message organizers by default.
- New hackathons start from in-person, online or hybrid settings, or from the defaults. Session types have their own levels.
- Teams can be disbanded by their captain (setting `teams.disband`).

### Notifications and email

- A bell in the menubar and Account → Notifications to choose bell, email or both for each kind.
- Bogey's own email (registration, invitations, deadlines, results) goes out from an outbox the database wakes every minute, with the
  same sender, layout, per-organization daily limit and one-click unsubscribe. Event organizers edit its wording under Manage → Email.
  Set Instance → Settings → App address for it to run.
- Messages for team joins, submissions, judge assignments, deadline and session reminders, and announcements with Also email.

### Contests and other formats

- Programming contests: the challenges plugin ships a runner that judges solutions in Docker sandboxes in C, C++, Java, Kotlin,
  Python, JavaScript, Rust and Go, with exact, token, float and custom checkers and IOI groups. The jury can rejudge as a reviewed set,
  ignore a solution, require verification and keep solutions with expected verdicts. Problems import from and export to Kattis / ICPC
  problem packages; the contest downloads in the ICPC Contest API's shape and the scoreboard is public as JSON.
- Lockdown can require a companion Chromium extension or Safe Exam Browser before submissions count.
- Capture the flag is a second event type of the `challenges` plugin (**Capture the flag** in New event), not a plugin of its own.
- `challenges` ships with Bogey (`packages/plugins/bundled/`): nothing to install, and `bogey db migrate` applies its tables. The runner
  is `tools/runner` and its images publish with each Bogey release.
- Plugin settings and pages can depend on the event: `showWhen` takes a list of conditions, and a route takes `showWhen` to list its tab only for some formats.
- New plugins: `leaderboard`, `extra-judging`, `github` and `i18n`. See `docs/plugins.md`.
- Webhooks post straight to Discord and Slack: a chat message in the service's format, with what people typed escaped.
  A refused delivery (`4xx`) isn't retried, and scheduled announcements are sent when they go up.
- A contest problem's statement can be a PDF instead of Markdown, and the Markdown one has **Add limits**.
- Organizers give people plugin roles (Challenges' Jury, Lockdown's Proctor) on Manage → People; each change is audited.
- "Extensions" are called plugins everywhere, and their pages moved from `/extensions` to `/plugins`.
- Extra Judging ranks a round four more ways: pairwise comparison (a Bradley-Terry fit of judges' picks, with absent teams and judge
  agreement), peer rating by participants, ranked ballots (each judge orders what they saw; a Borda count ranks the round) and a points
  budget (judges spread points like investors). All respect judge conflicts.
- The demo seed adds an IOI contest, a code golf contest and a CTF next to the ICPC one.

### Extending Bogey

- New extension points, all optional (Plugin API stays 1): their own kinds of submission answer, ways to rank a round besides the
  rubric, session types, server routes at `/api/p/<key>/...`, languages, notifications and emails of their own.
- Plugin libraries: `bogey plugins search`, `bogey plugins add <key>` and `bogey plugins library add github:<owner>/<repo>`.
- A plugin setting can be locked at the instance (for organizations) or at an organization (for its events): the lower levels see it read-only. The Languages plugin uses it for how missing translations show.
- Plugins can add ⌘K links and actions, account menu links, and say what they need (`uses`).
- Plugins can put sections of their settings on Manage's own pages (Security, Judging, Registration and the rest) or on
  pages of their own (`settingsSections`, `settingsPages`); their row on Plugins keeps the general ones and links to the rest.

### Reach

- Public API (`/api/v1`), agenda and personal calendars, Atom and RSS feeds, `hackathon.json`, and webhooks with retries and a delivery log.
- Profiles: a public page at `/u/<handle>` with a bio, links, shared projects, awards and events.
- Languages: Bogey can be shown in other languages. English ships; plugins bring the rest, starting with Spanish, which covers the
  whole app: pages, settings, the audit log, notification and email names.
- Email in other languages: people get email in their account's language. Email settings has a language switch for writing each
  language's version, and the Languages plugin translates Bogey's default wording and the footer (Spanish to start).
- Sign-in providers: Google, GitHub, Microsoft, GitLab, Discord, Keycloak and company single sign-on (SAML); people link and unlink them
  under Account → Linked sign-ins.

### Running it

<!-- bogey CLI (commenting without ticks for search purposes) -->

- An all-in-one compose (`deploy/all-in-one/`) runs Bogey with the Supabase services it needs and Caddy on one server.
- `bogey.config.ts` is read when the server starts: the name, theme, repository, update checks, security options or disabled plugins take a
  restart, not a rebuild. Themes, installed plugins and logo files are still part of the build. `bogey doctor` validates the file.
- The image carries the `bogey` CLI and `psql`: `docker compose exec web bogey db migrate`, `org init`, `backup`, `doctor`.
- `bogey console` starts an operator console for the machine only; `bogey queues` shows waiting mail and webhook deliveries.
- `bogey release` cuts a release and now insists on "Upgrade notes" when the database or the plugin API changed.
- Instance admins can cap the size of one upload per organization, and a suspended organization's data is closed to reads in the database.
- An audit log for every event and org, with filters.
- Accessibility: bundled Atkinson Hyperlegible and OpenDyslexic fonts, more contrast, wider text spacing, underlined links and reduced motion.
- Apache-2.0 replaces the Unlicense.

### Upgrade notes

- **From the 2.0 alpha, reset once.** The database baseline changed throughout and is rebuilt in place until 2.0.0 freezes it:
  `bogey reset` (it dumps first), then `bogey db migrate` and `bogey plugins migrate`. A fresh install needs nothing special.
- Set Instance → Settings → Tenancy → **App address** so the email outbox and webhooks can call the app.
- Google no longer shows by itself on the sign-in page: add it to the instance's providers after upgrading.
- Plugins need `api: 1` in their manifest, or Bogey skips them. `challenges` ships with Bogey and `bogey db migrate` applies it; drop
  it from `bogey.plugins.lock` if you installed it before. The SQL for `lockdown` and the other plugins is in the plugins repository;
  run `bogey plugins migrate`.
- `pairwise`, `peer-rating` and `team-matching` are gone: the first two are `extra-judging` (methods `extra-judging.pairwise` and
  `extra-judging.peer`), and team matching is part of Bogey.
- The Send Email hook points at `/api/auth/send-email`; check `GOTRUE_HOOK_SEND_EMAIL_URI` (or the hook setting on Supabase Cloud) after
  upgrading from an older address (see `docs/self-hosting/email.md`).
- Check-in was a parked plugin and Discord posting lived in core; both are replaced (check-in is core, Discord is a plugin).
  `integrations.discord` is gone.
