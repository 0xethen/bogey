import { useMemo, type ReactNode } from "react";
import { en, type MessageKey } from "@bogey/config/messages";
import {
  createTranslator,
  formatMessage,
  messageParams,
  type ParamArgs,
  type Messages,
  type Missing,
  type Say,
} from "@bogey/utils/messages";
import {
  LocaleProvider,
  useTranslation,
  useTranslator,
  type Translation,
} from "@bogey/ui/lib/locale";

export function I18nProvider({ children, ...translation }: Translation & { children: ReactNode }) {
  return <LocaleProvider {...translation}>{children}</LocaleProvider>;
}

export function useT() {
  return useTranslator(en);
}

export type T = ReturnType<typeof useT>;

export type PlainKey = {
  [K in MessageKey]: ParamArgs<(typeof en)[K]> extends [] ? K : never;
}[MessageKey];

export type Text = string | { message: PlainKey };

export function msg(message: PlainKey): Text {
  return { message };
}

export function sayWith(t: T): (text: Text) => string {
  return (text) => (typeof text === "string" ? text : t(text.message));
}

export function useSay(): (text: Text) => string {
  const t = useT();
  return useMemo(() => sayWith(t), [t]);
}

export function useHelperSay(): Say {
  const translation = useTranslation();
  return useMemo(
    () =>
      (key, english, values = {}) => {
        const message =
          translation.overlay[key] ??
          (translation.missing === "language" ? translation.fallback[key] : undefined) ??
          english;
        try {
          return formatMessage(message, values, translation.locale);
        } catch {
          return formatMessage(english, values);
        }
      },
    [translation],
  );
}

const PLAIN_KEYS: ReadonlySet<string> = new Set(
  Object.entries(en)
    .filter(([, text]) => messageParams(text).length === 0)
    .map(([key]) => key),
);

function isPlainKey(key: string): key is PlainKey {
  return PLAIN_KEYS.has(key);
}

export function sayOr(t: T, key: string, fallback: string): string {
  return isPlainKey(key) ? t(key) : fallback;
}

export function translatorFor(
  localization:
    | { locale: string; overlay: Messages; missing?: Missing; fallback?: Messages }
    | undefined,
): T {
  return createTranslator(en, localization ?? { locale: "en", overlay: {} });
}
