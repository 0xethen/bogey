import { brand } from "@bogey/config";
import type { ThemeKey } from "@bogey/config/themes";

export const INSTANCE_THEME: ThemeKey = brand.theme ?? "default";

export function themeAttribute(theme: ThemeKey): string | undefined {
  return theme === "default" ? undefined : theme;
}
