import { useEffect, useId } from "react";
import { useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { Throttler } from "@tanstack/pacer";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { Database } from "./types.ts";
import { browserClient } from "./browser.ts";

type CoreTable = keyof Database["public"]["Tables"];

const LIVE_WAIT_MS = 1_000;

function throttledInvalidate(queryClient: QueryClient, key: string) {
  return new Throttler(
    () => void queryClient.invalidateQueries({ queryKey: JSON.parse(key) as QueryKey }),
    { wait: LIVE_WAIT_MS, leading: true, trailing: true },
  );
}

export function useLiveInvalidate(
  table: CoreTable | (string & Record<never, never>),
  queryKey: QueryKey,
  { filter, enabled = true }: { filter?: string; enabled?: boolean } = {},
): void {
  const queryClient = useQueryClient();
  const key = JSON.stringify(queryKey);
  const id = useId();

  useEffect(() => {
    if (!enabled) return;
    const supabase = browserClient();
    const invalidate = throttledInvalidate(queryClient, key);
    const channel = supabase
      .channel(`live:${table}:${filter ?? "*"}:${key}:${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table, filter }, () =>
        invalidate.maybeExecute(),
      )
      .subscribe();
    return () => {
      invalidate.cancel();
      void supabase.removeChannel(channel);
    };
  }, [table, filter, key, id, enabled, queryClient]);
}

const broadcasts = new Map<string, { channel: RealtimeChannel; listeners: Set<() => void> }>();

function listen(topic: string, listener: () => void): () => void {
  let entry = broadcasts.get(topic);
  if (!entry) {
    const listeners = new Set<() => void>();
    const channel = browserClient()
      .channel(topic, { config: { broadcast: { self: false }, private: false } })
      .on("broadcast", { event: "changed" }, () => listeners.forEach((each) => each()))
      .subscribe();
    entry = { channel, listeners };
    broadcasts.set(topic, entry);
  }
  entry.listeners.add(listener);
  const { channel, listeners } = entry;
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    broadcasts.delete(topic);
    void browserClient().removeChannel(channel);
  };
}

export function useLiveBroadcast(
  topic: string,
  queryKey: QueryKey,
  { enabled = true }: { enabled?: boolean } = {},
): void {
  const queryClient = useQueryClient();
  const key = JSON.stringify(queryKey);

  useEffect(() => {
    if (!enabled) return;
    const invalidate = throttledInvalidate(queryClient, key);
    const stop = listen(topic, () => invalidate.maybeExecute());
    return () => {
      invalidate.cancel();
      stop();
    };
  }, [topic, key, enabled, queryClient]);
}
