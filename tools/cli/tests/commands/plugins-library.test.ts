import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import type { Fetcher } from "@bogey/plugins/updates";
import { runPlugins } from "../../src/commands/plugins.ts";
import { spawnRunner } from "../../src/lib/migrations.ts";
import { readLock } from "../../src/lib/plugin-install.ts";

const OFFICIAL = "https://raw.githubusercontent.com/0xethen/bogeyx/HEAD/index.json";
const BOB = "https://raw.githubusercontent.com/bob/more/HEAD/index.json";

const entry = (key: string, version = "1.0.0", api = 1) => ({
  key,
  name: key,
  version,
  description: `The ${key} plugin`,
  api,
  tag: `${key}-v${version}`,
  directory: `plugins/${key}`,
});

const index = (repository: string, plugins: ReturnType<typeof entry>[]) => ({
  schema: 1,
  name: repository,
  repository,
  plugins,
});

function fetcher(libraries: Record<string, unknown>): Fetcher {
  return async (url) => {
    const body = libraries[url];
    return {
      ok: body !== undefined,
      status: body === undefined ? 404 : 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
}

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "bogey-lib-"));
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
  mkdirSync(join(root, "packages", "plugins", "installed"), { recursive: true });
  return root;
}

const official = index("github:0xethen/bogeyx", [entry("challenges", "1.0.0"), entry("sound")]);
const bob = index("github:bob/more", [entry("extra", "2.1.0"), entry("sound", "0.4.0")]);

test("libraries are listed, added to bogey.libraries.json once, and removed", async () => {
  const root = repo();
  expect((await runPlugins(root, ["library"])).output).toContain("(official)");

  const added = await runPlugins(root, ["library", "add", "github:bob/more"]);
  expect(added.exitCode).toBe(0);
  expect(added.output).toContain("trust");
  expect(JSON.parse(readFileSync(join(root, "bogey.libraries.json"), "utf-8"))).toEqual({
    libraries: ["github:bob/more"],
  });
  expect((await runPlugins(root, ["library", "add", "github:bob/more"])).output).toMatch(
    /already searched/,
  );
  expect((await runPlugins(root, ["library", "list"])).output).toContain("github:bob/more");

  expect((await runPlugins(root, ["library", "remove", "github:bob/more"])).exitCode).toBe(0);
  expect(JSON.parse(readFileSync(join(root, "bogey.libraries.json"), "utf-8")).libraries).toEqual(
    [],
  );
});

test("a library must be github:<owner>/<repo>, and the file must be valid", async () => {
  const root = repo();
  expect((await runPlugins(root, ["library", "add", "bob/more"])).exitCode).toBe(1);
  writeFileSync(join(root, "bogey.libraries.json"), "{ nope");
  expect((await runPlugins(root, ["library"])).output).toMatch(/isn't valid JSON/);
  writeFileSync(join(root, "bogey.libraries.json"), '{"libraries":["x"]}');
  expect((await runPlugins(root, ["library"])).exitCode).toBe(1);
});

test("search reads every library, names where each plugin is, and says which couldn't be read", async () => {
  const root = repo();
  await runPlugins(root, ["library", "add", "github:bob/more"]);
  await runPlugins(root, ["library", "add", "github:down/x"]);
  const result = await runPlugins(root, ["search", "plugin"], spawnRunner, {
    fetcher: fetcher({ [OFFICIAL]: official, [BOB]: bob }),
  });
  expect(result.exitCode).toBe(0);
  expect(result.output).toContain("challenges");
  expect(result.output).toContain("extra");
  expect(result.output).toContain("github:bob/more");
  expect(result.output).toMatch(/Skipped: github:down\/x has no index\.json/);
  const none = await runPlugins(root, ["search", "zzz"], spawnRunner, {
    fetcher: fetcher({ [OFFICIAL]: official }),
  });
  expect(none.output).toContain("No plugin matches.");
});

test("a plugin in two libraries has to be named in full; the others install by key", async () => {
  const root = repo();
  await runPlugins(root, ["library", "add", "github:bob/more"]);
  const both = fetcher({ [OFFICIAL]: official, [BOB]: bob });
  const ambiguous = await runPlugins(root, ["add", "sound", "--yes"], spawnRunner, {
    fetcher: both,
    download: async () => {
      throw new Error("should not download");
    },
  });
  expect(ambiguous.exitCode).toBe(1);
  expect(ambiguous.output).toMatch(/github:0xethen\/bogeyx and github:bob\/more/);

  const unknown = await runPlugins(root, ["add", "nothing", "--yes"], spawnRunner, {
    fetcher: both,
  });
  expect(unknown.output).toMatch(/no library has a plugin "nothing"/);
});

test("add <key> downloads the version the library lists, from the library's repository", async () => {
  const root = repo();
  await runPlugins(root, ["library", "add", "github:bob/more"]);
  const urls: string[] = [];
  const result = await runPlugins(root, ["add", "extra", "--yes", "--no-verify"], spawnRunner, {
    fetcher: fetcher({ [OFFICIAL]: official, [BOB]: bob }),
    download: async (url) => {
      urls.push(url);
      throw new Error("stop here");
    },
    say: () => {},
  });
  expect(urls).toEqual([
    "https://github.com/bob/more/releases/download/extra-v2.1.0/extra-2.1.0.tar.gz",
  ]);
  expect(result.exitCode).toBe(1);
  expect(existsSync(join(root, "packages", "plugins", "installed", "extra"))).toBe(false);
  expect(readLock(root)).toEqual({});

  const pinned: string[] = [];
  await runPlugins(root, ["add", "extra@2.0.0", "--yes", "--no-verify"], spawnRunner, {
    fetcher: fetcher({ [OFFICIAL]: official, [BOB]: bob }),
    download: async (url) => {
      pinned.push(url);
      throw new Error("stop here");
    },
    say: () => {},
  });
  expect(pinned[0]).toContain("extra-v2.0.0/extra-2.0.0.tar.gz");
});

test("schema prints the JSON Schema of either file", async () => {
  const root = repo();
  const schema = JSON.parse((await runPlugins(root, ["schema"])).output);
  expect(schema.properties.plugins.type).toBe("array");
  const libraries = JSON.parse((await runPlugins(root, ["schema", "libraries"])).output);
  expect(libraries.properties.libraries.type).toBe("array");
  expect((await runPlugins(root, ["schema", "other"])).exitCode).toBe(1);
});
