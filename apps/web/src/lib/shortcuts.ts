import {
  normalizeHotkey,
  useHotkey,
  validateHotkey,
  type HotkeyChord,
  type HotkeyCallback,
  type UseHotkeyOptions,
} from "@tanstack/react-hotkeys";
import { usePreference } from "@bogey/db/queries/preferences";
import type { Json } from "@bogey/db/types";
import { installedPlugins, type PluginHotkeyDeclaration } from "@bogey/plugins";
import type { Binding } from "./shortcut-conflicts.ts";
import { sayOr, useT } from "./translate.tsx";

export type ShortcutGroup = "General" | "Editing";

export interface ShortcutDefinition {
  name: string;
  description: string;
  group: ShortcutGroup;
  keys: HotkeyChord;
}

export const SHORTCUTS = {
  command_menu: {
    name: "Command menu",
    description: "Find any page, event or action",
    group: "General",
    keys: "Mod+K",
  },
  shortcuts: {
    name: "Keyboard shortcuts",
    description: "Lists the shortcuts this page has",
    group: "General",
    keys: "Mod+/",
  },
  save: {
    name: "Save changes",
    description: "Saves changes to fields (contextual)",
    group: "Editing",
    keys: "Mod+S",
  },
} as const satisfies Record<string, ShortcutDefinition>;

export type ShortcutId = keyof typeof SHORTCUTS;

export const SHORTCUT_IDS = Object.keys(SHORTCUTS).filter(
  (id): id is ShortcutId => id in SHORTCUTS,
);

const isBinding = (raw: Json): raw is string | false => raw === false || typeof raw === "string";

function useBinding(namespace: string, key: string, fallback: HotkeyChord | null) {
  const preference = usePreference<string | false>(namespace, key, fallback ?? false, isBinding);
  const stored = preference.value;
  const keys: HotkeyChord | null =
    stored === false ? null : validateHotkey(stored).valid ? normalizeHotkey(stored) : fallback;
  const custom = keys === null ? fallback !== null : keys !== normalizeHotkey(fallback ?? keys);
  const set = (next: HotkeyChord | null) => preference.set(next ?? false);
  return { keys, set, custom, error: preference.error, fallback };
}

export function useBindings(): Binding[] {
  const t = useT();
  const bindings: Binding[] = SHORTCUT_IDS.map((id) => ({
    id: `core.${id}`,
    name: sayOr(t, `shortcut.${id}`, SHORTCUTS[id].name),
    // eslint-disable-next-line react-hooks/rules-of-hooks
    keys: useShortcutKeys(id).keys,
  }));
  for (const manifest of installedPlugins()) {
    for (const hotkey of manifest.hotkeys ?? []) {
      bindings.push({
        id: `${manifest.key}.${hotkey.id}`,
        name: `${manifest.name}: ${hotkey.label}`,
        // eslint-disable-next-line react-hooks/rules-of-hooks
        keys: usePluginShortcutKeys(manifest.key, hotkey).keys,
      });
    }
  }
  return bindings;
}

export function useShortcutKeys(id: ShortcutId) {
  return useBinding("core", `shortcut_${id}`, SHORTCUTS[id].keys);
}

export function usePluginShortcutKeys(plugin: string, hotkey: PluginHotkeyDeclaration) {
  const fallback = validateHotkey(hotkey.keys).valid ? normalizeHotkey(hotkey.keys) : null;
  return useBinding(plugin, `shortcut_${hotkey.id}`, fallback);
}

export function useShortcut(id: ShortcutId, callback: HotkeyCallback, options?: UseHotkeyOptions) {
  const t = useT();
  const { keys } = useShortcutKeys(id);
  const shortcut = SHORTCUTS[id];
  useHotkey(keys ?? shortcut.keys, callback, {
    ...options,
    enabled: keys !== null && (options?.enabled ?? true),
    meta: {
      name: sayOr(t, `shortcut.${id}`, shortcut.name),
      description: sayOr(t, `shortcut.${id}.help`, shortcut.description),
      group: shortcut.group,
    },
  });
}
