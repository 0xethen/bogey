import { createContext, use, useState, type ReactNode } from "react";
import { useBlocker } from "@tanstack/react-router";
import {
  UnsavedRegistryContext,
  useUnsavedEntry,
  type UnsavedEntry,
  type UnsavedRegistry,
} from "@bogey/ui/lib/unsaved";
import { useShortcut } from "#/lib/shortcuts.ts";
import { useT } from "#/lib/translate.tsx";
import { SaveBar } from "./save-bar.tsx";

export interface UnsavedState {
  dirty: boolean;
  save: () => Promise<boolean>;
  attention: () => void;
  entries: Tuple<{ id: string; dirty: boolean; draft: boolean; within?: string }>;
}

const StateContext = createContext<UnsavedState | null>(null);

export function UnsavedChanges({ children }: { children: ReactNode }) {
  const t = useT();
  const [entries, setEntries] = useState<ReadonlyMap<string, UnsavedEntry>>(new Map());
  const [saving, setSaving] = useState(false);
  const [attention, setAttention] = useState(0);
  const [registry] = useState<UnsavedRegistry>(() => ({
    set: (id, entry) =>
      setEntries((current) => {
        const next = new Map(current);
        if (entry) next.set(id, entry);
        else next.delete(id);
        return next;
      }),
  }));

  const dirty = [...entries.values()].filter((entry) => entry.dirty);
  const savers = dirty.flatMap((entry) => (entry.save ? [entry.save] : []));
  if (dirty.length === 0 && attention !== 0) setAttention(0);

  const save = async () => {
    if (saving) return false;
    setSaving(true);
    try {
      const saved = (await Promise.all(savers.map((run) => run()))).every(Boolean);
      if (!saved) focusInvalid();
      return saved;
    } finally {
      setSaving(false);
    }
  };
  const reset = () => dirty.forEach((entry) => entry.reset());

  const state: UnsavedState = {
    dirty: dirty.length > 0,
    save,
    attention: () => setAttention((count) => count + 1),
    entries: [...entries].map(([id, entry]) => ({
      id,
      dirty: entry.dirty,
      draft: !entry.save,
      ...(entry.within === undefined ? {} : { within: entry.within }),
    })),
  };

  return (
    <UnsavedRegistryContext value={registry}>
      <StateContext value={state}>
        {children}
        <LeaveGuard />
        {savers.length > 0 || saving ? (
          <SaveBar
            visible
            saving={saving}
            message={attention > 0 ? t("unsaved.block") : t("unsaved.message")}
            attention={attention}
            onSave={() => void save()}
            onReset={reset}
          />
        ) : (
          <SaveBar
            visible={dirty.length > 0 && attention > 0}
            message={t("unsaved.draft")}
            attention={attention}
            onReset={reset}
            onDismiss={() => setAttention(0)}
          />
        )}
      </StateContext>
    </UnsavedRegistryContext>
  );
}

export function useUnsavedState(): UnsavedState | null {
  return use(StateContext);
}

function LeaveGuard() {
  const unsaved = useUnsavedState();
  const dirty = unsaved?.dirty ?? false;

  useBlocker({
    shouldBlockFn: ({ current, next }) => {
      if (!dirty || current.pathname === next.pathname) return false;
      // a draft whose page stays mounted at the next address isn't left behind
      const kept = (within: string | undefined) =>
        within !== undefined &&
        (next.pathname === within || next.pathname.startsWith(`${within}/`));
      if (unsaved?.entries.every((entry) => !entry.dirty || kept(entry.within))) return false;
      unsaved?.attention();
      return true;
    },
    enableBeforeUnload: () => dirty,
  });

  useShortcut(
    "save",
    () => {
      void unsaved?.save();
    },
    { enabled: dirty },
  );

  return null;
}

function focusInvalid() {
  const field = document.querySelector<HTMLElement>('[aria-invalid="true"]');
  field?.focus({ preventScroll: true });
  field?.scrollIntoView({ block: "center", behavior: "smooth" });
}

export function useDraft<T>(
  saved: T,
  save: (value: T) => Promise<boolean>,
  equal: (a: T, b: T) => boolean = Object.is,
): [T, (value: T) => void] {
  const [draft, setDraft] = useState<{ value: T } | null>(null);
  const dirty = draft !== null && !equal(draft.value, saved);
  useUnsavedEntry({
    dirty,
    save: async () => {
      if (!draft) return true;
      const done = await save(draft.value);
      if (done) setDraft(null);
      return done;
    },
    reset: () => setDraft(null),
  });
  return [draft !== null && dirty ? draft.value : saved, (value) => setDraft({ value })];
}
