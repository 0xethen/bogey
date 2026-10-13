import { disabledPlugins } from "@bogey/config";
import { en } from "@bogey/config/messages";
import { isPluginAnswerKind, setPluginAnswerValidatorLoader } from "@bogey/utils/answers";
import type { Messages } from "@bogey/utils/messages";
import { incompatibility } from "./api.ts";
import { prefixMessages } from "./messages.ts";
import type { PluginManifest } from "./types.ts";
import type {
  PluginActionHandler,
  PluginItemType,
  PluginRuntime,
  PluginSlots,
} from "./runtime.tsx";

const manifestModules = import.meta.glob<{ default: PluginManifest }>(
  ["../bundled/*/manifest.ts", "../installed/*/manifest.ts"],
  { eager: true },
);

const runtimeModules = import.meta.glob<{ default: PluginRuntime }>([
  "../bundled/*/runtime.tsx",
  "../installed/*/runtime.tsx",
]);

function locate(path: string): { from: "bundled" | "installed"; key: string } {
  const [, from, key = ""] = path.split("/");
  return { from: from === "bundled" ? "bundled" : "installed", key };
}

const bundledKeys = new Set(
  Object.keys(manifestModules)
    .map(locate)
    .filter((entry) => entry.from === "bundled")
    .map((entry) => entry.key),
);

export function isBundledPlugin(key: string): boolean {
  return bundledKeys.has(key);
}

function runtimePath(key: string): string {
  return `../${isBundledPlugin(key) ? "bundled" : "installed"}/${key}/runtime.tsx`;
}

export const availablePlugins: Tuple<PluginManifest> = Object.entries(manifestModules)
  .map(([path, module]) => ({ ...locate(path), manifest: module.default }))
  .filter((entry) => {
    if (entry.from === "installed" && bundledKeys.has(entry.key)) {
      console.error(
        `[bogey] plugin "${entry.key}" ships with Bogey; skipping the copy in packages/plugins/installed.`,
      );
      return false;
    }
    if (entry.key === entry.manifest.key) return true;
    console.error(
      `[bogey] plugin folder "${entry.key}" declares key "${entry.manifest.key}"; skipping it.`,
    );
    return false;
  })
  .map((entry) => entry.manifest)
  .sort((a, b) => a.key.localeCompare(b.key));

const blocked = new Map<string, string>();
for (const manifest of availablePlugins) {
  const problem = incompatibility(manifest);
  if (problem) blocked.set(manifest.key, problem);
}
for (let changed = true; changed;) {
  changed = false;
  for (const manifest of availablePlugins) {
    if (blocked.has(manifest.key)) continue;
    const missing = (manifest.requires ?? []).filter(
      (key) =>
        blocked.has(key) ||
        disabledPlugins.includes(key) ||
        !availablePlugins.some((other) => other.key === key),
    );
    if (missing.length === 0) continue;
    blocked.set(
      manifest.key,
      `needs ${missing.map((key) => `the ${key} plugin`).join(" and ")}, which ${missing.length === 1 ? "isn't" : "aren't"} installed and on.`,
    );
    changed = true;
  }
}
for (const [key, problem] of blocked) {
  console.error(`[bogey] plugin "${key}" ${problem} Skipping it.`);
}

export function installedPlugins(): PluginManifest[] {
  return availablePlugins.filter(
    (manifest) => !disabledPlugins.includes(manifest.key) && !blocked.has(manifest.key),
  );
}

export type PluginStatus = "on" | "disabled" | "incompatible";

export function pluginStatuses(): {
  manifest: PluginManifest;
  status: PluginStatus;
  detail?: string;
}[] {
  return availablePlugins.map((manifest) => {
    const problem = blocked.get(manifest.key);
    if (problem) return { manifest, status: "incompatible", detail: problem };
    if (disabledPlugins.includes(manifest.key)) {
      return {
        manifest,
        status: "disabled",
        detail: "Listed in bogey.config.ts `disabledPlugins`.",
      };
    }
    return { manifest, status: "on" };
  });
}

export function findPlugin(key: string): PluginManifest | undefined {
  return installedPlugins().find((manifest) => manifest.key === key);
}

const runtimes = new Map<string, Promise<PluginRuntime | undefined>>();
const loaded = new Map<string, PluginRuntime>();

export function loadPluginRuntime(key: string): Promise<PluginRuntime | undefined> {
  const cached = runtimes.get(key);
  if (cached) return cached;
  const load = findPlugin(key) ? runtimeModules[runtimePath(key)] : undefined;
  const runtime = load
    ? load().then((module) => {
        loaded.set(key, module.default);
        return module.default;
      })
    : Promise.resolve(undefined);
  runtimes.set(key, runtime);
  return runtime;
}

export function loadedPluginRuntime(key: string): PluginRuntime | undefined {
  return loaded.get(key);
}

const pluginOf = (kind: string) => kind.slice(0, kind.indexOf("."));

export function pluginItemType(kind: string): PluginItemType | undefined {
  return isPluginAnswerKind(kind) ? loaded.get(pluginOf(kind))?.itemTypes[kind] : undefined;
}

setPluginAnswerValidatorLoader(async (kind) => {
  try {
    await loadPluginRuntime(pluginOf(kind));
  } catch (error) {
    console.error(`[bogey] plugin "${pluginOf(kind)}" failed to load:`, error);
  }
});

export interface LoadedSlots {
  key: string;
  manifest: PluginManifest;
  slots: PluginSlots;
  actions: Record<string, PluginActionHandler>;
}

let slots: Promise<LoadedSlots[]> | undefined;
let loadedSlots: LoadedSlots[] = [];

export function pluginSlots(): Promise<LoadedSlots[]> {
  slots ??= loadPluginSlots().then((loaded) => (loadedSlots = loaded));
  return slots;
}

export function loadedPluginSlots(): LoadedSlots[] {
  return loadedSlots;
}

export async function loadPluginSlots(): Promise<LoadedSlots[]> {
  const loaded = await Promise.all(
    installedPlugins().map(async (manifest): Promise<LoadedSlots | null> => {
      try {
        const runtime = await loadPluginRuntime(manifest.key);
        if (!runtime) return null;
        if (Object.keys(runtime.slots).length === 0 && Object.keys(runtime.actions).length === 0) {
          return null;
        }

        return { key: manifest.key, manifest, slots: runtime.slots, actions: runtime.actions };
      } catch (error) {
        console.error(`[bogey] plugin "${manifest.key}" failed to load:`, error);
        return null;
      }
    }),
  );

  return loaded.filter((entry): entry is LoadedSlots => entry !== null);
}

export interface InstalledLocale {
  code: string;
  label: string;
}

export function pluginLocales(): InstalledLocale[] {
  const seen = new Set<string>();
  return installedPlugins().flatMap((manifest) =>
    (manifest.locales ?? []).filter((locale) => {
      if (seen.has(locale.code)) return false;
      seen.add(locale.code);
      return true;
    }),
  );
}

function translatable(key: string): boolean {
  if (Object.hasOwn(en, key)) return true;
  const owner = installedPlugins().find((manifest) => key.startsWith(`${manifest.key}.`));
  return !owner || owner.shares?.messages === true;
}

export async function loadPluginMessages(locale: string): Promise<Messages> {
  const merged: Record<string, string> = {};
  for (const manifest of installedPlugins()) {
    const translatesBogey = manifest.locales?.some((each) => each.code === locale) ?? false;
    const translatesItself = manifest.translations?.includes(locale) ?? false;
    if (!translatesBogey && !translatesItself) continue;
    try {
      const runtime = await loadPluginRuntime(manifest.key);
      const [catalog, own] = await Promise.all([
        translatesBogey ? runtime?.catalogs[locale]?.() : undefined,
        translatesItself ? runtime?.messages[locale]?.() : undefined,
      ]);
      for (const [key, text] of Object.entries(catalog ?? {})) {
        if (translatable(key)) merged[key] ??= text;
      }
      Object.assign(merged, prefixMessages(manifest.key, own ?? {}));
    } catch (error) {
      console.error(
        `[bogey] plugin "${manifest.key}" couldn't load its ${locale} messages:`,
        error,
      );
    }
  }
  return merged;
}
