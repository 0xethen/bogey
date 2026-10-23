import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { loadConfig } from "../src/config.ts";

const KEY = `bogey_runner_${"k".repeat(43)}`;
const base = { SUPABASE_URL: "https://x.supabase.co/", BOGEY_RUNNER_KEY: KEY };

test("the project and a credential are required", () => {
  assert.throws(() => loadConfig({}), /SUPABASE_URL/);
  assert.throws(() => loadConfig({ SUPABASE_URL: "https://x.co" }), /BOGEY_RUNNER_KEY/);
  assert.throws(() => loadConfig({ ...base, SUPABASE_URL: "x.co" }), /SUPABASE_URL/);
});

test("a runner key is the credential, with the anon key if there is one", () => {
  const config = loadConfig({ ...base, SUPABASE_ANON_KEY: "anon" });
  assert.deepEqual(config.credential, { kind: "key", runnerKey: KEY, apiKey: "anon" });
  assert.deepEqual(config.warnings, []);
  assert.throws(() => loadConfig({ ...base, BOGEY_RUNNER_KEY: "nope" }), /isn't a runner key/);
});

test("a runner key and the service key together are refused", () => {
  assert.throws(
    () => loadConfig({ ...base, SUPABASE_SERVICE_ROLE_KEY: "svc" }),
    /Remove the service key/,
  );
});

test("the service key alone still works, with a warning", () => {
  const config = loadConfig({ SUPABASE_URL: "https://x.co", SUPABASE_SERVICE_ROLE_KEY: "svc" });
  assert.equal(config.credential.kind, "service");
  assert.match(config.warnings[0] ?? "", /bogey runner key add/);
});

test("the self-test needs no project or credential", () => {
  assert.doesNotThrow(() => loadConfig({}, { selfTest: true }));
});

test("defaults are sensible and the address loses its trailing slash", () => {
  const config = loadConfig({ ...base, BOGEY_RUNNER_ID: "box", BOGEY_RUNNER_WORK_DIR: "/w" });
  assert.equal(config.supabaseUrl, "https://x.supabase.co");
  assert.equal(config.concurrency, 2);
  assert.equal(config.limits.cpus, 1);
  assert.equal(config.workDir, "/w/box", "each runner id works in its own folder");
  assert.equal(config.runtime, "");
  assert.ok(config.images.includes("bogey-runner-*"));
  assert.equal(config.limits.judgingTimeMs, 900_000);
});

test("settings are read and checked", () => {
  const config = loadConfig({
    ...base,
    BOGEY_RUNNER_CONCURRENCY: "6",
    BOGEY_RUNNER_CPUS: "0.5",
    BOGEY_RUNNER_ID: "box-1",
    BOGEY_RUNNER_RUNTIME: "runsc",
    BOGEY_RUNNER_IMAGES: "registry.example.org/judge-*, exact:1",
  });
  assert.equal(config.concurrency, 6);
  assert.equal(config.limits.cpus, 0.5);
  assert.equal(config.runnerId, "box-1");
  assert.equal(config.runtime, "runsc");
  assert.deepEqual(config.images, ["registry.example.org/judge-*", "exact:1"]);
  assert.throws(() => loadConfig({ ...base, BOGEY_RUNNER_CONCURRENCY: "0" }), /CONCURRENCY/);
  assert.throws(() => loadConfig({ ...base, BOGEY_RUNNER_MAX_MEMORY_MB: "lots" }), /MAX_MEMORY_MB/);
  assert.throws(() => loadConfig({ ...base, BOGEY_RUNNER_ID: "../x" }), /BOGEY_RUNNER_ID/);
  assert.throws(() => loadConfig({ ...base, BOGEY_RUNNER_RUNTIME: "a b" }), /RUNTIME/);
});

test("a backend that isn't built fails at startup instead of judging nothing", () => {
  assert.throws(() => loadConfig({ ...base, BOGEY_RUNNER_BACKEND: "piston" }), /isn't built/);
  assert.throws(() => loadConfig({ ...base, BOGEY_RUNNER_BACKEND: "wasm" }), /isn't built/);
});
