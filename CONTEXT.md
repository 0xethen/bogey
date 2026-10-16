# Bogey glossary

The words Bogey's code, schema and UI use, and what each one means. When a
name in the code disagrees with this file, one of them is wrong; fix it.

## Tenancy

- **Instance**: one deployment of Bogey, meaning one database and one web
  app. A self-hosted instance usually has one org. The hosted instance at
  `bogey.ethen.app` has many.
- **Platform admin**: an operator of the instance. Platform admins create
  orgs and edit instance settings. This is separate from being an org owner.
- **Org** (organization): the tenant, such as a school club, a company or a
  hackathon team. Each org owns its events, members, branding and settings.
  An org is reached through its domain (`acme.bogey.ethen.app`, or a custom
  domain).
- **Org member**: a user who belongs to an org, with the role `owner`,
  `admin` or `member`. Org owners and admins manage every event in the org.
  Event staff, judges and organizers become org members; participants don't,
  so taking part in one event shows nothing of the org's others.

## Events

- **Event**: one competition, such as a hackathon, a programming contest or
  a class assignment. Its `kind` (`hackathon`, `contest` or `custom`)
  decides which defaults, windows and plugins it starts with. The kind
  doesn't limit what the event can do later.
- **Window**: a named time span in which something is allowed, such as
  `registration`, `submissions`, `judging` or `challenges.contest`. A window
  opens and closes on a schedule, and an organizer can force it open or
  closed. Windows are the only thing the database checks for "is this
  allowed right now". (Earlier versions called them _gates_.)
- **Stage**: the label shown for where an event currently is, for example
  "Build time" or "Judging". It is worked out from which windows are open,
  and never stored. "Advance to judging" is a preset that changes several
  windows at once.
- **Division**: the bracket that an entry competes in, for example "Middle
  school" or "AI track". It has nothing to do with session categories. A
  division is _selectable_ (participants may pick it) and _switchable_
  (participants in it may move out); otherwise only organizers place people.
  A team competes in one division, its members' own.
- **Vote**: a person's pick in the popular vote, for one project. See `voting.*` settings.
- **Conflict**: a judge barred from scoring a team. The judge isn't assigned it and their scores
  for it don't count.
- **Table**: where a team sits at an expo (`submissions.table_label`), numbered by organizers.
- **Round**: one stage of judging a form. Round 1 holds every submitted entry; entries
  advanced from it make up round 2, and so on. Each round is scored and ranked on its own.
- **Award**: a prize given to a project at the end: "1st place", "Best data", "Best pitch".
  Organizers draft awards (proposed from the ranking, or special) and publishing snapshots them.
- **Prize**: what a track is called in the UI: a name, what winning it gets, and
  an optional sponsor. See _Track_.
- **Track**: a prize category that a submission opts into, for example
  "Best use of AI". A submission can enter several tracks, but belongs to
  only one division.
- **Page**: organizer-written content, such as instructions, rules or
  resources. A page can be hidden until a window opens. (Earlier versions
  called the gated brief the _theme_.)
- **Session**: one thing on an event's agenda, such as a talk, a workshop or
  lunch. Sessions sit in **slots**: a slot is either for everyone (on everyone's
  agenda) or choose-one (people sign up for one session in it, during the
  `sessions` window). **Session categories** are a session type's levels: a
  Workshop can have Beginner, Advanced and Masterclass while a Talk has none. **Hosts** take attendance, by roster or with a
  check-in code shown in the room. (Earlier versions called these _subevents_.)
- **Event member**: a user with a role in one event: `participant`,
  `staff`, `judge` or `organizer`. Judges are not participants.
- **Registration**: a request to take part in an event. It can come from an
  import, an invite link, self-signup or a direct invite. A registration is
  `pending`, `approved`, `rejected` or `withdrawn`. When it is approved and
  the email address has an account, it becomes an event member.
- **Team**: the unit that competes. Every participant who competes is on
  exactly one team per event. A solo competitor is a team of one, created
  for them automatically.
- **Team board**: where participants without a team describe themselves and teams say who they need,
  then ask or invite each other; the captain or the invited person answers. On the Team page while teams
  are open (setting `teams.board`). **Match teams** (Manage → Teams) proposes teams for everyone left
  over and applies them in one step.
- **Registration question**: one thing the onboarding form asks. It has a type
  (text, choice, date, number, agreement, file and more) and may show only for
  some answers to an earlier question.
- **Entrant**: another word for a team when it is being scored, for example
  on a scoreboard.
- **Permission**: a named capability, such as `event.manage` or
  `judging.score`. Roles grant permissions, and plugins can add roles that
  grant plugin permissions. The database checks permissions; the UI only
  reflects them.

## Notifications

- **Check-in**: marking that a person has arrived. Staff do it at the check-in desk by
  scanning or typing the code on the person's badge, by searching, or for a walk-in; a person
  can do it themselves with the venue code. Organizers can require it before participants
  compete.
- **Template**: an event kept as a private pattern. New events start from it by copying its
  setup (`clone_event`); it holds no people, teams or entries.
- **Export**: a CSV or ZIP of one kind of event data, downloaded from the page that shows it
  and read with the downloader's own access. Each download is audited as `export.downloaded`.
- **Badge**: a person's check-in code, shown as a QR code on the event home and printable.
  The code is eight characters and is the same for the whole event.
- **Notification**: a message to one person, shown in the bell. Each has a
  kind (`registration.approved`, or `<plugin>.<kind>`), a title, an optional
  Markdown body and a link inside the app. Whether it also becomes an email
  follows the kind's default and the person's choice in Account → Notifications.
- **Outbox**: the queue of Bogey's own email. Rows wait there until the app,
  woken by the database every minute, renders and sends them. Sign-in mail
  doesn't use it; it goes straight through the Send Email hook.
- **Webhook**: an address Bogey calls with signed JSON when something happens in an organization or one
  event (someone registers, a project is submitted, results publish). Each try is a delivery in a log, retried
  a few times. See the API reference.
- **Certificate**: a document handed to a person for taking part, winning an award, judging or helping,
  with a code and a public page (`/certificates/<code>`) that proves it is real. Its wording is a template.
- **Ranking provider**: a plugin's way of ranking a round besides the rubric (pairwise comparison, peer
  ratings, ranked ballots and a points budget from `extra-judging`, a leaderboard). It writes one score per entry; Bogey does the ranking, advancing and publishing.
  A round's **method** says which one it uses.
- **Portfolio**: a person's page at `/u/<handle>`: their shared projects, awards and events, visible to
  their organizations or to anyone, as they choose.
- **Archive**: a whole event written down as files (a JSON file per table and the uploads) that can be kept or
  restored as a new draft event, here or in another instance.
- **Language**: the locale Bogey is shown in. English ships with Bogey; others come from plugins as
  message catalogs, and anything untranslated shows in English.

## Hackathons

- **Submission**: a team's project entry, with fixed fields plus the
  event's custom **submission fields**.
- **Criterion**: one thing judges score, with a maximum and a weight.
- **Rubric**: a named set of criteria for one kind of project, such as a theme ("Health"). A project is
  scored on the shared criteria plus its one rubric's, picked by its judges or its team.
- **Flag**: a project marked for judges to discuss, by a judge or on its own when judges' totals are far
  apart. While it's open the project is in **deliberation**: its judges see each other's scores and
  notes on it until one of them resolves it.
- **Assignment**: one judge paired with one submission to review.
- **Results**: a published snapshot of the rankings. It stays fixed once
  published, even if scores change afterwards.

## Contests (the challenges plugin)

- **Problem**: one task in a contest, with a label (A, B, ...), a statement,
  limits and test cases.
- **Test case**: an input and the expected answer. **Samples** are the ones
  participants can see.
- **Language**: an entry in the instance catalog with the compile and run
  commands and the runner image.
- **Solution**: a participant's source code sent for a problem. (DOMjudge
  calls this a _submission_; Bogey uses "solution" so it isn't confused
  with hackathon submissions.)
- **Judging**: one run of a solution against the test cases, done by the
  runner. A solution can be judged more than once (a rejudge). Only the
  latest _valid_ judging counts.
- **Verdict**: the result of a judging:
  - `AC`: accepted
  - `WA`: wrong answer
  - `TLE`: time limit exceeded
  - `MLE`: memory limit exceeded
  - `RE`: runtime error
  - `CE`: compile error
  - `OLE`: output limit exceeded
  - `JE`: judge error (Bogey's fault, never the participant's)
- **Runner**: the separate process that runs participants' code in
  sandboxes and records judgings.
- **Scoreboard**: standings calculated from verdicts. **Freeze** hides
  results submitted after a set time from the public board until the
  organizers unfreeze it.
- **Conversation** (stored as a clarification; **Messages** in the app): a
  thread between a participant (and their team) and the organizers or judges,
  or among organizers and judges. Off unless the event's `chat` settings allow
  it. Organizers can share an answer with everyone.

## Integrity

- **Lockdown**: in-page contest monitoring, optionally paired with the
  **companion extension**. It discourages cheating and keeps a record, but it
  is never proof. Anything that must hold is enforced on the server.
- **Audit log**: an append-only record of who did what, in which org and
  event.

## Configuration

- **Setting**: a typed value in a namespace such as `branding`,
  `registration` or `challenges`. A setting is stored at the instance, org
  or event level, and the more specific level wins unless a higher level has
  locked the key.
- **Secret**: a setting that can be written but never read back, such as a
  webhook URL, an SMTP password or an OAuth secret. Secrets are stored in
  Supabase Vault.
- **Plugin**: optional functionality in
  `packages/plugins/installed/<key>/`, or in `packages/plugins/bundled/<key>/` for a **bundled plugin**
  that ships with Bogey (`challenges`): tracked in git, versioned with Bogey, its SQL applied by
  `bogey db migrate`, and still off until an org or event turns it on. It targets a plugin API version, and
  Bogey skips it when that version isn't supported.
  Whether it can run at all is decided in three places:
  - the file allowlist (`bogey.config.ts`) decides whether its code is
    trusted on this instance
  - the org's settings decide whether the org can use it
  - the event's settings decide whether it is on for that event
