import { useSyncExternalStore } from "react";

export function nowStore(interval: number) {
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    timer = setTimeout(
      () => {
        for (const listener of [...listeners]) listener();
        schedule();
      },
      interval - (Date.now() % interval) + 5,
    );
  };
  return {
    subscribe: (onChange: () => void) => {
      listeners.add(onChange);
      if (listeners.size === 1) schedule();
      return () => {
        listeners.delete(onChange);
        if (listeners.size === 0) clearTimeout(timer);
      };
    },
    snapshot: () => Math.floor(Date.now() / interval) * interval,
  };
}

const nowStores = new Map<number, ReturnType<typeof nowStore>>();

export function useNow(interval = 60_000): number | null {
  let store = nowStores.get(interval);
  if (!store) {
    store = nowStore(interval);
    nowStores.set(interval, store);
  }
  return useSyncExternalStore(store.subscribe, store.snapshot, () => null);
}
