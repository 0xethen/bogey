import { createContext, use, useEffect, useId, useRef } from "react";

export interface UnsavedEntry {
  dirty: boolean;
  save?: () => Promise<boolean>;
  reset: () => void;
}

export interface UnsavedRegistry {
  set: (id: string, entry: UnsavedEntry | null) => void;
}

export const UnsavedRegistryContext = createContext<UnsavedRegistry | null>(null);

export function useUnsavedEntry({
  dirty,
  save,
  reset,
}: {
  dirty: boolean;
  save?: () => Promise<boolean>;
  reset: () => void;
}) {
  const registry = use(UnsavedRegistryContext);
  const id = useId();
  const latest = useRef({ save, reset });
  useEffect(() => {
    latest.current = { save, reset };
  });
  const savable = save !== undefined;
  useEffect(() => {
    if (!registry) return;
    registry.set(id, {
      dirty,
      save: savable ? async () => (await latest.current.save?.()) ?? false : undefined,
      reset: () => latest.current.reset(),
    });
    return () => registry.set(id, null);
  }, [registry, id, dirty, savable]);
}
