import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { deleteCookie, getCookie, getRequestHeader, setCookie } from "@tanstack/react-start/server";
import { negotiateLocale, parseAcceptLanguage, SOURCE_LOCALE } from "@bogey/utils/locale";
import type { Messages, Missing } from "@bogey/utils/messages";
import {
  installedPlugins,
  loadPluginMessages,
  pluginLocales,
  pluginNamespace,
  type InstalledLocale,
} from "@bogey/plugins";
import { retryPolicy } from "@bogey/db/errors";
import { createServerClient } from "@bogey/db/server";
import { getOrgFn } from "@bogey/db/tenant";
import { jsonRecord } from "@bogey/db/types";

export interface Language extends InstalledLocale {
  source?: boolean;
}

export function availableLanguages(): Language[] {
  return [{ code: SOURCE_LOCALE, label: "English", source: true }, ...pluginLocales()];
}

export interface Localization {
  locale: string;
  overlay: Messages;
  missing: Missing;
  fallback: Messages;
  languages: Language[];
}

async function missingPolicy(
  codes: readonly string[],
  locale: string,
): Promise<{ missing: Missing; fallback: Messages }> {
  const plugin = installedPlugins().find((manifest) => (manifest.locales?.length ?? 0) > 0);
  if (!plugin) return { missing: "english", fallback: {} };
  let chosen: unknown;
  try {
    const org = await getOrgFn();
    const namespace = pluginNamespace(plugin);
    const { data } = await createServerClient().rpc("settings_for", {
      p_namespaces: [namespace],
      ...(org.ok && org.data ? { p_org: org.data.id } : {}),
    });
    chosen = jsonRecord(jsonRecord(data)[namespace]).missing;
  } catch {
    return { missing: "english", fallback: {} };
  }
  if (chosen === "key") return { missing: "key", fallback: {} };
  if (
    typeof chosen === "string" &&
    chosen !== locale &&
    chosen !== SOURCE_LOCALE &&
    codes.includes(chosen)
  ) {
    return { missing: "language", fallback: await loadPluginMessages(chosen) };
  }
  return { missing: "english", fallback: {} };
}

export const localizationFn = createServerFn({ method: "GET" })
  .validator((preferred: unknown) => (typeof preferred === "string" ? preferred : null))
  .handler(async ({ data: preferred }): Promise<Localization> => {
    const languages = availableLanguages();
    const codes = languages.map((language) => language.code);
    const locale = negotiateLocale(
      [preferred, getCookie("locale"), ...parseAcceptLanguage(getRequestHeader("accept-language"))],
      codes,
    );
    if (
      preferred &&
      locale !== getCookie("locale") &&
      negotiateLocale([preferred], codes) === locale
    ) {
      setCookie("locale", locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    }
    const policy = await missingPolicy(codes, locale);
    return {
      locale,
      overlay: locale === SOURCE_LOCALE ? {} : await loadPluginMessages(locale),
      ...policy,
      languages,
    };
  });

export const localizationQueryOptions = () =>
  queryOptions({
    queryKey: ["localization"] as const,
    queryFn: () => localizationFn({ data: null }),
    staleTime: Infinity,
    retry: retryPolicy,
  });

export const setLanguageFn = createServerFn({ method: "POST" })
  .validator((locale: unknown) => {
    if (locale === null) return null;
    const codes = availableLanguages().map((language) => language.code);
    if (typeof locale !== "string" || !codes.includes(locale)) {
      throw new Error("That language isn't installed.");
    }
    return locale;
  })
  .handler(async ({ data: locale }): Promise<null> => {
    if (locale === null) deleteCookie("locale", { path: "/" });
    else setCookie("locale", locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    return null;
  });
