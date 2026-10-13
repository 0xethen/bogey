import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test } from "vite-plus/test";
import { runRestart, runStop } from "../../src/commands/stack.ts";
import type { ProcessResult, Runner } from "../../src/lib/migrations.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bogey-stack-"));
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
  mkdirSync(join(root, "deploy"));
  writeFileSync(join(root, "deploy", "compose.yml"), "services: {}\n");
});

function fake(result: Partial<ProcessResult> = {}) {
  const calls: string[][] = [];
  const run: Runner = (command, args) => {
    calls.push([command, ...args.map((arg) => arg.replace(root, "<root>"))]);
    return { status: 0, stdout: "", stderr: "", ...result };
  };
  return { run, calls };
}

test("restart restarts the web service by default", () => {
  const { run, calls } = fake();
  const result = runRestart(root, [], run);
  expect(result.exitCode).toBe(0);
  expect(calls).toEqual([
    ["docker", "compose", "-f", "<root>/deploy/compose.yml", "restart", "web"],
  ]);
  expect(result.output).toContain("Restarted web");
});

test("restart can name services, and --build rebuilds first", () => {
  const named = fake();
  runRestart(root, ["web", "caddy"], named.run);
  expect(named.calls[0]?.slice(-3)).toEqual(["restart", "web", "caddy"]);
  const built = fake();
  runRestart(root, ["--build"], built.run);
  expect(built.calls[0]?.slice(-4)).toEqual(["up", "-d", "--build", "web"]);
});

test("stop stops, or removes with --down", () => {
  const stop = fake();
  runStop(root, [], stop.run);
  expect(stop.calls[0]?.slice(-1)).toEqual(["stop"]);
  const down = fake();
  runStop(root, ["--down"], down.run);
  expect(down.calls[0]?.slice(-1)).toEqual(["down"]);
});

test("a missing docker says so", () => {
  const result = runRestart(root, [], fake({ status: null, stderr: "spawn docker ENOENT" }).run);
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("Couldn't run docker");
});

test("a failed compose command reports its output", () => {
  const result = runStop(root, [], fake({ status: 1, stderr: "no such service" }).run);
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("no such service");
});

test("unknown flags are refused", () => {
  expect(runRestart(root, ["--nope"], fake().run).exitCode).toBe(1);
  expect(runStop(root, ["--nope"], fake().run).exitCode).toBe(1);
});

test("without a compose file it says where it looked", () => {
  const bare = mkdtempSync(join(tmpdir(), "bogey-bare-"));
  writeFileSync(join(bare, "pnpm-workspace.yaml"), "packages: []\n");
  expect(runRestart(bare, [], fake().run).output).toContain("No deploy/compose.yml");
});
