import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface PluginFolders {
  bundled: string;
  installed: string;
}

export function pluginFolders(root: string): PluginFolders {
  const plugins = join(root, "packages", "plugins");
  return { bundled: join(plugins, "bundled"), installed: join(plugins, "installed") };
}

function keysIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        existsSync(join(dir, entry.name, "manifest.ts")),
    )
    .map((entry) => entry.name)
    .sort();
}

export function bundledPluginKeys(root: string): string[] {
  return keysIn(pluginFolders(root).bundled);
}

export function pluginKeysOnDisk(root: string): string[] {
  const { bundled, installed } = pluginFolders(root);
  return [...new Set([...keysIn(bundled), ...keysIn(installed)])].sort();
}

export function pluginDir(root: string, key: string): string {
  const { bundled, installed } = pluginFolders(root);
  const shipped = join(bundled, key);
  return existsSync(join(shipped, "manifest.ts")) ? shipped : join(installed, key);
}

export function isBundled(root: string, key: string): boolean {
  return existsSync(join(pluginFolders(root).bundled, key, "manifest.ts"));
}
