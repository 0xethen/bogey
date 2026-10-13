# A Bogey instance

This is the small repository an instance keeps, instead of forking Bogey. It holds only what's yours:
your `bogey.config.ts`, your logo, the plugins you install (`bogey.plugins.lock`), and a Dockerfile that
builds Bogey's release with them. Bogey's own code is fetched at the release tag you name, so upgrading
is changing one line. Forking Bogey is for changing Bogey's code, not for running it.

> **Not yet checked against a published release.** The first Bogey release will be built
> from this, and this note goes away once it has been.

## Do you need this?

| You want                                       | Use                                                                                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Your name, theme and disabled plugins          | The published image and a mounted `bogey.config.ts`, no build: the [all-in-one compose](https://github.com/0xethen/bogey/blob/main/docs/self-hosting/all-in-one.md) |
| Your own logo file, an extra theme or a plugin | This repository: those are part of the build                                                                                                                        |
| To change Bogey's code                         | A fork of Bogey                                                                                                                                                     |

## Use it

1. Make a repository from this folder (copy it, or "Use this template" on a repository
   that holds it). Edit `bogey.config.ts`: your name, logo, theme. Put your logo in `public/brand/`.
2. Pick the release in `compose.yml` (`BOGEY_VERSION`, a tag like `v2.0.0`).
3. Put your secrets in `.env` (`.env.example` lists them) and Supabase's settings in its own
   `.env`: [Supabase Cloud](https://github.com/0xethen/bogey/blob/main/docs/self-hosting/supabase-cloud.md)
   or [your own](https://github.com/0xethen/bogey/blob/main/docs/self-hosting/supabase.md).
4. Build and start it:

   ```sh
   BOGEY_HOST=bogey.example.org docker compose up -d --build
   ```

5. Create your org with the CLI that's in the image:

   ```sh
   docker compose exec web bogey org init --org acme --name "Acme Hacks" --owner you@acme.org
   ```

## What a change needs

| You changed                                                   | What it needs                                                                    |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `bogey.config.ts` (name, theme, repository, disabled plugins) | `docker compose restart web`                                                     |
| `public/` (logo files), a theme, `bogey.plugins.lock`         | `docker compose up -d --build`                                                   |
| `BOGEY_VERSION`                                               | `docker compose up -d --build`, after `docker compose exec web bogey db migrate` |

`bogey.config.ts` is mounted read-only into the container and read when the server starts. A logo given as
a full `https://` address in `icons` needs no rebuild either.

## Plugins

Add one with the CLI from a checkout of Bogey, copying the resulting `bogey.plugins.lock`
here; the Dockerfile restores exactly what the lock names. A plugin is trusted code, and
installing one means a rebuild.

## Upgrading

Change `BOGEY_VERSION`, read that release's CHANGELOG upgrade notes, then:

```sh
docker compose build web
docker compose run --rm web bogey db migrate && docker compose run --rm web bogey plugins migrate
docker compose up -d
```

(Migrations run from the new image, before the new app starts.) If you don't need your own logo, themes or
plugins, skip all this and run the published image `ghcr.io/0xethen/bogey` with your `.env`.
