import { useEffect, useId, useSyncExternalStore } from "react";

// Lets a plugin's event wrapper take over the whole event, tabs included: while any wrapper holds
// the chrome hidden, the event's tab row renders nothing.
const holders = new Set<string>();
const listeners = new Set<() => void>();

function change(update: () => void) {
  update();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Hides the event's tabs while `hidden` is true and this component is mounted. */
export function useHideEventChrome(hidden: boolean) {
  const id = useId();
  useEffect(() => {
    if (!hidden) return;
    change(() => holders.add(id));
    return () => change(() => holders.delete(id));
  }, [hidden, id]);
}

/** Whether a plugin has taken over the event, so its tabs should not render. */
export function useEventChromeHidden(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => holders.size > 0,
    () => false,
  );
}
