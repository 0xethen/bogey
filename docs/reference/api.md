# Public API

A read-only JSON API, calendar and news feeds, and webhooks for pushing events out. It needs no key: it shows what a
signed-out visitor to your site can already see, so a private event or a hidden session never appears. Responses are the
same for everyone, cached for a minute, and allow requests from any website (CORS for `GET`).

The base is your own address, for example `https://hack.example.com/api/v1`.

## Endpoints

| Path                                    | Returns                                                              |
| --------------------------------------- | -------------------------------------------------------------------- |
| `GET /events`                           | The organization and its public events                               |
| `GET /events/<slug>`                    | One event with its windows and prizes                                |
| `GET /events/<slug>/agenda`             | The agenda: slots and sessions the public can see                    |
| `GET /events/<slug>/agenda.ics`         | The same as an iCalendar file                                        |
| `GET /events/<slug>/gallery`            | Shared projects, while the gallery is open                           |
| `GET /events/<slug>/results`            | Published awards and rankings                                        |
| `GET /events/<slug>/announcements`      | Announcements meant for everyone                                     |
| `GET /events/<slug>/announcements.atom` | The same as an Atom feed                                             |
| `GET /events/<slug>/announcements.rss`  | The same as an RSS feed                                              |
| `GET /events/<slug>/hackathon.json`     | The event as a `hackathon.json` card for directories and aggregators |
| `GET /calendar/<token>.ics`             | A person's own schedule (see below)                                  |

Times are ISO 8601 in UTC; each event also names its `timezone`. A missing or private event answers
`404 {"error": {"status": 404, "message": "..."}}`.

An event looks like:

```json
{
  "slug": "fall-hack",
  "name": "Fall Hack",
  "shortName": null,
  "kind": "hackathon",
  "description": "Markdown",
  "startsAt": "2026-10-09T13:00:00+00:00",
  "endsAt": "2026-10-10T17:00:00+00:00",
  "timezone": "America/New_York",
  "url": "https://hack.example.com/events/fall-hack"
}
```

`description` is the event's About in Markdown when the event shares it before approval (Manage → Security → Before
approval → About), and empty otherwise. `/events/<slug>` adds `windows` (`key`, `opensAt`, `closesAt`, `override`) and `prizes` (`name`, `description`, `prize`,
`sponsor`, `sponsorLogo`, `maxWinners`). A gallery project has `id`, `title`, `team`, `submittedAt`, `prizes` and `answers`
(`label`, `kind`, `value`) for its written and link answers; files are not included. Results carry `awards` and `rankings` as
published.

## Your own calendar

Account → Calendar makes a private address like `https://hack.example.com/api/v1/calendar/bgc_....ics`. Subscribe to it in
Google Calendar, Apple Calendar or Outlook to see the sessions you signed up for or host, and when windows open and close
in your events. Only a hash is stored, so the address is shown once; making a new one replaces the old, and turning it off
stops it working. Anyone holding the address can read your schedule, and it is never cached.

## Webhooks

A webhook tells another system when something happens. Organization admins add them under Organization → Settings →
Webhooks (for every event) and event organizers under Manage → Communication → Webhooks (for one event). Pick an `https`
address and the things to hear about:

| Event                  | When                                                                    |
| ---------------------- | ----------------------------------------------------------------------- |
| `registration.created` | Someone registers                                                       |
| `registration.updated` | A registration is approved, rejected, withdrawn, waitlisted or promoted |
| `team.created`         | A team is created                                                       |
| `submission.submitted` | A project is submitted                                                  |
| `results.published`    | Results are published                                                   |
| `window.opened`        | A window opens                                                          |
| `window.closed`        | A window closes                                                         |
| `announcement.posted`  | An announcement goes up                                                 |
| `checkin.created`      | Someone is checked in                                                   |

Bogey sends a `POST` with a JSON body:

```json
{
  "kind": "window.opened",
  "action": "window.opened",
  "at": "2026-10-09T13:00:02+00:00",
  "event": { "id": "…", "slug": "fall-hack", "name": "Fall Hack" },
  "target": { "type": "window", "id": null },
  "data": { "key": "submissions" }
}
```

`kind` is what the webhook asked for; `action` is the matching entry in the audit log, and `data` is that entry's details.
They never include secrets, but they can include names and email addresses the audit log holds, so send them only to
systems you trust.

Headers: `X-Bogey-Event` (the kind), `X-Bogey-Delivery` (an id, the same for every attempt at one delivery),
`X-Bogey-Timestamp` (seconds) and `X-Bogey-Signature`: `sha256=` and the hex HMAC-SHA256, keyed with the webhook's secret, of
`<timestamp>.<raw body>`. To check one, compute the HMAC over the timestamp, a dot and the body exactly as received, compare
in constant time, and reject timestamps more than a few minutes old.

Answer with any `2xx` within ten seconds. A `4xx` other than `408` or `429` means the address refused it, so it isn't
tried again and the delivery log shows the answer. Anything else, or no answer, is tried again after 1, 5, 30, 120 and 720
minutes, six tries in all; the delivery log shows each result and has **Send again**. Deliveries are kept for 30 days.
Addresses must be `https` on a public name, not an IP address or `localhost`. Making a new secret takes effect at once.

Webhooks are sent from the database about once a minute, so they arrive a short while after the thing happened.

## Discord and Slack

Paste a Discord webhook address (`https://discord.com/api/webhooks/...`) or a Slack incoming webhook address
(`https://hooks.slack.com/...`) and Bogey posts a chat message in that service's own format instead of the JSON body: the
event's name, what happened and a link to the event. What people typed (team names, announcement titles) is escaped, and
Discord messages can't mention anyone, so a team called `@everyone` pings nobody. An announcement shows its title only when
it's for everyone; one for some people says that an announcement was posted. A scheduled announcement is sent when it goes
up, not when it's written.

1. In Discord: Server Settings → Integrations → Webhooks → New Webhook, pick the channel, **Copy Webhook URL**. In Slack:
   create an app with Incoming Webhooks and copy the channel's address.
2. In Bogey: Manage → Communication → Webhooks (or Organization → Settings → Webhooks) → Add webhook. Paste the address
   and pick what to post. The list marks it **Discord** or **Slack**.

The address is the only secret a chat webhook has, so Bogey hides it on the page until you ask to see it. Anyone with it
can post to the channel.
