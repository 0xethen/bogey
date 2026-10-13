import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { createServerClient } from "@bogey/db/server";
import { fail, ok, retryPolicy, toFailure, unwrap, type DbResult } from "@bogey/db/errors";
import { can, getEventAccessFn } from "@bogey/db/permissions";
import { loadPluginMessages } from "@bogey/plugins";
import { translatedEmail } from "@bogey/utils/email-template";
import { sendTestEmail } from "#/lib/server/send-email.server.ts";

export interface EmailHookStatus {
  lastAt: string | null;
  last24h: number;
}

export const emailHookStatusFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<DbResult<EmailHookStatus>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase.rpc("email_hook_status");
    if (error) return toFailure(error, "checking the send-email hook");
    const status = typeof data === "object" && data !== null && !Array.isArray(data) ? data : {};
    return ok({
      lastAt: typeof status.lastAt === "string" ? status.lastAt : null,
      last24h: typeof status.last24h === "number" ? status.last24h : 0,
    });
  },
);

export interface TranslatedEmail {
  subject: string;
  body: string;
  reason: string | undefined;
}

export const emailTranslationsFn = createServerFn({ method: "GET" })
  .validator((locale: unknown) => {
    if (typeof locale !== "string" || !/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(locale)) {
      throw new Error("Unknown language");
    }
    return locale;
  })
  .handler(async ({ data: locale }): Promise<DbResult<Record<string, TranslatedEmail>>> => {
    const messages = await loadPluginMessages(locale);
    const translations: Record<string, TranslatedEmail> = {};
    for (const name of Object.keys(messages)) {
      const key = /^emailTemplate\.(.+)\.subject$/.exec(name)?.[1];
      const translated = key ? translatedEmail(messages, key) : undefined;
      if (key && translated) translations[key] = translated;
    }
    return ok(translations);
  });

export const emailTranslationsQueryOptions = (locale: string) =>
  queryOptions({
    queryKey: ["email-translations", locale] as const,
    queryFn: async () => unwrap(await emailTranslationsFn({ data: locale })),
    staleTime: Infinity,
    retry: retryPolicy,
  });

export const emailHookStatusQueryOptions = () =>
  queryOptions({
    queryKey: ["instance", "email-hook"] as const,
    queryFn: async () => unwrap(await emailHookStatusFn()),
    retry: retryPolicy,
  });

function kindOf(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9_-]*)*$/.test(value)) {
    throw new Error("Unknown email kind");
  }
  return value;
}

export const sendTestEmailFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as {
      kind?: unknown;
      orgId?: unknown;
      eventId?: unknown;
      locale?: unknown;
    };
    const orgId = typeof raw.orgId === "string" ? raw.orgId : undefined;
    const eventId = typeof raw.eventId === "string" ? raw.eventId : undefined;
    const locale =
      typeof raw.locale === "string" && /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(raw.locale)
        ? raw.locale
        : undefined;
    return {
      kind: kindOf(raw.kind),
      ...(orgId ? { orgId } : {}),
      ...(eventId ? { eventId } : {}),
      ...(locale ? { locale } : {}),
    };
  })
  .handler(async ({ data }): Promise<DbResult<{ to: string }>> => {
    const supabase = createServerClient();
    const { data: userData } = await supabase.auth.getUser();
    const to = userData.user?.email;
    if (!userData.user || !to) return fail("forbidden", "You need to be signed in.");

    if (data.eventId) {
      const access = await getEventAccessFn({ data: data.eventId });
      if (!access.ok || !can(access.data, "event.manage")) {
        return fail("forbidden", "Only an organizer can do that.");
      }
    } else if (data.orgId) {
      const { data: allowed, error } = await supabase.rpc("org_limits", { p_org: data.orgId });
      if (error || !allowed) return fail("forbidden", "Only an organization admin can do that.");
    } else {
      const { error } = await supabase.rpc("email_hook_status");
      if (error) return fail("forbidden", "Only an instance admin can do that.");
    }

    try {
      await sendTestEmail({
        to,
        kind: data.kind,
        ...(data.orgId ? { orgId: data.orgId } : {}),
        ...(data.eventId ? { eventId: data.eventId } : {}),
        ...(data.locale ? { locale: data.locale } : {}),
      });
    } catch (error) {
      return fail("unavailable", error instanceof Error ? error.message : "couldn't send it");
    }
    return ok({ to });
  });
