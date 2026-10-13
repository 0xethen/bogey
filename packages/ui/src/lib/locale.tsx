import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  createTranslator,
  type Messages,
  type Missing,
  type TranslatorOptions,
} from "@bogey/utils/messages";

export interface Translation {
  locale: string;
  overlay: Messages;
  missing: Missing;
  fallback: Messages;
}

const TranslationContext = createContext<Translation>({
  locale: "en",
  overlay: {},
  missing: "english",
  fallback: {},
});

export function LocaleProvider({
  children,
  locale,
  overlay = {},
  missing = "english",
  fallback = {},
}: Partial<Omit<Translation, "locale">> & { locale: string; children: ReactNode }) {
  const value = useMemo(
    () => ({ locale, overlay, missing, fallback }),
    [locale, overlay, missing, fallback],
  );
  return <TranslationContext value={value}>{children}</TranslationContext>;
}

export function useLocale(): string {
  return useContext(TranslationContext).locale;
}

export function useTranslation(): Translation {
  return useContext(TranslationContext);
}

export function useTranslator<const M extends Messages>(source: M, prefix = "") {
  const translation = useTranslation();
  return useMemo(() => {
    const options: TranslatorOptions = prefix
      ? {
          locale: translation.locale,
          overlay: unprefixed(translation.overlay, prefix),
          missing: translation.missing,
          fallback: unprefixed(translation.fallback, prefix),
        }
      : translation;
    return createTranslator(source, options);
  }, [source, prefix, translation]);
}

function unprefixed(messages: Messages, prefix: string): Messages {
  const out: Record<string, string> = {};
  for (const [key, text] of Object.entries(messages)) {
    if (key.startsWith(prefix)) out[key.slice(prefix.length)] = text;
  }
  return out;
}
