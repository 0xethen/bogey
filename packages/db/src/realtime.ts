import { useEffect, useId } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { Database } from "./types.ts";
import { browserClient } from "./browser.ts";

type CoreTable = keyof Database["public"]["Tables"];

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
    const channel = supabase
      .channel(`live:${table}:${filter ?? "*"}:${key}:${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table, filter }, () => {
        void queryClient.invalidateQueries({ queryKey: JSON.parse(key) as QueryKey });
      })
      .subscribe();
    return () => {
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
    return listen(topic, () => {
      void queryClient.invalidateQueries({ queryKey: JSON.parse(key) as QueryKey });
    });
  }, [topic, key, enabled, queryClient]);
}
