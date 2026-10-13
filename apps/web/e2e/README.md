# End-to-end tests

Playwright suites that drive a running app. They sign in with codes from
`bogey login`, so no email is sent, and they only use accounts and an event you
name:

```sh
E2E_ORGANIZER=you@example.org \
E2E_PARTICIPANT=participant@example.org \
E2E_JUDGE=judge@example.org \
E2E_EVENT=demo-hackathon \
vp run e2e
```

| Variable           | Default                 | What it's for                                           |
| ------------------ | ----------------------- | ------------------------------------------------------- |
| `E2E_BASE_URL`     | `http://localhost:3000` | The app under test                                      |
| `E2E_ORGANIZER`    | none (skips)            | An organizer of `E2E_EVENT`                             |
| `E2E_PARTICIPANT`  | none (skips)            | A participant in `E2E_EVENT`                            |
| `E2E_JUDGE`        | none (skips)            | A judge of `E2E_EVENT`                                  |
| `E2E_EVENT`        | `demo-hackathon`        | The event the suites visit (`bogey seed demo` makes it) |
| `E2E_OTHER_ORIGIN` | none (skips)            | A second org's origin, for the tenancy check            |

The organizer suite posts an announcement and deletes it again; nothing else
writes.
