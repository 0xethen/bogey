import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { imageHome } from "./image.ts";

export function findRepoRoot(startDir: string): string {
  let dir = startDir;

  for (let i = 0; i < 20; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const home = imageHome();
  if (home && existsSync(home)) return home;

  throw new Error(`Could not find pnpm-workspace.yaml above ${startDir}`);
}
