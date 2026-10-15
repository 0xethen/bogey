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
upgrading is pulling the new image, or `bogey upgrade` for a fork (see
[Upgrading](docs/self-hosting/upgrading.md)).

## How a fix reaches you

A fix ships as a patch release, and the vulnerability is published as a
[GitHub security advisory](https://github.com/0xethen/bogey/security/advisories)
naming the affected versions and the release that fixes them. The release's
notes (its `CHANGELOG.md` section) have a **Security** section that links the
advisory.

A running instance reads the published advisories. While the version it runs is
affected, instance admins see a banner on every page, `bogey doctor` fails, and
the operator console shows it. See
[Knowing when to upgrade](docs/self-hosting/upgrading.md#knowing-when-to-upgrade),
including what to watch if you turned the update check off.
