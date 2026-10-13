import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { expect, test } from "vite-plus/test";
import { findRepoRoot } from "../../src/lib/repo-root.ts";

const cliDir = fileURLToPath(new URL("../..", import.meta.url));

test("findRepoRoot finds the workspace root from a nested directory", () => {
  const root = findRepoRoot(cliDir);
  expect(existsSync(join(root, "pnpm-workspace.yaml"))).toBe(true);
});

test("findRepoRoot throws outside the workspace", () => {
  expect(() => findRepoRoot(tmpdir())).toThrow();
});
