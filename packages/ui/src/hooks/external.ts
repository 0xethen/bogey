import { useSyncExternalStore } from "react";

export function useExternalValue<T>(
  subscribe: (onChange: () => void) => () => void,
  read: () => T,
  fallback: T,
): T {
  return useSyncExternalStore(subscribe, read, () => fallback);
}
