import { normalizeHotkey, validateHotkey, type HotkeyChord } from "@tanstack/react-hotkeys";
import type { T } from "#/lib/translate.tsx";

const RESERVED: ReadonlySet<string> = new Set(
  [
    "Mod+T",
    "Mod+W",
    "Mod+N",
    "Mod+R",
    "Mod+L",
    "Mod+Q",
    "Mod+Shift+T",
    "Mod+Shift+N",
    "Mod+Tab",
    "F5",
  ].map((keys) => normalizeHotkey(keys as HotkeyChord)),
);

export interface Binding {
  id: string;
  name: string;
  keys: HotkeyChord | null;
}

export function bindingProblem(
  keys: HotkeyChord,
  ownId: string,
  all: Tuple<Binding>,
  t: T,
): string | null {
  const wanted = normalizeHotkey(keys);
  if (!validateHotkey(keys).valid) return t("shortcuts.invalid");
  if (RESERVED.has(wanted)) return t("shortcuts.reserved");
  const taken = all.find(
    (other) => other.id !== ownId && other.keys !== null && normalizeHotkey(other.keys) === wanted,
  );
  return taken ? t("shortcuts.taken", { name: taken.name }) : null;
}
