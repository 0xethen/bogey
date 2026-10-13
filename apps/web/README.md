# web

Bogey's app: participant, judge and organizer pages, the org area and the
instance admin, in one TanStack Start app.

- Routes are files in `src/routes` (`_authed/` needs a session; `_unauthed/`
  is sign-in; `api/` are server routes).
- Page chrome comes from each route's `staticData`: `title` (or a `title`
  its loader returns), `header` (menubar and tab row) and `classNames`.
- Data comes from `@bogey/db` queries; components from `@bogey/ui`.

Run it from the repo root with `pnpm dev`. See
[Contributing](../../docs/contributing.md).
