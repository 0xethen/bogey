# How Bogey compares

Where Bogey stands next to the tools organizers already use: what it matches, where it differs on purpose, and what might put an
organizer off, with what we do about it. Details of other products are as we understand them in late 2026, from their public docs
and, for Devpost, third-party descriptions; check each project's own documentation before relying on one.

## The field

| Tool                   | What it is                                                                                                            | Hosting                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **Devpost**            | The default hackathon site: listings, registration, project pages, prizes, online judging, popular choice, portfolios | Hosted only                         |
| **DOMjudge**           | The ICPC-style contest system: judgehosts, special checkers, rejudging, scoreboard freeze, Contest API                | Self-hosted (GPL)                   |
| **dribdat**            | A "challenge board" for open hackathons: projects move through stages, autofill from repositories, open data exports  | Self-hosted (MIT)                   |
| **CTFd**               | Capture-the-flag platforms: flags, dynamic scoring, hints, scoreboards                                                | Self-hosted (Apache-2.0), or hosted |
| **Gavel**              | Expo judging by pairwise comparison between projects                                                                  | Self-hosted                         |
| **Kaggle / Codabench** | Competitions where submissions are files scored by a hidden scorer, with public and private leaderboards              | Hosted / self-hosted                |
| **itch.io jams**       | Game jams with peer rating across criteria and a minimum number of ratings                                            | Hosted only                         |

## Where Bogey matches

- **The hackathon lifecycle in one place** (Devpost): registration with review, a waitlist and consent questions, teams, prizes teams
  enter, submission forms per deliverable, judging, a popular vote, published results and awards, a public gallery, and certificates.
- **Judging rigor**: weighted criteria, rounds that advance the top N, blind judging, conflicts of interest, score normalization across
  judges, a calibration view, expo tables, and offline scoring that sends when the connection returns.
- **Other judging methods** (Gavel, itch.io): pairwise comparison, peer rating, ranked ballots and points budgets are the `extra-judging` plugin that feed the same ranking, advancing,
  awards and results.
- **Contests** (DOMjudge): the `challenges` plugin and its runner: Docker sandboxes, ICPC and IOI scoring, custom checkers, rejudge sets,
  Kattis problem packages, the Contest API export, and a lockdown plugin.
- **CTFs** (CTFd): the `challenges` plugin's capture-the-flag format: static and pattern flags, CTFd's dynamic scoring, hints that cost points, first blood, and a freeze.
- **Scored files** (Kaggle): the `leaderboard` plugin: hidden answers, a public and a private split, and a daily submission cap.
- **Open data** (dribdat): a read-only API, iCalendar and Atom/RSS feeds, a `hackathon.json` card, webhooks, and full event archives you can
  restore into another instance.
- **Running the day** (few tools do this well): check-in with badges and QR codes, an agenda people sign up for, attendance,
  announcements aimed at roles or teams, a questions inbox, and an audit log of every change.

## Where Bogey differs, on purpose

- **You run it.** A self-hosted fork like DOMjudge, not a hosted service. The organizer owns participants' data, branding and domain, and can
  change anything. The cost is running a server and Supabase; the all-in-one Compose file brings both.
- **Many events and organizations per instance.** One install serves a school's season, or several clubs on their own domains, with settings
  inherited down to each event.
- **Windows instead of phases.** Every "is this open now" question is a window with times or an override, so unusual schedules work.
- **The database enforces permissions.** Row-level security decides what each person sees, so a bug in a page can't leak another team's
  work, and blind judging hides names at the source.
- **Plugins for formats.** Contests, CTFs, leaderboards and the other methods are plugins an instance installs and each event turns on,
  rather than feature tiers or a fork.
- **No hiring funnel, no audience of its own.** No recruiter views, no selling participant data or attention, and no listing of events to
  strangers: a public gallery and link previews are for sharing what you ran.

## What dribdat does that Bogey doesn't (yet)

- Projects as living pages that change through stages over the event, with an activity log. Bogey has one submission per form per team.
- An optimizer for team building (Bogey's matcher is greedy and explains itself, but is simpler).
- Slack, Mattermost and hitobito sign-in out of the box.

## What might put organizers off

| Concern                                                                                           | What we do about it                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Setup is heavier than signing up for Devpost.**                                                 | `bogey setup --all-in-one` writes every secret and one `.env`, `docker compose up -d` starts Supabase, Bogey and Caddy, and the Supabase Cloud checklist is one page.                                                                   |
| **Email-only sign-in** (codes and links) feels unfamiliar, and school email filters can delay it. | Optional Google, GitHub, Microsoft, GitLab, Discord, Keycloak and company single sign-on, allowed per instance and narrowed per organization; codes work across devices; `bogey login` gets an organizer in without email during setup. |
| **Windows are a new concept.**                                                                    | The new-event wizard sets them from the dates and the kind of event; the Agenda is needed only for unusual timing.                                                                                                                      |
| **No built-in audience.**                                                                         | Events can still be listed on Devpost while Bogey runs them; galleries and result pages have link previews.                                                                                                                             |
| **Contest features need a runner.**                                                               | The runner is one container on a Linux host; about one per 20 teams; the guide and the runner's self-test walk through it.                                                                                                              |
| **The 2.0 release is new.**                                                                       | The upgrade path is tested in CI, releases are attested, and `bogey doctor` checks an install.                                                                                                                                          |
