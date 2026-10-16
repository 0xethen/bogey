# Getting started

This page runs Bogey on your machine against a Supabase project. That's the
path for trying Bogey and for changing its code. For anything else, start
somewhere else:

| You want                                           | Start from                                                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| To try Bogey, or to change its code (fully own it) | Getting started (this page)                                                                                          |
| To run Bogey on a server, with your name and theme | [All in one](self-hosting/all-in-one.md), or [Self-hosting](self-hosting.md) for Supabase Cloud or your own Supabase |
| Your own logo files, extra themes or plugins       | [bogey-instance](https://github.com/0xethen/bogey-instance) ("Use this template"), no checkout needed                |

## You need

- Node.js 22.18 or newer
- [Vite+](https://viteplus.dev) (`vp`), which also provides pnpm
- A Supabase project: `supabase start` locally, [Supabase Cloud](https://supabase.com/dashboard),
  or [self-hosted](self-hosting/supabase.md)
- To work on Bogey itself: the Supabase CLI (`brew install supabase/tap/supabase`); see
  [Contributing](contributing.md#what-to-install)

## 1. Install

```sh
git clone https://github.com/0xethen/bogey && cd bogey
vp install
```

## 2. Point it at Supabase

```sh
vpr bogey setup
```

It asks for each value in `.env.example` and writes `.env`; secrets aren't
shown as you type. It needs `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and
`SUPABASE_SERVICE_ROLE_KEY`. The service-role key stays on the server and in
the CLI; the browser only ever gets the URL and the publishable key.

## 3. Apply the schema

The whole schema is one migration, `supabase/migrations/..._baseline.sql`.

```sh
supabase start      # local stack: applies migrations automatically
# or, for a remote project:
supabase db push --db-url "postgres://..."
```

The database also needs the sign-up hook and redirect URLs described in
[Supabase](self-hosting/supabase.md#what-the-schema-needs).

## 4. Create your organization

```sh
vpr bogey org init --org acme --name "Acme Hacks" --owner you@acme.org --host localhost --demo
```

This creates the org, makes you its owner and a platform admin, serves it on
`localhost`, and with `--demo` adds a demo hackathon and contest.

## 5. Run it

```sh
vpr dev
```

The app is on http://localhost:3000. `vpr dev` also runs `bogey watch`,
which regenerates files derived from themes and settings as you edit them.

Sign in with your email. If mail isn't set up yet, print a code instead:

```sh
vpr bogey login you@acme.org
```

## Next

- [Configuration](configuration.md) explains `.env`, `bogey.config.ts` and
  settings.
- [Running an event](guides/running-an-event.md) walks through setting one up.
- `vpr bogey` opens a menu of what the CLI does, and `vpr bogey help` lists every command; see [CLI](reference/cli.md).

## Try `bogey`

If you prefer, every `vpr bogey ...` above also works as plain `bogey ...` once your shell has this alias (put it in
`~/.zshrc` or `~/.bashrc`):

```sh
alias bogey='BOGEY_COMMAND=bogey node "$(git rev-parse --show-toplevel)/tools/cli/src/bin.ts"'
```

It runs the CLI of whichever checkout you're in, so it follows your branch and needs no build or
install. `vpr bogey` does the same through the task runner (uncached, so it always runs and can ask questions); the alias is just shorter. In the Docker
image, `bogey` is already on the PATH.
