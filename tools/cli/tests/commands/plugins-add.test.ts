import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { runPlugins } from "../../src/commands/plugins.ts";
import {
  assetUrl,
  hashDirectory,
  lockProblems,
  parseSpec,
  readLock,
} from "../../src/lib/plugin-install.ts";
import { spawnRunner, type Runner } from "../../src/lib/migrations.ts";

const MANIFEST = (
  version: string,
  extra = "",
) => `import { definePlugin } from "@bogey/plugins/api";
export const manifest = definePlugin({
  key: "demo",
  name: "Demo",
  api: 1,
  version: "${version}",
  description: "Does a demo.",
  author: { name: "Ada" },
  license: "MIT",
  source: { repository: "github:ada/plugins", directory: "demo" },
${extra}  routes: [{ path: "", label: "Demo" }],
});
export default manifest;
`;

function runner(gh: { release?: boolean; provenance?: boolean; installed?: boolean } = {}): Runner {
  return (command, args, input) => {
    if (command !== "gh") return spawnRunner(command, args, input);
    const fail = { stdout: "", stderr: "no attestation found\nmore detail" };
    if (args[0] === "--version") {
      return gh.installed === false
        ? { status: null, stdout: "", stderr: "spawn gh ENOENT" }
        : { status: 0, stdout: "gh version 2.101.0", stderr: "" };
    }
    const ok = args[0] === "release" ? gh.release : gh.provenance;
    return ok ? { status: 0, stdout: "", stderr: "" } : { status: 1, ...fail };
  };
}

function release(files: Record<string, string>, folder = "demo"): Uint8Array {
  const work = mkdtempSync(join(tmpdir(), "bogey-release-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(work, folder, name, ".."), { recursive: true });
    writeFileSync(join(work, folder, name), text);
  }
  const archive = join(work, "out.tar.gz");
  spawnSync("tar", ["-czf", archive, "-C", work, folder]);
  return new Uint8Array(readFileSync(archive));
}

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "bogey-repo-"));
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
  mkdirSync(join(root, "packages", "plugins", "installed"), { recursive: true });
  return root;
}

const SPEC = "github:ada/plugins/demo@1.0.0";
const GOOD = {
  "manifest.ts": MANIFEST("1.0.0", '  uses: { network: ["api.example.com"] },\n'),
  "runtime.tsx": "export default {};\n",
  "migrations/001_tables.sql": "create table public.demo_things (id int);\n",
};

test("a spec names an owner, a repository, a plugin and a version", () => {
  expect(parseSpec(SPEC)).toEqual({
    owner: "ada",
    repo: "plugins",
    plugin: "demo",
    version: "1.0.0",
  });
  expect(parseSpec("github:ada/plugins@1.0.0")).toMatch(/isn't github/);
  expect(parseSpec("github:ada/plugins/demo@latest")).toMatch(/version/);
  const spec = parseSpec(SPEC);
  if (typeof spec === "string") throw new Error(spec);
  expect(assetUrl(spec)).toBe(
    "https://github.com/ada/plugins/releases/download/demo-v1.0.0/demo-1.0.0.tar.gz",
  );
});

test("add shows the plugin and its SQL, then installs and locks it", async () => {
  const root = repo();
  const said: string[] = [];
  const asked: string[] = [];
  const result = await runPlugins(root, ["add", SPEC], runner(), {
    download: async () => release(GOOD),
    confirm: async (question) => {
      asked.push(question);
      return true;
    },
    say: (text) => said.push(text),
  });
  expect(result.exitCode).toBe(0);
  expect(asked).toEqual(["Install demo 1.0.0?"]);
  const shown = said.join("\n");
  expect(shown).toContain("create table public.demo_things");
  expect(shown).toContain('network: ["api.example.com"]');
  expect(shown).toContain("trusted code");
  const dir = join(root, "packages", "plugins", "installed", "demo");
  expect(existsSync(join(dir, "manifest.ts"))).toBe(true);
  expect(readLock(root).demo).toEqual({
    source: "github:ada/plugins/demo",
    version: "1.0.0",
    integrity: hashDirectory(dir),
  });
  expect(result.output).toContain("bogey plugins migrate");
  expect(result.output).toContain("rebuild");
});

test("declining installs nothing", async () => {
  const root = repo();
  const result = await runPlugins(root, ["add", SPEC], runner(), {
    download: async () => release(GOOD),
    confirm: async () => false,
    say: () => {},
  });
  expect(result.exitCode).toBe(1);
  expect(existsSync(join(root, "packages", "plugins", "installed", "demo"))).toBe(false);
  expect(readLock(root)).toEqual({});
});

test("without a terminal it won't install unless told to", async () => {
  const root = repo();
  const result = await runPlugins(root, ["add", SPEC], runner(), {
    download: async () => release(GOOD),
    say: () => {},
    confirm: async () => false,
  });
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("--yes");
  const yes = await runPlugins(root, ["add", SPEC, "--yes"], runner(), {
    download: async () => release(GOOD),
    say: () => {},
  });
  expect(yes.exitCode).toBe(0);
});

test("a manifest that disagrees with its tag is refused", async () => {
  const root = repo();
  const result = await runPlugins(root, ["add", SPEC, "--yes"], runner(), {
    download: async () => release({ ...GOOD, "manifest.ts": MANIFEST("2.0.0") }),
    say: () => {},
  });
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("2.0.0");
  expect(existsSync(join(root, "packages", "plugins", "installed", "demo"))).toBe(false);
});

test("an archive that reaches outside the plugin's folder is refused", async () => {
  const root = repo();
  const result = await runPlugins(root, ["add", SPEC, "--yes"], runner(), {
    download: async () => release(GOOD, "other"),
    say: () => {},
  });
  expect(result.exitCode).toBe(1);
  expect(result.output).toMatch(/outside demo\//);
});

test("an archive holding a link is refused", async () => {
  const work = mkdtempSync(join(tmpdir(), "bogey-release-"));
  mkdirSync(join(work, "demo"));
  writeFileSync(join(work, "demo", "manifest.ts"), MANIFEST("1.0.0"));
  symlinkSync("/etc/passwd", join(work, "demo", "evil"));
  const archive = join(work, "out.tar.gz");
  spawnSync("tar", ["-czf", archive, "-C", work, "demo"]);
  const root = repo();
  const result = await runPlugins(root, ["add", SPEC, "--yes"], runner(), {
    download: async () => new Uint8Array(readFileSync(archive)),
    say: () => {},
  });
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("plain file");
});

test("a download that fails says so", async () => {
  const result = await runPlugins(repo(), ["add", SPEC, "--yes"], runner(), {
    download: async () => {
      throw new Error("404");
    },
    say: () => {},
  });
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("couldn't download");
});

test("a plugin bogey didn't install isn't replaced without --force", async () => {
  const root = repo();
  const dir = join(root, "packages", "plugins", "installed", "demo");
  mkdirSync(dir);
  writeFileSync(join(dir, "manifest.ts"), "// my own work\n");
  const result = await runPlugins(root, ["add", SPEC, "--yes"], runner(), {
    download: async () => release(GOOD),
    say: () => {},
  });
  expect(result.exitCode).toBe(1);
  expect(readFileSync(join(dir, "manifest.ts"), "utf-8")).toBe("// my own work\n");
});

test("install restores a missing plugin and refuses a changed release", async () => {
  const root = repo();
  const deps = { download: async () => release(GOOD), say: () => {} };
  await runPlugins(root, ["add", SPEC, "--yes"], runner(), deps);
  const dir = join(root, "packages", "plugins", "installed", "demo");

  expect((await runPlugins(root, ["install"], runner(), deps)).output).toContain("ok");

  writeFileSync(join(dir, "runtime.tsx"), "// edited\n");
  expect(lockProblems(root)[0]).toMatch(/differs from bogey.plugins.lock/);
  const restored = await runPlugins(root, ["install"], runner(), deps);
  expect(restored.output).toContain("restored");
  expect(lockProblems(root)).toEqual([]);

  writeFileSync(join(dir, "runtime.tsx"), "// edited again\n");
  const swapped = await runPlugins(root, ["install"], runner(), {
    download: async () =>
      release({ ...GOOD, "runtime.tsx": "export default { changed: true };\n" }),
    say: () => {},
  });
  expect(swapped.exitCode).toBe(1);
  expect(swapped.output).toContain("doesn't match the lock");
  expect(readFileSync(join(dir, "runtime.tsx"), "utf-8")).toBe("// edited again\n");
});

test("doctor reports a locked plugin that is missing", async () => {
  const root = repo();
  await runPlugins(root, ["add", SPEC, "--yes"], runner(), {
    download: async () => release(GOOD),
    say: () => {},
  });
  expect(lockProblems(root)).toEqual([]);
  rmSync(join(root, "packages", "plugins", "installed", "demo"), { recursive: true });
  expect(lockProblems(root)[0]).toMatch(/isn't installed/);
});

test("a release attestation is shown and recorded in the lock", async () => {
  const root = repo();
  const said: string[] = [];
  const result = await runPlugins(root, ["add", SPEC, "--yes"], runner({ release: true }), {
    download: async () => release(GOOD),
    say: (text) => said.push(text),
  });
  expect(result.exitCode).toBe(0);
  expect(said.join("\n")).toContain(
    "release attestation: this file is an asset of ada/plugins demo-v1.0.0",
  );
  expect(readLock(root).demo?.attestation).toBe("release");
});

test("with only build provenance it says so and records that", async () => {
  const root = repo();
  const said: string[] = [];
  await runPlugins(root, ["add", SPEC, "--yes"], runner({ provenance: true }), {
    download: async () => release(GOOD),
    say: (text) => said.push(text),
  });
  expect(said.join("\n")).toContain("build attestation: a workflow in ada/plugins built this file");
  expect(readLock(root).demo?.attestation).toBe("provenance");
});

test("without an attestation it warns but still installs", async () => {
  const root = repo();
  const said: string[] = [];
  const result = await runPlugins(root, ["add", SPEC, "--yes"], runner(), {
    download: async () => release(GOOD),
    say: (text) => said.push(text),
  });
  expect(result.exitCode).toBe(0);
  expect(said.join("\n")).toContain(
    "verified   NO: no attestation checked out (no attestation found)",
  );
  expect(readLock(root).demo?.attestation).toBeUndefined();
});

test("--require-attestation refuses an unattested release and installs nothing", async () => {
  const root = repo();
  const result = await runPlugins(root, ["add", SPEC, "--yes", "--require-attestation"], runner(), {
    download: async () => release(GOOD),
    say: () => {},
  });
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("--require-attestation");
  expect(existsSync(join(root, "packages", "plugins", "installed", "demo"))).toBe(false);
});

test("--require-attestation accepts an attested one", async () => {
  const result = await runPlugins(
    repo(),
    ["add", SPEC, "--yes", "--require-attestation"],
    runner({ release: true }),
    { download: async () => release(GOOD), say: () => {} },
  );
  expect(result.exitCode).toBe(0);
});

test("without gh it says nothing was checked", async () => {
  const said: string[] = [];
  await runPlugins(repo(), ["add", SPEC, "--yes"], runner({ installed: false }), {
    download: async () => release(GOOD),
    say: (text) => said.push(text),
  });
  expect(said.join("\n")).toContain("gh) isn't installed or isn't signed in");
});

test("--no-verify skips the check", async () => {
  const said: string[] = [];
  await runPlugins(repo(), ["add", SPEC, "--yes", "--no-verify"], runner({ release: true }), {
    download: async () => release(GOOD),
    say: (text) => said.push(text),
  });
  expect(said.join("\n")).toContain("skipped (--no-verify)");
});
