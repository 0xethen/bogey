# 0023: Lockdown is a deterrent and a record

**Status:** accepted (2026-10-10).

## Context

Timed contests and exams want some assurance that people stay on the contest page. A web page cannot prove it: a determined
person can run another machine. Locked-down browsers and proctoring services can do more, with cost, privacy and platform
limits. The `lockdown` plugin needed a clear line on what it promises.

## Decision

- **Three levels, none of them proof.** In-page signals (leaving full screen, switching tabs, blur, the inspect menu, a developer
  tools heuristic, new windows, clipboard use); a **companion browser extension** for Chromium (Manifest V3) that reports its version and
  signals and answers a per-session nonce the page gives it; and **Safe Exam Browser**, detected on the server by checking the request-hash
  headers against the Browser Exam Key or Config Key an organizer entered.
- **The setting `Require to submit` chooses what counts**: nothing more, the companion's attestation, or Safe Exam Browser. Submissions from
  a browser that hasn't shown the required thing are refused by the database, and organizers can let someone back in.
- **Violations are recorded, never decided by the browser.** They go to the audit log as `lockdown.<kind>`; in enforce mode the plugin stops
  submissions after too many, and proctors see a page of sessions and counts.
- **Honest wording.** The interface says it is a deterrent and a record. A person who talks to the database directly can mark their own
  session attested, and the docs say so.
- **Out of scope**: Respondus, mobile browsers, webcam proctoring, and publishing the companion extension to a store (operators build it
  for their own host).

## Consequences

- Organizers get useful evidence and friction without Bogey holding cameras or personal data.
- Safe Exam Browser keys live in a proctor-only table, because plugin settings are readable by participants.
- The companion extension must be rebuilt for each host and installed on the machines used.
