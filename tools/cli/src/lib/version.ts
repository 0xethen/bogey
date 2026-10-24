import { PLUGIN_API } from "@bogey/plugins/api";
import pkg from "../../../../package.json" with { type: "json" };
import { readLock } from "./plugin-install.ts";
import { currentVersion } from "./release-status.ts";
import { findRepoRoot } from "./repo-root.ts";

// read at build time, so the packed CLI in an image knows its own release
export const CLI_VERSION: string = pkg.version;

/** `bogey -v`: the CLI's release, the checkout's when it differs, the plugin API and plugins. */
export function versions(cwd: string): string {
  let root: string | null = null;
  try {
    root = findRepoRoot(cwd);
  } catch {
    root = null;
  }
  const lines = [`bogey ${CLI_VERSION}`];
  const checkout = root ? currentVersion(root) : null;
  if (checkout && checkout !== CLI_VERSION) lines.push(`checkout ${checkout} (${root})`);
  lines.push(`plugin API ${PLUGIN_API}`, `node ${process.versions.node}`);
  const plugins = root ? Object.entries(readLock(root)) : [];
  for (const [key, entry] of plugins) lines.push(`plugin ${key} ${entry.version}`);
  return lines.join("\n");
}
