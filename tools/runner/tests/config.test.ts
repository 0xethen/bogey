import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { loadConfig } from "../src/config.ts";
import { dockerArgs } from "../src/sandbox.ts";

const base = { SUPABASE_URL: "https://x.supabase.co/", SUPABASE_SERVICE_ROLE_KEY: "key" };

test("the project and the service key are required", () => {
  assert.throws(() => loadConfig({}), /SUPABASE_URL/);
  assert.throws(() => loadConfig({ SUPABASE_URL: "https://x.co" }), /SERVICE_ROLE_KEY/);
  assert.throws(
    () => loadConfig({ SUPABASE_URL: "x.co", SUPABASE_SERVICE_ROLE_KEY: "k" }),
    /SUPABASE_URL/,
  );
});

test("defaults are sensible and the address loses its trailing slash", () => {
  const config = loadConfig(base);
  assert.equal(config.supabaseUrl, "https://x.supabase.co");
  assert.equal(config.concurrency, 2);
  assert.equal(config.limits.cpus, 1);
});

test("settings are read and checked", () => {
  const config = loadConfig({
    ...base,
    BOGEY_RUNNER_CONCURRENCY: "6",
    BOGEY_RUNNER_CPUS: "0.5",
    BOGEY_RUNNER_ID: "box-1",
  });
  assert.equal(config.concurrency, 6);
  assert.equal(config.limits.cpus, 0.5);
  assert.equal(config.runnerId, "box-1");
  assert.throws(() => loadConfig({ ...base, BOGEY_RUNNER_CONCURRENCY: "0" }), /CONCURRENCY/);
  assert.throws(() => loadConfig({ ...base, BOGEY_RUNNER_MAX_MEMORY_MB: "lots" }), /MAX_MEMORY_MB/);
});

test("a backend that isn't built fails at startup instead of judging nothing", () => {
  assert.throws(() => loadConfig({ ...base, BOGEY_RUNNER_BACKEND: "piston" }), /isn't built/);
  assert.throws(() => loadConfig({ ...base, BOGEY_RUNNER_BACKEND: "wasm" }), /isn't built/);
});

test("a container has no network, a read-only root, no capabilities and an unprivileged user", () => {
  const args = dockerArgs("n", "lab", {
    image: "img",
    command: "./main",
    cwd: "/work",
    mounts: [{ host: "/h/w", container: "/work", writable: false }],
    stdin: "",
    timeMs: 1000,
    memoryMb: 64,
    cpus: 0.5,
    pids: 32,
    maxOutputBytes: 100,
    tmpfsMb: 16,
  });
  const pair = (flag: string) => args[args.indexOf(flag) + 1];
  assert.equal(pair("--network"), "none");
  assert.ok(args.includes("--read-only"));
  assert.equal(pair("--cap-drop"), "ALL");
  assert.equal(pair("--security-opt"), "no-new-privileges");
  assert.equal(pair("--user"), "65534:65534");
  assert.equal(pair("--memory"), "64m");
  assert.equal(pair("--memory-swap"), "64m", "no swap to hide a memory limit behind");
  assert.equal(pair("--pids-limit"), "32");
  assert.ok(args.includes("/h/w:/work:ro"));
  assert.deepEqual(args.slice(-3), ["sh", "-c", "./main"]);
});
