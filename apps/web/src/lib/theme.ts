import { viewTransition } from "@bogey/ui/lib/utils";
import { useEffect } from "react";
import { useExternalValue } from "@bogey/ui/hooks/external";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = Exclude<Theme, "system">;

const DEFAULT_THEME: ResolvedTheme = "light";

export const initTheme = `(function() {
  try {
    const theme = localStorage.getItem('theme') || 'system';
    const resolved = theme === "system"
      ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;
    document.documentElement.classList.add(resolved);
  } catch (e) {}
})();`;

const THEMES: Tuple<Theme> = ["light", "dark", "system"];
const CHANGE_EVENT = "bogey:theme";

function storedTheme(): Theme {
  const value = localStorage.getItem("theme");
  return THEMES.find((theme) => theme === value) ?? "system";
}

function subscribeStored(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function prefersDark(): boolean {
  return matchMedia("(prefers-color-scheme: dark)").matches;
}

function subscribeScheme(onChange: () => void): () => void {
  const query = matchMedia("(prefers-color-scheme: dark)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function resolve(theme: Theme, dark: boolean): ResolvedTheme {
  if (theme !== "system") return theme;
  return dark ? "dark" : "light";
}

function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.classList.remove("light", "dark");
  document.documentElement.classList.add(resolved);
}

export function useTheme() {
  const theme = useExternalValue(subscribeStored, storedTheme, "system");
  const dark = useExternalValue(subscribeScheme, prefersDark, DEFAULT_THEME === "dark");
  const resolvedTheme = resolve(theme, dark);

  useEffect(() => {
    if (storedTheme() === "system") viewTransition(() => applyTheme(resolve("system", dark)));
  }, [dark]);

  const setTheme = (next: Theme) => {
    localStorage.setItem("theme", next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
    viewTransition(() => applyTheme(resolve(next, prefersDark())));
  };

  return { theme, resolvedTheme, setTheme };
}

export function previewTheme(next: Theme | null): void {
  viewTransition(() => applyTheme(resolve(next ?? storedTheme(), prefersDark())));
}
