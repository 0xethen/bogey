import { useEffect, type ReactNode } from "react";
import { usePreference } from "@bogey/db/queries/preferences";
import type { Json } from "@bogey/db/types";
import type { PlainKey } from "#/lib/translate.tsx";
import { MarkdownPreferencesProvider, type SpoilerMode } from "@bogey/ui/lib/markdown-preferences";

export const TEXT_SIZES: Tuple<{ value: string; label: PlainKey; percent: number }> = [
  { value: "small", label: "a11y.sizeSmall", percent: 90 },
  { value: "default", label: "a11y.sizeDefault", percent: 100 },
  { value: "large", label: "a11y.sizeLarge", percent: 115 },
  { value: "larger", label: "a11y.sizeLarger", percent: 130 },
  { value: "largest", label: "a11y.sizeLargest", percent: 150 },
];
export type TextSize = (typeof TEXT_SIZES)[number]["value"];

export const FONTS = [
  { value: "default", label: "a11y.fontDefault" },
  { value: "system", label: "a11y.fontSystem" },
  { value: "readable", label: "a11y.fontReadable" },
  { value: "dyslexia", label: "a11y.fontDyslexia" },
  { value: "serif", label: "a11y.fontSerif" },
  { value: "mono", label: "a11y.fontMono" },
] as const satisfies Tuple<{ value: string; label: PlainKey }>;
export type FontChoice = (typeof FONTS)[number]["value"];

export const SPOILER_MODES: Tuple<{
  value: SpoilerMode;
  label: PlainKey;
  description: PlainKey;
}> = [
  { value: "click", label: "a11y.spoilerClick", description: "a11y.spoilerClickHelp" },
  { value: "hold", label: "a11y.spoilerHold", description: "a11y.spoilerHoldHelp" },
  { value: "visible", label: "a11y.spoilerVisible", description: "a11y.spoilerVisibleHelp" },
];

const isTextSize = (raw: Json): raw is TextSize => TEXT_SIZES.some((size) => size.value === raw);
const isFont = (raw: Json): raw is FontChoice => FONTS.some((font) => font.value === raw);
const isSpoilerMode = (raw: Json): raw is SpoilerMode =>
  SPOILER_MODES.some((mode) => mode.value === raw);
const isBoolean = (raw: Json): raw is boolean => typeof raw === "boolean";

export const useTextSizePreference = () =>
  usePreference<TextSize>("core", "text_size", "default", isTextSize);
export const useFontPreference = () => usePreference<FontChoice>("core", "font", "default", isFont);
export const useSpoilerPreference = () =>
  usePreference<SpoilerMode>("core", "spoilers", "click", isSpoilerMode);
export const useCodeLineNumbersPreference = () =>
  usePreference<boolean>("core", "code_line_numbers", true, isBoolean);
export const useWideSpacingPreference = () =>
  usePreference<boolean>("core", "wide_spacing", false, isBoolean);
export const useReduceMotionPreference = () =>
  usePreference<boolean>("core", "reduce_motion", false, isBoolean);
export const useUnderlineLinksPreference = () =>
  usePreference<boolean>("core", "underline_links", false, isBoolean);
export const useMoreContrastPreference = () =>
  usePreference<boolean>("core", "more_contrast", false, isBoolean);

const FLAGS = [
  { attribute: "spacing", on: "wide" },
  { attribute: "motion", on: "reduce" },
  { attribute: "links", on: "underline" },
  { attribute: "contrast", on: "more" },
] as const;

export function AccessibilityPreferences({ children }: { children: ReactNode }) {
  const size = useTextSizePreference().value;
  const font = useFontPreference().value;
  const spoilers = useSpoilerPreference().value;
  const codeLineNumbers = useCodeLineNumbersPreference().value;
  const spacing = useWideSpacingPreference().value;
  const motion = useReduceMotionPreference().value;
  const links = useUnderlineLinksPreference().value;
  const contrast = useMoreContrastPreference().value;

  useEffect(() => {
    const root = document.documentElement;
    const percent = TEXT_SIZES.find((item) => item.value === size)?.percent ?? 100;
    root.style.fontSize = percent === 100 ? "" : `${percent}%`;
    if (font === "default") delete root.dataset.font;
    else root.dataset.font = font;
    return () => {
      root.style.fontSize = "";
      delete root.dataset.font;
    };
  }, [size, font]);

  useEffect(() => {
    const root = document.documentElement;
    const on = [spacing, motion, links, contrast];
    FLAGS.forEach((flag, index) => {
      if (on[index]) root.dataset[flag.attribute] = flag.on;
      else delete root.dataset[flag.attribute];
    });
    return () => FLAGS.forEach((flag) => delete root.dataset[flag.attribute]);
  }, [spacing, motion, links, contrast]);

  return (
    <MarkdownPreferencesProvider value={{ spoilers, codeLineNumbers }}>
      {children}
    </MarkdownPreferencesProvider>
  );
}
