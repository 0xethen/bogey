# Limiting an event to a network

An event can require participants to be on certain networks, such as the
venue's Wi-Fi, to take part in the event: join or change a team, pick sessions,
check in, ask questions and submit. Set it under **Manage > Registration >
Network**: addresses or CIDR ranges, one per line. Organizers, staff and judges
aren't limited.

By default every participant is limited. To limit only some, pick people, teams
and/or divisions; anyone not covered by a pick can take part from any network.

You can also enter an AS number, like `AS46830` for a school district's
network. When you save, Bogey looks up the ranges it announces (from
[RIPEstat](https://stat.ripe.net/)) and saves those, dropping any a wider one
covers. Nothing is looked up while participants use the event, so re-save if
the network changes.

The check runs in the database (`private.network_allowed`), because browsers
talk to Supabase directly and the app server can't be the only gate. That
means the database has to know each visitor's real IP, which depends on your
proxies. Set it under **Instance > Settings > Client IPs**.

## Visitor IP comes from

- **X-Forwarded-For** (default). Each proxy appends the address it saw, so the
  database counts from the right. **Proxies in front of Supabase** is how many
  append to it before PostgREST. For the stock self-hosted gateway that's 1.
  Add one for each proxy you put in front, such as Caddy or a load balancer.
  Entries a visitor adds themselves sit further left and are ignored.
- **CF-Connecting-IP** when Supabase sits behind Cloudflare.
- **X-Real-IP** only if your proxy overwrites it. Otherwise a visitor can set
  it.

## App servers

Server functions reach Supabase from the app server, not the browser, so the
app passes the visitor's address in `x-bogey-client-ip`. The database only
honors that header from addresses listed under **App servers**; from anywhere
else it's ignored. List the addresses your web containers reach Supabase from
(a Docker network range, or the host's public IP for Supabase Cloud). Never
list a range that browsers also arrive from.

The app itself reads the visitor's address from `X-Forwarded-For` only when
`BOGEY_TRUST_PROXY=1`. `deploy/compose.yml` sets that because Caddy fronts
the app; don't set it when the app is reachable directly.

## Checking it

`event_network_status(event)` returns what the database saw
(`{ restricted, allowed, ip }`). The Network section shows your address, and
participants off the network see it in the warning on their submission page.

When a participant's change is refused for their network, the app records it
as `access.blocked` in the event's audit log, with the address the database
saw (at most once per person every 10 minutes). The Network section lists the
recent ones under **Blocked recently**, which helps when someone's on the
wrong Wi-Fi or a range is missing.
