# @bogey/db

Supabase access for Bogey.

- `browser`, `server`, `admin`: the three clients. `admin` uses the service
  role and is server-only.
- `env`: runtime Supabase settings, handed to the browser by the server.
- `queries/*`: server functions and TanStack Query options, one file per area.
  Each returns a `DbResult` instead of throwing.
- `audit`: the audit actions the schema writes, checked against it by a test.
- `types`: generated from the database by `bogey types`.

Row-level security in `supabase/schemas` is the authorization boundary; the
queries never rely on hiding things in the UI.
