import { useEffect, useState } from "react";
import { useExternalValue } from "@bogey/ui/hooks/external";
import { onlineManager, useQueryClient } from "@tanstack/react-query";
import { classify, requestErrorCode } from "@bogey/db/errors";

type Status = "online" | "offline" | "unreachable";

export const FAILURE_THRESHOLD = 2;
export const FAILURE_WINDOW_MS = 60_000;

const subscribeOnline = (onChange: () => void) => onlineManager.subscribe(() => onChange());
const isOffline = () => !onlineManager.isOnline();

// Only network failures count: a forbidden or missing row is an answer from the server.
export function isUnreachable(error: unknown): boolean {
  return (requestErrorCode(error) ?? classify(error)) === "unavailable";
}

export function recentFailures(failures: Tuple<number>, now: number): Tuple<number> {
  return failures.filter((at) => now - at < FAILURE_WINDOW_MS);
}

// When the warning should go away if nothing else fails, or null when it isn't showing.
export function clearsAt(failures: Tuple<number>): number | null {
  if (failures.length < FAILURE_THRESHOLD) return null;
  return failures[failures.length - FAILURE_THRESHOLD]! + FAILURE_WINDOW_MS;
}

// False on the server and during hydration, so the first render matches it.
export function useOffline(): boolean {
  return useExternalValue(subscribeOnline, isOffline, false);
}

export function useConnection(): Status {
  const queryClient = useQueryClient();
  const offline = useOffline();
  const [failures, setFailures] = useState<Tuple<number>>([]);

  useEffect(() => {
    const record = (action: { type: string; error?: unknown }) => {
      if (action.type === "success") {
        setFailures((current) => (current.length ? [] : current));
      } else if (action.type === "error" && isUnreachable(action.error)) {
        const now = Date.now();
        setFailures((current) => [...recentFailures(current, now), now]);
      }
    };
    const stopQueries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "updated") record(event.action);
    });
    const stopMutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === "updated") record(event.action);
    });
    return () => {
      stopQueries();
      stopMutations();
    };
  }, [queryClient]);

  useEffect(() => {
    const at = clearsAt(failures);
    if (at === null) return;
    const timer = setTimeout(
      () => setFailures((current) => recentFailures(current, Date.now())),
      Math.max(0, at - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [failures]);

  if (offline) return "offline";
  if (failures.length >= FAILURE_THRESHOLD) return "unreachable";
  return "online";
}
