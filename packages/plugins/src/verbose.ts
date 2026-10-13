import { useExternalValue } from "@bogey/ui/hooks/external";

const KEY = "bogey:verbose";
const CHANGE_EVENT = "bogey:verbose-change";

export function isVerbose(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(KEY) === "1";
}

export function setVerbose(next: boolean): void {
  if (typeof localStorage === "undefined") return;
  if (next) localStorage.setItem(KEY, "1");
  else localStorage.removeItem(KEY);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribeVerbose(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useVerbose(): readonly [boolean, (next: boolean) => void] {
  return [useExternalValue(subscribeVerbose, isVerbose, false), setVerbose] as const;
}
