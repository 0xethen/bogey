# Running an event

A walkthrough for organizers, from an empty organization to published
results. Everything here is in the app; nothing needs the CLI.

## The timeline

Most events go in this order. Each item points at the section below that explains it.

**Eight weeks out or more**

- Start from last year's event, or a template: [Copy an event](#copy-an-event-or-start-from-a-template).
- Set the dates, [Details](#2-details-and-visibility) and the schedule: [Agenda](#3-agenda).
- Decide the prizes: **Manage → Prizes**. Write the [submission forms](#6-submissions) and judging criteria.
- Open [registration](#4-registration): questions, the participant limit, [minors and guardians](#minors-and-guardians), [email](#email).
- Choose the format's settings and plugins: [Formats](formats.md).

**Two weeks out**

- Review registrations, add [people and teams](#5-people-and-teams), invite judges and staff.
- Declare conflicts for judges ([Fairness](#fairness)) and plan [rounds](#rounds) and expo tables.
- Check the [agenda](#3-agenda) and that every window opens when you mean it to.
- Badges: **Manage → People → Print badges...**, and the check-in email goes out by itself.

**The day**

- [Check-in](#check-in) at the desk; announcements and [messages](#8-talking-to-participants) as things come up.
- [Judging](#7-judging): the queue, tables and offline scoring, a [popular vote](#popular-vote), and the results screen for the ceremony.
- Judges and staff have their own pages: [For judges](for-judges.md), [For staff](for-staff.md). Participants get [For participants](for-participants.md).

**After**

- Publish [results and awards](#7-judging), and open the [gallery](#project-gallery).
- Issue [certificates](#certificates).
- Take the [exports](#exports) you need, and [archive the event](#archive-the-event).

## Roles

- **Org owners and admins** manage the organization: its events, members and
  settings (the **Organization** item in your account menu).
- **Event organizers** manage one event (**Manage** on the event).
- **Judges** score submissions; **participants** register, form teams and
  submit. Judges aren't participants.
- **Platform admins** run the whole instance (**Instance** in the account
  menu) and are usually only you.

## 1. Create the event

**Events → New event** walks through four steps: basics, dates, team sizes,
then a review. Pick a kind:

- **Hackathon:** teams build projects, submit them, and judges score them.
- **Contest:** entrants solve problems, usually with a contest plugin.
- **Custom:** start from nothing.

The kind sets team sizes and a default submission form. With a start and end,
the schedule fills itself in: registration until the start, team changes and
submissions until the end, judging from the end until you close it, and
results and the gallery closed until you open them. The review step shows it in
plain words, and all of it can be changed afterwards. New events start as
drafts that only organizers can see.

## 2. Details and visibility

**Manage → Details**: name, address, dates, timezone, location and the
**About** text on the event home (Markdown, with a preview; `||text||` hides
text until someone clicks it, ⌘| in the editor). About is for members by
default: approved participants and the event's people read it, and applicants
see that there's more once they're in, so the theme, rooms and Wi-Fi can go
there. To share it with anyone who can see the event, change it under
**Before approval** below. For text everyone should see, add a **Text** block
to the homepage. **Visibility** controls who can find it: draft (organizers
only), unlisted (anyone signed in who has the link) or public.

**Manage → Security → Before approval** decides what applicants, the waitlist
and anyone else with the link see: About and the agenda (members only by
default) and tracks and prizes (shown by default). The database enforces it,
not just the page.

### Copy an event, or start from a template

Org admins can start from what already worked. **New event → Start from**, or
**Manage → Details → Duplicate event...**, copies the setup into a draft: pick
a start date and every date moves by the same amount. Choose what comes along:
details, schedule, divisions, tracks and prizes, submission forms, judging
rounds and criteria, the agenda (hosts who belong to your organization join as
staff), pages, the homepage, settings, registration questions and invite links
(new addresses, switched off). People, teams, submissions, scores, votes and
check-ins never copy, and neither do secrets: the page lists their names so you
can enter them again.

**Save as template...** makes a private copy that keeps the original dates. It
shows under Templates on the Events page and in **Start from**.

## 3. Agenda

**Manage → Agenda** holds everything with a time: the sessions people go to,
and the event's **windows**.

### Sessions

The **Agenda** tab shows sessions by day. Add a time slot, then the sessions
in it:

- A slot **for everyone** holds things on everyone's agenda: check-in, the
  opening, lunch, the award ceremony. Mark a session **Required** to count it
  in attendance; it gets a red star, which the Agenda page explains.
- A **choose one** slot holds sessions people sign up for, one per slot, such
  as a round of workshops. Participants see them separated by "or". Set
  **Seats** to cap a session. Sign-ups run while the **Session sign-ups**
  window is open.

Click a session to edit it, and drag it by its handle to reorder it or move it
to another slot. A session can have its own times inside the slot, a location,
hosts (event members with a staff, judge or organizer role) and a **Presented
by** name for hosts without an account. Turn on **Take attendance** and hosts
and staff get a roster and a six-character check-in code to show in the room;
participants enter it on their Agenda page from 30 minutes before the session
until 30 minutes after it. The **Attendance** section shows who missed what and
exports a CSV.

**Session types** (Talk, Workshop, Meal and so on) each have a color and an
icon. Rename them, add your own, or change how they look.

### Windows

**Windows** are registration, team changes, submissions, judging, results and
others. A window is either following its times or forced open or closed, and
it's the only thing that decides what participants can do when; the database
enforces it. Their opening and closing times show on the Agenda tab between
sessions.

Under **What participants see**, choose whether the event home shows what's
open as a list, a full timeline or nothing, and hide windows that would give
something away.

### The event home

**Manage → Homepage** explains the blocks and has a **Customize** button (organizers
also see it on the event home itself). Drag blocks within and between the two
columns, or in from the palette; rename, duplicate or remove them. Besides the
blocks that show what Bogey has (agenda, announcements, next steps, event
facts, About, pages, and any panels plugins offer), you can add your own: text, callouts,
a FAQ, an image, a sponsor grid (upload logos or paste their addresses),
links, a countdown to the start or end, and dividers. The About block also takes
pictures. Changes save from the save bar. The event's pages are listed under the
**Home** tab.

## 4. Registration

**Manage → Registration**:

- **Joining:** who can join (anyone, organizers approve, or invite only) and
  whether first-time visitors go through **identity setup** (confirm their name,
  set up a team).
- **Invite links:** shareable links, optionally auto-approving, with a
  capacity.
- **Onboarding:** what registrants answer, as questions you add one at a time.
  Besides text, choices and checkboxes, a question can be a date, a number, a
  phone number, multiple choice, an agreement people must accept, or a file
  upload. A question can depend on an earlier one, so it only shows for some
  answers.

Who sees the answers: organizers and staff in **Manage → People**. Uploaded files
open from there; only the registrant and people who can see the event's people
can read them.

Who can create an **account** at all is an organization setting
(**Organization → Settings → Accounts**).

### Participant limit and waitlist

Set **Participant limit** under **Joining** to cap how many participants an event takes (0
has no limit). Once that many are approved, new registrations join the **Waitlist** instead
of being approved or queued for review, and are emailed that. When someone withdraws, is
declined or is removed, the person who has waited longest is approved and told, unless you
turn off **Move people up the waitlist**; raising the limit fills the new places the same
way. Organizers can still approve anyone by hand, over the limit.

In **People**, tick several registrations under _Waiting for review_ or _Waitlist_ and choose
**Approve selected...** or **Decline selected...** to review them together, with an optional
message added to the email.

### Minors and guardians

For an event with participants under 18:

1. Add a **Date** question, "Date of birth", and make it required.
2. Add "Guardian's name" (short answer) and "Guardian's email" (email), required, and set
   **Ask this** to _Date of birth_, _when they are younger than 18 years_. Age is counted on the
   first day of the event.
3. Add a **File upload**, "Signed permission form", required, with the same condition.
4. Add an **Agreement** question, "Photo and media consent", with the text you want people to
   accept. Each answer records when it was accepted and a fingerprint of the exact text.

Adults never see the guardian questions, and the database enforces the same rule on submit.

### Email

Registration status, invitations, deadlines and results are emailed by Bogey itself, from a queue
(the outbox) that the app empties every minute. Whoever runs the instance sets `appUrl` in
`bogey.config.ts` so the database can wake the app (see [Email](../self-hosting/email.md)). Each message's wording is under
**Manage → Email**, **Organization → Settings**, and **Instance → Settings**; blank fields use the level
above. People choose what reaches them in **Account → Notifications**; mail about someone's registration
can't be turned off, and every other kind has an unsubscribe link.

Beyond registration, people are told when someone joins their team, when their team submits, and
when judges are assigned projects (one message per run of **Assign judges**). An announcement
with **Also email** reaches its audience's bell and inbox when it goes out, scheduled ones
included. Teams that still only have a draft are reminded
**Manage → Submissions → Reminders** hours before submissions close (24 by default, 0 for none), and people
who signed up for a session are reminded **Manage → Agenda → Reminders** minutes before it starts (30 by
default). Adding people from a roster stays quiet unless you switch on **Email an invitation**.

## 5. People and teams

### Check-in

On the day, staff open the **Check-in** tab (organizers and staff see it). They scan the QR
code on a participant's badge with the camera, type the eight-character code under it, or search
by name or email; each person is checked in with who did it and how, and a mistake is undone
with one click. The tab shows counts by role and division, and a venue code for **Self
check-in** (it changes every ten minutes; put it on a screen and people enter it on the event
home). With **Take walk-ins** on, staff can register someone who isn't on the roster.

Participants see their badge on the event home while the event is on, and are emailed their code
a day before (**Check-in** settings under Manage → Registration). **Manage → People → Print
badges...** prints badges, six to a page or one per page. People lists who has checked in and
filters by it. **Check in before competing** (on by default for in-person events) keeps
participants from changing teams, submitting or voting until they have been checked in.

**Manage → People** is the roster: registrations, members and roles in one
list. Add people in bulk by pasting emails (with optional names, teams, roles
and teammates' emails) or columns from a spreadsheet, with a header like
`email, name, team, role, teammate2, teammate3`. Before anything is added, the
page points out where the roster disagrees with itself: one team name used for
different groups of people (merge them, number the others, or skip those lines),
or someone listed on two teams (pick one, or skip them). The roster also shows
when someone's email is in other events, so duplicates are visible rather than
merged.

**Manage → People → Teams**: rename, lock, move people between teams, or add
people straight to a team.

**Manage → Teams → What teams can do** sets the rules participants can't get
around:

- **Who can start a team**: participants, or organizers only (participants
  then join your teams with their codes).
- **Let people switch teams**: off keeps everyone where they are, disbanding
  included; they're pointed to message the organizers instead.
- **Times someone can leave a team** (2 by default; disbanding counts) stops
  people from leaving and starting team after team.
- Nobody can leave or disband a locked team, or one that has submitted a
  project, without an organizer.

Teammates hear when someone leaves, and captains can make a new invite code
(next to the code on the Team page) so the old one stops working. Organizers
can always move anyone, whatever the rules.

### Finding a team

While teams are open, the **Team** tab has a team board (turn it off under Manage → Teams → **What teams
can do** → **Team board**). People without a team say what they're good at and ask to join teams that are
looking; teams say what they need and invite people. The captain answers requests and the invited person
answers invitations, and both hear about it in the bell (and by email unless they turn it off).

Before the event starts, **Manage → Teams → Match teams...** places everyone still without a team. Pick the
team size to aim for and **Propose teams**: it fills teams that have room first, then makes new ones per
division, spreading skills and keeping time zones close, and lists anyone it can't place. Nothing changes
until **Apply...**, which makes the teams and moves people in one audited step. It uses what people wrote on
the board, so it works best when they've filled it in, but it doesn't need the board to be on.

## 6. Submissions

**Manage → Prizes** lists what teams can win: a name, what it is for, what winners get, an
optional sponsor and logo, how many winners, and whether teams enter it themselves or only
organizers place entries (for a sponsor's pick, say). A prize can apply to one submission form.
Teams choose prizes on their submission page while its form is open; **Most prizes a team can
enter** caps how many. The prizes show on the event home (add the **Prizes** block) and at
`/events/<slug>/prizes`, and judges can filter their queue by prize.

**Manage → Submission forms** defines what teams hand in. An event can have
several forms (a proposal, then a final project), each with its own window
and items: short and long text, Markdown, links, videos, Drive links, files,
choices, checkboxes and numbers. On the same page:

- **Submit complete drafts at close** submits drafts that have every required
  item.
- **Who can delete a submission:** teams delete their own, ask organizers,
  or only organizers.
- **Network** (Manage → Security): limit where participants can take part in the
  event from, like the venue's Wi-Fi, for everyone or only chosen people, teams
  and divisions. See [Network limits](../self-hosting/network.md).

**Manage → Submissions** is the review queue: read answers and files,
disqualify or reinstate, delete, and act on deletion requests.

## 7. Judging

**Manage → Judging**:

1. Add **criteria**, each with a score range (0 to 10 by default) and a
   weight. **Duplicate** copies one as a starting point. For an event with
   several themes, **Add a rubric** per theme ("Health", "Climate") and set
   each theme's criteria to count in it; criteria left on **Every rubric**
   count for every project. See [Rubrics](#rubrics).
2. Turn on **blind judging** if judges shouldn't see team names. Teams are
   asked to keep names out of their answers. For questions that need names,
   like who built what, turn on **May name people** on that submission item:
   judges see those answers only after choosing **Show answer**. Blind judging
   hides names in the app; it doesn't stop a determined judge from finding
   who submitted through the API.
3. **Assign** judges (each submission gets N judges, spread evenly) and watch
   progress.
4. Preview **results**. Under **Awards**, **Propose from rankings** drafts overall
   places (top three per form), each division's winner and the top entries of each
   prize; adjust them, and add special awards ("Best pitch") by picking a project.
5. Choose **Who sees the ranking** (organizers only by default; awards are always
   public), then publish. Participants see the awards, and the ranking if you allowed
   it, once the Results window opens, and each hears about it in the bell and by email;
   winners are told what they won. Publishing again replaces what they see and tells
   no one twice.

At the closing ceremony, **Results → Present** (`/events/<event>/results/present`)
shows one award per press of space, enter or the right arrow, full screen, with
the sponsor's logo. Organizers can rehearse with their draft awards before
publishing. A public event's gallery has a **Slideshow** of its projects too.

Judges score from their own queue while the Judging window is open.

### Fairness

- **Even out harsh and generous judges** (Judging settings): each judge's scores are compared
  within that judge, by their own lowest-to-highest range or by standard deviations from their
  average, before being averaged. The results preview shows the plain score beside it.
- **Conflicts**: pick a judge and a team, or paste `judge email, team name` lines. The judge isn't
  assigned the team, their assignments for it move to other judges, and their scores for it don't
  count (the preview says how many judges were left out). Judges can declare their own with
  **I have a conflict...** on a project; only organizers can lift one.
- **How judges score** lists each judge's average and spread and flags the ones far from the
  rest or who give everything the same mark.
- **Fewest judges per entry**: the results preview warns about entries with fewer before you publish.

### Rubrics

A project is scored on the shared criteria plus its rubric's own. There's one rubric per project,
shared by all its judges and its team, so every project is ranked on what fits it and the totals
stay out of 100.

- **Judges pick the rubric** (on by default): a judge picks or changes it at the top of the score
  sheet. Scores already given for another rubric's criteria are kept but don't count.
- **Teams pick their rubric** (off by default): teams choose on their submission while they can
  still edit it, and judges can still change it unless you turn that off. **What teams see**
  shows them rubric names only, or each rubric's criteria too.
- A project with no rubric picked is ranked on the shared criteria alone. The results preview
  names each project's rubric.

Themes aren't a separate setting: a rubric is the theme.

### Deliberation

A judge can **Flag** a project they want to discuss (a suspected rules issue, a score they
disagree about). While it's flagged, the judges deliberating see each other's scores and notes on
it, post to a discussion on the project's page, change their own scores, and then **Resolve** it
with an optional outcome. Flagged projects are listed at the top of the judges' queue and under
**Manage → Judging → Deliberation**, which keeps the resolved ones too.

- **Who deliberates**: the project's judges (assigned to it or who scored it, the default), every
  judge, or nobody (no flags). Organizers always can, and a judge with a conflict never does.
- **Flag on disagreement**: flags a project on its own, once, when two judges' totals for it are
  more than this many points apart out of 100. 0 (the default) turns it off.
- **Hold results while flagged** (on by default): publishing waits until every flag is resolved.

### Expo tables

For judging in a room, **Manage → Judging → Expo tables** numbers the submitted projects (1, 2, 3
or A1, A2, A3), optionally keeping each division or prize together, and **Print table list...**
prints the map. Teams see their table on their submission and the event home. Judges see it in
their queue, which is in table order; **Next** takes them to the next team, and **Team absent**
sets one aside (it stays at the end, and **Restore** brings it back). If the connection drops
while a judge saves scores, the scores wait on their device ("N scores waiting to send") and go
out when it's back.

### What teams see from judges

**What teams see from judges** (Judging settings) decides, once results are published, whether a team
sees nothing, the notes judges marked to share, or also the average score for each criterion (never who
gave which). They appear under **From the judges** on the team's submission page.

### Popular vote

Under **Manage → Judging → Popular vote** turn voting on and choose who can vote (participants,
everyone in the event, or any account in the organization with a public gallery), how many votes
each person has, and whether teams may vote for themselves. Add the **Popular vote** window on
the Agenda; while it's open, project cards in the gallery and project pages have a **Vote** button.
Counts stay hidden from everyone but organizers until results are published, unless you choose
**Show counts while voting**. The most-voted project is proposed as an award.

### Rounds

Every judged form starts with one round holding every submitted project. To run a
final, open **Manage → Judging → Rounds**, pick a round and **Advance** the top N:
they move into the next round (created for you), their teams are told they're
finalists, and from then on judges see and score them in that round. Scores from
earlier rounds are kept, and each round is ranked on its own scores. Each round can
be renamed and can have a window of its own (say, a Finals window), so judges can
score it only then. **Assign judges** works per round. A criterion can count in
every round or just one. The final awards are proposed from each form's last round.

### Project gallery

When a **public** event's Gallery window opens, `/gallery/<event-slug>` lists
every submitted project whose team turned on **Show in the public gallery**,
with filters by form, track and division. It works signed out and has link
previews for sharing. The event home and Results link to it while it's open.
Disqualified projects never appear, and judges still don't see team names
while judging is blind.

## 8. Talking to participants

- **Announcements** go to everyone, or to any mix of roles, divisions,
  teams and sessions (the people signed up for or placed in a choose-one session,
  and its hosts; a workshop, not lunch), now or at a scheduled time, and show up live, as a feed like a chat
  channel. The announcements channel in Messages has its own box at the bottom
  (a title, the message, files and a tone) that posts to everyone right away;
  **New announcement...** (on the event home, the announcements page, Manage
  and the speakerphone beside that box) picks an audience, schedules or
  notifies. **Post anonymously** shows one as from the organizers; the audit
  log still records who posted it. With **Judges can post** (Manage →
  Announcements), judges post too, always under their own name.
- **Messages** (Manage → Messages) are conversations, and everything is off
  until you turn it on there:
  - **Messages** turns messaging on for the event; the switches under it say who
    can talk to whom.
  - **Organizers and judges** (on by default) can message each other.
  - **Participants and organizers**: participants can message organizers.
  - **Participants and judges** adds judges as a choice, and lets judges
    start a conversation with a team (not while judging is blind); organizers
    still see those conversations.
  - **Include the whole team** (on by default) puts a participant's team in
    their conversations, so teammates can read and reply.

  **Message a team...** starts a conversation with one team: everyone on it
  can read and reply. **Share with everyone** turns a participant's conversation with organizers
  into a public answer when it helps other teams too.

## Certificates

**Manage → Certificates** turns certificates on for the event and sets the wording for each kind: participation (for
people who checked in or submitted), award (for each award a team won, once results are published), judge and volunteer
(staff). The wording is Markdown with `{{name}}`, `{{event}}`, `{{award}}`, `{{date}}` and `{{org}}`; a background picture
and landscape or portrait are chosen per kind. People can claim theirs at `/events/<event>/certificates`, or **Issue all...**
makes everyone's and tells them. Each certificate has a code and a page at `/certificates/<code>` that anyone can open to see
that it is real and print it; **Print all...** prints the whole set and **Withdraw...** revokes one.

## Exports

Every export is a download button where its data lives. Files are CSV (opened
in Excel as UTF-8, with cells that start like a formula escaped) or, for
submission files, a ZIP. They come from your own session, so a file holds what
you can read, and each download is recorded in the audit log.

| Export        | Where                                          | Contents                                                                         |
| ------------- | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| Registrations | Registration → Joining                         | Every answer as a column; uploaded files are links valid for a week              |
| Members       | People                                         | Role, division, team, check-in times                                             |
| Teams         | Teams                                          | Division, members, captain, locked                                               |
| Submissions   | Submissions                                    | One form: team, status, tracks, table, every item                                |
| Files         | Submissions                                    | One form's uploads, one folder per project                                       |
| Scores        | Judging → Results                              | Judge × project × criterion, with the range and the value used after normalizing |
| Results       | Judging → Results                              | The ranking per round and division                                               |
| Awards        | Judging → Results                              | Drafted or published awards with their tracks and prizes                         |
| Votes         | Judging → Popular vote                         | Counts per project, never who voted                                              |
| Attendance    | Agenda                                         | Expected and actual per session                                                  |
| Audit log     | Organization → Audit log, with an event picked | Every logged change in the event                                                 |

## Archive the event

Organization admins can keep the whole event: **Manage → Details → Download archive...** saves a ZIP with a JSON file for each
table and the uploaded files. From a checkout or the image, `bogey event export <org>/<event> --out <folder>` writes the same
folder, and `bogey event import <folder>` makes a new draft event from it, in this instance or another, with new ids and dates
moved by `--starts-at` or `--shift-days`. Without `--people` only the setup comes back; with it, members (accounts are created
for emails without one), teams, submissions, scores, awards, results and check-ins too.

## Danger zone

**Manage → Danger zone** has the clean-ups that can't be undone. Each opens a dialog that says how many people or projects
it touches and asks for the event's web address before it runs, and each is kept in the audit log.

- **Prune participants**: remove the ones who never checked in, aren't on a team, or have no submitted project. Their
  registrations stay, so you can add someone back from People.
- **Decline everyone waiting**: decline every pending and waitlisted registration; each person is told.
- **Reset judging**: delete every score, judge's note, assignment and flag, and send advanced entries back to round 1, for
  example after judges practised. Projects, criteria and published results stay.
- **Remove all participants**: start over after a dry run. Every participant, their registrations, teams, submissions and
  files go; the setup, staff, judges and organizers stay.
- **Delete event** (organization owners and admins): the whole event, after offering to download an archive first.

To hide an event instead, set it back to a draft under **Manage → Security**.

## Webhooks and feeds

Other systems can follow the event. **Manage → Communication → Webhooks** (and **Organization → Settings → Webhooks** for all of
them) sends signed JSON when people register, teams form, projects are submitted, windows change, results publish, announcements
go up or someone checks in. Public events also have a read-only API, an agenda calendar and announcement feeds, and everyone can
subscribe to their own schedule from **Account → Calendar**. See the [API reference](../reference/api.md).

## Audit log

**Organization → Audit log** lists who changed what, newest first: event
details, settings, the schedule, people and roles, teams, forms, criteria,
results, sessions and announcements, in every event and the org itself. Filter
by kind, event, person and dates. It's for org admins; in an event, **Manage →
Audit log** opens it with that event picked. Organizers who aren't org admins
still see refused writes from outside the event's network in Submission forms.

## Defaults for every event

**Organization → Settings → Event defaults** sets where new events start:
joining, identity setup, submission deletion and auto-submit, blind judging and
the schedule display. Each event can change them, and every setting shows
whether it's inherited or set on that page.
