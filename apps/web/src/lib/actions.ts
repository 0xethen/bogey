import { useSyncExternalStore } from "react";
import { repository } from "@bogey/config";
import { parseRepository } from "@bogey/plugins/api";

export interface CommandAction {
  id: string;
  label: string;
  group: string;
  keywords?: Tuple<string>;
  run: () => void;
  external?: boolean;
}

const registered = new Map<string, CommandAction>();
let snapshot: CommandAction[] = [];
const listeners = new Set<() => void>();

function publish() {
  snapshot = [...registered.values()];
  for (const listener of [...listeners]) listener();
}

export function registerAction(action: CommandAction): () => void {
  registered.set(action.id, action);
  publish();
  return () => {
    if (registered.get(action.id) === action) {
      registered.delete(action.id);
      publish();
    }
  };
}

const EMPTY: CommandAction[] = [];

export function useRegisteredActions(): CommandAction[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
    () => EMPTY,
  );
}

export function issuesUrlFor(repo: string | null): string | null {
  const parsed = repo ? parseRepository(repo) : null;
  return parsed ? `${parsed.url}/issues/new` : null;
}

export const ISSUES_URL = issuesUrlFor(repository);

export type CommandMode = "all" | "actions" | "pages";

export function commandMode(search: string): { mode: CommandMode; query: string } {
  if (search.startsWith("/")) return { mode: "actions", query: search.slice(1).trimStart() };
  if (search.startsWith("#")) return { mode: "pages", query: search.slice(1).trimStart() };
  return { mode: "all", query: search };
}
