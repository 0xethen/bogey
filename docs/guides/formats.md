# Formats

Bogey runs more than one kind of event. Each section below is a setup that works: what to turn on, which plugins to
install, and what to watch for. Settings are in [the reference](../reference/settings.md); plugins come from
`bogey plugins add <key>` (see [Plugins](../plugins.md#first-party-plugins)).

Every format starts from **Events → New event**, or from a template you saved (see [Running an event](running-an-event.md)).
The **Format** setting (in-person, online, hybrid) under Manage → Details starts you off with sensible defaults.

## In-person student hackathon

- **Registration**: review mode, the participant limit and waitlist, and the [minors and guardians](running-an-event.md#minors-and-guardians)
  questions (date of birth, guardian, a signed form, photo consent).
- **Check-in**: on, with **Check in before competing**, badges printed and the badge email. Staff use the Check-in tab.
- **Teams**: size 2 to 4, with divisions for school level if you want separate awards.
- **Judging**: rubric with blind judging off; for a big expo add **Expo tables** and judge by table. Normalize with **min-max** if
  judges vary in how they score. Add a **popular vote**.
- **Prizes**: sponsors' prizes under Manage → Prizes; teams pick the prizes they enter on their submission.
- **After**: results, [certificates](running-an-event.md#certificates), the gallery.

## Online hackathon

- **Format** online with the online link (Discord or a call). **Check-in** off.
- **Windows** for registration, teams, submissions and judging; submissions auto-submit at close.
- **Judging**: rubric in one round, or two rounds (a screening, then finalists). Judges can work from home, so offline scoring matters less.
- A webhook to a Discord or Slack channel posts window changes and announcements ([Discord and Slack](../reference/api.md#discord-and-slack)), and the
  `github` plugin fills a submission from a repository. People who
  arrive alone find a team on the Team page's board, and **Manage → Teams → Match teams...** places the rest.

## Hybrid

Set the format to **hybrid** and use both: check-in for people on site, the online link for the rest. Run one set of windows. Judge on site by
table and online by queue; they can be two forms with their own windows.

## Corporate or internal event

- **Sign-in**: single sign-on (SAML) or a company provider under Organization → Settings → Sign-in methods, and **Registration → invite only**.
- Network limits (Network access) if participants must be on the company network.
- Sponsors become judges; prizes may be "Best use of X" tracks the organizers place entries in (turn off **Teams enter it themselves** on those prizes).

## ICPC-style contest

Install `challenges` (and a runner), create a **Programming contest** event, choose **ICPC** scoring. See
[Running a programming contest](running-a-programming-contest.md). Add `lockdown` for a proctored room.

## IOI-style contest

The same, with **IOI** scoring: problems have test groups with points, and the board ranks by points. Import problem packages that bring
their groups and checkers.

## Code golf

The contest plugin with **code golf** scoring: the shortest accepted solution earns the most. Choose how length is counted and whether
points are in proportion or by place.

## CTF

Install `challenges` and create a **Capture the flag** event. Add the **Contest** and **Scoreboard** windows. Challenges have categories, flags (exact or
a pattern), fixed or dynamic points and hints that cost points. Teams are the event's teams. See the plugin's README.

## Machine-learning leaderboard

Install `leaderboard`. Add a **Scored predictions** item to a submission form, upload the hidden answers CSV, and teams send prediction
files from the Leaderboard page. The public board shows each team's public-split score; the private score decides the ranking when
results are published. Set a round's ranking method to **Leaderboard score** to rank by it.

## Game jam

Install `extra-judging` and turn on **Participants rate projects**. Participants rate each other's entries on criteria you set while
the **Peer rating** window is open; an entry ranks once it has enough ratings. Set the round's ranking method to **Peer rating**. Add a
popular vote for the audience.

## Pitch competition

- **Rounds**: a first round with every pitch, then **Advance** the top N to a final, which judges score in its own window.
- **Prizes** per category, and **Presentation mode** (`/events/<event>/results/present`) for the reveal.
- For a fast, fair first round with many judges and few minutes each, rank it by **Pairwise comparison** (`extra-judging`).
- For a final where a panel would rather compare than score, rank it by **Ranked ballots** or **Points budget** (`extra-judging`).

## Science fair

Use **sessions as interview slots**: a session per time slot with capacity, signed up for by project teams or booked by organizers, and judges
as hosts. Judge by rubric in rounds (a first round across the hall, a second for finalists), with **expo tables** and blind judging off.

## Writing or art contest

- **Solo** teams (size 1), **blind judging** on, and items that name people kept collapsed for judges.
- A submission form with a long text or file item; a rubric of a few criteria.
- A public **gallery** and a **popular vote** for the audience's favorite, and sharing judges' feedback with entrants.

## Class assignment

- Solo or small teams, **invite only**, the roster imported from a spreadsheet.
- Submissions with a deadline window and auto-submit; judging by the teacher as the only judge, with **What teams see from judges** set to scores so
  students see feedback and per-criterion averages.
- Copy the event for the next term.
