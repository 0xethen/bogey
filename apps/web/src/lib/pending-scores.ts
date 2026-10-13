import { useSyncExternalStore } from "react";
import { requestFailure } from "@bogey/db/errors";
import { saveSheetFn, type SheetChanges } from "@bogey/db/queries/judging";
import { dequeue, parseQueue, queue, type Pending } from "@bogey/utils/pending";

const STORAGE_KEY = "bogey:pending-scores";

function isSheet(value: unknown): value is SheetChanges {
  if (!value || typeof value !== "object") return false;
  const sheet: Record<string, unknown> = { ...value };
  return (
    typeof sheet.eventId === "string" &&
    typeof sheet.submissionId === "string" &&
    Array.isArray(sheet.scores) &&
    typeof sheet.feedback === "string" &&
    (sheet.visibility === "team" || sheet.visibility === "judges") &&
    typeof sheet.done === "boolean"
  );
}

const listeners = new Set<() => void>();
let current: Pending<SheetChanges>[] | null = null;

function load(): Pending<SheetChanges>[] {
  if (current) return current;
  let text: string | null = null;
  try {
    text = localStorage.getItem(STORAGE_KEY);
  } catch {}
  current = parseQueue(text, isSheet);
  return current;
}

function save(next: Pending<SheetChanges>[]): void {
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    current = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function queueSheet(changes: SheetChanges): void {
  save(queue(load(), changes.submissionId, changes, Date.now()));
}

export function usePendingCount(): number {
  return useSyncExternalStore(
    subscribe,
    () => load().length,
    () => 0,
  );
}

export interface FlushResult {
  sent: number;
  refused: string[];
}

let flushing = false;

export async function flushPending(): Promise<FlushResult> {
  const result: FlushResult = { sent: 0, refused: [] };
  if (flushing) return result;
  flushing = true;
  try {
    for (const entry of [...load()].sort((a, b) => a.savedAt - b.savedAt)) {
      const outcome = await saveSheetFn({ data: entry.value }).catch(requestFailure);
      if (outcome.ok) {
        result.sent += 1;
      } else if (outcome.error.code === "unavailable") {
        break;
      } else {
        result.refused.push(outcome.error.message);
      }
      save(dequeue(load(), entry.key));
    }
  } finally {
    flushing = false;
  }
  return result;
}
