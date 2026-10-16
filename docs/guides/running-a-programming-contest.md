# Running a programming contest

Programming contests (ICPC, IOI, code golf) use the `challenges` plugin and a runner that judges solutions. This guide is the whole
path; the plugin's README and the runner's README have the detail.

## What you need

- Bogey. The **challenges** plugin ships with it, and `bogey db migrate` applies its tables; there's nothing to install.
- A **runner**: a Linux machine with Docker and cgroup v2 that holds the project's service key. About one runner per 20 teams.
  Without one, solutions queue and never get a verdict.
- Optionally the **lockdown** plugin for monitored contests.

## Set up

1. **New event → Programming contest.** The event starts with the plugin on.
2. **Manage → Plugins → Challenges**: choose the contest style (ICPC: solved problems then penalty; IOI: points from tests; code golf: the
   shortest accepted solution scores most), the languages, the problem IDs, the freeze time and the attempt limit.
3. **Manage → Agenda**: add the **Contest** window (problems visible, submissions accepted) and the **Scoreboard** window (the public board).
4. **Start the runner** where the contest will run (see [the runner README](../../tools/runner/README.md)):
   build the language images once, run `node src/main.ts --self-test`, then start it with the project's address and service key. With
   [the all-in-one stack](../self-hosting/all-in-one.md), `compose.runner.yml` joins its network.

## Problems

Open **Jury** (the jury role, or organizers). Add problems by hand (statement, limits, checker, tests) or **import a Kattis / ICPC problem
package** (a ZIP). Packages bring limits, samples, grouped tests with points, custom checkers, statements and jury solutions; interactive
problems aren't supported. A new problem is hidden until you show it.

Checkers: exact, tokens, floating point with a tolerance, or custom (a program that answers with exit code 42 to accept and 43 to reject). Test
groups carry points for IOI scoring and can stop at the first failure.

A problem's page is what participants see; on the jury, its **Jury view** button opens the editor, which links back with
**Participant view**. For code golf scored by length ranges, set each problem's ranges in its editor.

**Verify a problem** before the contest: add jury solutions with their expected verdicts and run the check. Jury runs never count on the board.

## During the contest

- Teams (or solo entrants) see the problems on the **Problems** page, submit code, and get verdicts as the runner judges: `AC`, `WA`, `TLE`,
  `MLE`, `RE`, `CE`, `OLE`, or `JE` when the problem or the runner is broken.
- **Run** tries code in the participant's browser on one input, in a fresh interpreter each time. Errors show only the lines from their
  own code; a checkbox shows the runner's lines too. Turn off **Show error messages** (Solving settings) and judged solutions only say
  that they errored or didn't compile.
- **Clarifications** arrive on the Messages tab; answer them there, and share an answer with everyone when it helps.
- The scoreboard freezes at the time you set; the jury still sees it live.
- To **rejudge** (a wrong test, say), make a rejudge set by problem, language, team or solution, review the differences, then apply it. A solution
  can be ignored; it shows struck through and doesn't count.
- If you want results hidden until a jury member checks them, turn on **verification required**.

## Lockdown

With **lockdown** on, participants are asked for full screen and tab switches are recorded. It can require the companion Chromium extension
(built for your host from `lockdown/companion`) or **Safe Exam Browser** before submissions count. It is a deterrent and a record, not proof.

## After

Close the Contest window, publish the final board, and download the contest in the ICPC Contest API's shape from **Jury → Contest data**, or
fetch the public scoreboard JSON at `/api/x/challenges/contests/<event>/scoreboard`. [Archive the event](running-an-event.md#archive-the-event)
if you want to keep it.
