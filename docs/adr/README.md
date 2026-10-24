# Architecture decision records

Each file records one decision: the situation, what we chose, and what it
costs us. Records are never edited after they are accepted. When a decision
changes, write a new ADR that supersedes the old one and link the two.

| #                                              | Decision                                                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [0001](0001-tenancy.md)                        | One database, orgs as tenants, resolved from the host                                          |
| [0002](0002-schema-layout.md)                  | `public`/`private` schemas, declarative schema files, a single baseline                        |
| [0003](0003-settings.md)                       | One settings table with instance → org → event precedence, secrets in Vault                    |
| [0004](0004-windows-and-stages.md)             | Windows are the only authorization primitive; stages are derived                               |
| [0005](0005-people-and-permissions.md)         | Event roles plus a permission matrix; judges aren't participants; teams are always the entrant |
| [0006](0006-registrations.md)                  | One registrations table replaces imports, signups and pending users                            |
| [0007](0007-judging-pipeline.md)               | Solutions, judgings and runs, with runner leases                                               |
| [0008](0008-plugin-data.md)                    | Plugin tables are always installed; enablement is a setting                                    |
| [0009](0009-plugins-ship-separately.md)        | Plugins ship separately; the repository contains none                                          |
| [0010](0010-sessions.md)                       | Sessions: an agenda of time slots, written only through RPCs                                   |
| [0011](0011-releases-and-upgrades.md)          | Releases are tags; instances follow tags; the baseline freezes at 2.0.0                        |
| [0012](0012-plugin-distribution-and-trust.md)  | Plugins install from tagged releases, pinned in a lockfile, as trusted code                    |
| [0013](0013-email-templates.md)                | Email is an instance layout plus Markdown content per kind                                     |
| [0014](0014-org-limits-and-suspension.md)      | Per-org limits with overrides; restricted and suspended orgs                                   |
| [0015](0015-operator-actions-cli-only.md)      | Operator actions are CLI-only; the web app reports and explains                                |
| [0016](0016-check-in-in-core.md)               | Check-in is part of Bogey, not a plugin                                                        |
| [0017](0017-runtime-instance-config.md)        | Instance config is read when the server starts                                                 |
| [0018](0018-cli-in-the-image.md)               | The CLI ships inside the image                                                                 |
| [0019](0019-all-in-one-compose.md)             | An all-in-one compose bundles the Supabase services                                            |
| [0020](0020-ranking-providers.md)              | Other ways to rank are plugins                                                                 |
| [0021](0021-email-outbox.md)                   | Bogey's own email goes through an outbox the app drains                                        |
| [0022](0022-notifications.md)                  | Notifications are a core table; email is one channel                                           |
| [0023](0023-lockdown-integrity.md)             | Lockdown is a deterrent and a record                                                           |
| [0024](0024-languages.md)                      | Languages come from a small catalog seam and plugins                                           |
| [0025](0025-operator-console.md)               | The operator console is a separate local app                                                   |
| [0026](0026-bundled-plugins-and-team-board.md) | Challenges ships with Bogey; finding a team is core                                            |
| [0027](0027-plugins-only-add.md)               | A plugin only adds to Bogey, so removing it is complete                                        |
| [0028](0028-event-privacy.md)                  | Seeing an event is not being in it                                                             |
| [0029](0029-operator-keys.md)                  | The keys that set the instance's trust boundary belong to the operator                         |
| [0030](0030-about-for-members.md)              | One About, for members by default                                                              |
| [0031](0031-plugin-gates.md)                   | Plugins can close an event to a participant                                                    |
| [0032](0032-tags.md)                           | Tags label people, can grant permissions, and drive judging rules                              |
| [0033](0033-runner-isolation.md)               | The runner is its own unit, with a key that can only judge and no Docker socket                |
| [0034](0034-certificate-backgrounds.md)        | Certificate pages designed elsewhere come in as pictures, read in the browser                  |
