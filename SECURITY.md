# Security

## Reporting a vulnerability

Please report security problems privately through GitHub's
[private vulnerability reporting](https://github.com/0xethen/bogey/security/advisories/new)
and not in a public issue. Include what you found, how to reproduce it and
which version or commit it affects.

If you cannot use GitHub, email `public@ethen.app` with a description of the
vulnerability.

## What counts

Bogey's authorization boundary is the database: row-level security and the
`security definer` functions in `supabase/schemas/`. A way to read or write
something a role shouldn't reach, to act as another person, or to cross from
one organization into another is a vulnerability. So is a way to run code on
the host from the web app. The [security model](docs/architecture/security-model.md)
describes what is meant to hold.

Plugins are trusted code that runs in the app's process, so a malicious
plugin is not a Bogey vulnerability; see
[ADR 0012](docs/adr/0012-plugin-distribution-and-trust.md).

## Verifying what you run

Releases are immutable and attested; see
[Verifying a release](docs/self-hosting/upgrading.md#verifying-a-release).

## Supported versions

The latest release gets security fixes. Instances follow release tags, so
upgrading is `bogey upgrade`.
