# Bogey, all in one

Bogey, the Supabase services it needs (Postgres, Auth, REST, Realtime, Storage and the gateway) and
Caddy, in one compose file. The full guide is
[docs/self-hosting/all-in-one.md](../../docs/self-hosting/all-in-one.md).

```sh
bogey setup --all-in-one --host bogey.example.org    # or: docker run --rm -v "$PWD:/out" ghcr.io/0xethen/bogey bogey setup --all-in-one --out /out --host bogey.example.org
docker compose up -d
docker compose exec web bogey org init --org acme --name "Acme Hacks" --owner you@acme.org --host bogey.example.org
```

| File                                         | What it is                                                            |
| -------------------------------------------- | --------------------------------------------------------------------- |
| `compose.yml`                                | every service, with the Supabase images pinned                        |
| `compose.runner.yml`, `Caddyfile.runner`     | the challenges runner, its Docker proxy and its gateway (optional)    |
| `Caddyfile`, `Caddyfile.hosted`              | the front door: one organization, or many with on-demand certificates |
| `bogey.config.ts`                            | your name, theme and disabled plugins, mounted read-only into `web`   |
| `.env.example`                               | every variable; `bogey setup --all-in-one` writes `.env` from it      |
| `volumes/db/*.sql`                           | Postgres setup scripts, unchanged from Supabase's self-hosted compose |
| `volumes/api/kong.yml`, `kong-entrypoint.sh` | the gateway's routes, trimmed to Auth, REST, Realtime and Storage     |

The images, `volumes/db/*.sql` and the gateway files come from
[supabase/supabase](https://github.com/supabase/supabase/tree/self-hosted/v0.8.2/docker) at tag
`self-hosted/v0.8.2` and are used under the Apache License 2.0. `kong.yml` is that file cut down.
