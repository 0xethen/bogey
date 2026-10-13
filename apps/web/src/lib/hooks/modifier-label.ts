import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

export function useModifierLabel(): string {
  return useSyncExternalStore(
    noSubscribe,
    () => (/Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl "),
    () => "⌘",
  );
}
