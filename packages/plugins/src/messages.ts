import { useTranslator } from "@bogey/ui/lib/locale";
import type { Messages } from "@bogey/utils/messages";
import type { PluginManifest } from "./types.ts";

export function createPluginMessages<const M extends PluginManifest, const E extends Messages>(
  manifest: M,
  en: E,
) {
  const prefix = `${manifest.key}.`;

  function useT() {
    return useTranslator(en, prefix);
  }

  return { useT, messages: en };
}

export function prefixMessages(key: string, messages: Messages): Messages {
  return Object.fromEntries(
    Object.entries(messages).map(([name, text]) => [`${key}.${name}`, text]),
  );
}
