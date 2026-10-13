import type { ReactNode } from "react";
import { IconPalette } from "@tabler/icons-react";
import { brand } from "@bogey/config";
import { THEMES, type ThemeKey } from "@bogey/config/themes";
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@bogey/ui/components/dropdown-menu";
import { useExternalValue } from "@bogey/ui/hooks/external";
import { definePluginRuntime } from "@bogey/plugins/runtime";
import { manifest } from "./manifest.ts";

const KEY = "bogey:theme";
const CHANGE_EVENT = "bogey:theme-change";
const INSTANCE: ThemeKey = brand.theme ?? "default";

const applyStored = `(function() {
  try {
    var theme = localStorage.getItem(${JSON.stringify(KEY)});
    if (!theme) return;
    if (theme === "default") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
  } catch (e) {}
})();`;

function readTheme(): ThemeKey {
  try {
    const stored = localStorage.getItem(KEY);
    return THEMES.find((theme) => theme.key === stored)?.key ?? INSTANCE;
  } catch {
    return INSTANCE;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function setTheme(next: ThemeKey): void {
  try {
    if (next === INSTANCE) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {}
  if (next === "default") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", next);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function ApplyTheme({ children }: { children: ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: applyStored }} />
      {children}
    </>
  );
}

function ThemeMenu() {
  const theme = useExternalValue(subscribe, readTheme, INSTANCE);
  if (THEMES.length < 2) return null;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <IconPalette />
        Theme
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => {
            const next = THEMES.find((option) => option.key === value);
            if (next) setTheme(next.key);
          }}
        >
          {THEMES.map((option) => (
            <DropdownMenuRadioItem key={option.key} value={option.key}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

export default definePluginRuntime(manifest, {
  slots: { wrapper: ApplyTheme, accountMenu: ThemeMenu },
});
