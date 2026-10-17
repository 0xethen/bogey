import { createHmac, timingSafeEqual } from "node:crypto";
import { createTransport } from "nodemailer";
import { getRequestHeader } from "@tanstack/react-start/server";
import { createAdminClient } from "@bogey/db/admin";
import { jsonRecord, type Json } from "@bogey/db/types";
import { authEmailTemplates, brand } from "@bogey/config";
import { authKindOf } from "@bogey/config/resolve";
import {
  AUTH_EMAIL_KEYS,
  EMAIL_KIND_KEYS,
  EMAIL_KINDS,
  type EmailKind,
  type EmailTemplateKey,
} from "@bogey/config/email";
import { findPluginEmailKind } from "#/lib/server/plugin-emails.server.ts";
import { resolveSettings, type SettingsValue } from "@bogey/config/settings";
import { DEFAULT_EMAIL_LAYOUT } from "@bogey/utils/email-layout";
import {
  footerWords,
  pickTemplate,
  renderEmail,
  translatedEmail,
  type EmailFooterWords,
  type RenderedEmail,
} from "@bogey/utils/email-template";
import type { Messages } from "@bogey/utils/messages";
import { loadPluginMessages } from "@bogey/plugins";

export interface SendEmailPayload {
  user: {
    id?: string;
    email: string;
    new_email?: string;
    user_metadata?: { [key: string]: Json | undefined };
  };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: string;
    token_new?: string;
    token_hash_new?: string;
  };
}

export class HookError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly userMessage?: string,
  ) {
    super(message);
  }
}

export function verifyHook(body: string, headers: Headers, secret: string): void {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatures = headers.get("webhook-signature");
  if (!id || !timestamp || !signatures) throw new HookError("missing signature headers", 401);

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 5 * 60) throw new HookError("stale request", 401);

  const key = Buffer.from(secret.replace(/^v1,/, "").replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  const matches = signatures.split(" ").some((entry) => {
    const [version, value] = entry.split(",");
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!matches) throw new HookError("bad signature", 401);
}

function text(value: Json | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export interface EmailContext {
  orgId: string | undefined;
  orgName: string;
  platform: string;
  senderName: string;
  accent: string | undefined;
  layout: string;
  templates: NonNullable<SettingsValue<"email">["templates"]>;
}

interface SettingsRow {
  scope: string;
  org_id: string | null;
  event_id?: string | null;
  namespace: string;
  value: Json;
}

export function emailContext(
  org: { id: string; name: string } | null,
  rows: Tuple<SettingsRow>,
  eventId?: string,
): EmailContext {
  const find = (namespace: string, scope: string) =>
    jsonRecord(
      rows.find(
        (row) =>
          row.namespace === namespace &&
          row.scope === scope &&
          (scope !== "event" || row.event_id === eventId),
      )?.value,
    );
  const merged = (namespace: string) => ({
    ...find(namespace, "instance"),
    ...(org ? find(namespace, "org") : {}),
  });
  const instanceEmail = find("email", "instance");
  const ownEmail = org ? find("email", "org") : {};
  const eventEmail = org && eventId ? find("email", "event") : {};
  const email = resolveSettings("email", {
    ...instanceEmail,
    ...ownEmail,
    ...eventEmail,
    templates: {
      ...jsonRecord(instanceEmail.templates),
      ...jsonRecord(ownEmail.templates),
      ...jsonRecord(eventEmail.templates),
    },
    layout: instanceEmail.layout,
  });
  const branding = resolveSettings("branding", merged("branding"));
  const platform = resolveSettings("branding", find("branding", "instance")).name ?? brand.name;
  const orgName = org?.name ?? branding.name ?? platform;
  return {
    orgId: org?.id,
    orgName,
    platform,
    senderName: email.senderName ?? orgName,
    accent: branding.accent,
    layout: email.layout ?? DEFAULT_EMAIL_LAYOUT,
    // sign-in style emails come only from bogey.config.ts, never from settings anyone can edit
    templates: {
      ...Object.fromEntries(
        Object.entries(email.templates ?? {}).filter(([key]) => authKindOf(key) === null),
      ),
      ...authEmailTemplates,
    },
  };
}

async function loadContext(orgSlug: string | undefined): Promise<EmailContext> {
  const { data: org } = orgSlug
    ? await createAdminClient().from("orgs").select("id, name").eq("slug", orgSlug).maybeSingle()
    : { data: null };
  return loadContextFor(org);
}

export async function loadContextFor(
  org: { id: string; name: string } | null,
  eventId?: string,
): Promise<EmailContext> {
  const supabase = createAdminClient();
  const { data: rows } = await supabase
    .from("settings")
    .select("scope, org_id, event_id, namespace, value")
    .in("namespace", ["email", "branding"])
    .or(
      [
        "scope.eq.instance",
        ...(org ? [`org_id.eq.${org.id}`] : []),
        ...(org && eventId ? [`event_id.eq.${eventId}`] : []),
      ].join(","),
    );
  return emailContext(org, rows ?? [], eventId);
}

export interface EmailLanguage {
  locale: string;
  messages: Messages;
}

const languages = new Map<string, Promise<Messages>>();

export async function emailLanguage(
  locale: string | null | undefined,
): Promise<EmailLanguage | undefined> {
  if (!locale || locale === "en") return undefined;
  let messages = languages.get(locale);
  if (!messages) {
    messages = loadPluginMessages(locale);
    languages.set(locale, messages);
  }
  const loaded = await messages;
  return Object.keys(loaded).length > 0 ? { locale, messages: loaded } : undefined;
}

export async function accountLocale(userId: string | undefined): Promise<string | null> {
  if (!userId) return null;
  const { data } = await createAdminClient()
    .from("profiles")
    .select("locale")
    .eq("id", userId)
    .maybeSingle();
  return data?.locale ?? null;
}

export function templateFor(
  context: EmailContext,
  key: string,
  kind: EmailKind,
  language?: EmailLanguage,
): { subject: string; body: string; reason: string; footer: EmailFooterWords | undefined } {
  const translated = language ? translatedEmail(language.messages, key) : undefined;
  const picked = pickTemplate(context.templates, key, language?.locale, translated, kind.defaults);
  return {
    ...picked,
    reason: translated?.reason ?? kind.reason,
    footer: language ? footerWords(language.messages) : undefined,
  };
}

export function logoUrl(origin: string): string | undefined {
  const icon = brand.icons?.default;
  return icon && /\.(png|jpe?g|gif|webp)$/i.test(icon) ? `${origin}${icon}` : undefined;
}

export function renderAuthEmail(
  context: EmailContext,
  key: EmailTemplateKey,
  values: { code: string; link: string; email: string; origin: string },
  language?: EmailLanguage,
): RenderedEmail {
  const { subject, body, reason, footer } = templateFor(context, key, EMAIL_KINDS[key], language);
  const logo = logoUrl(values.origin);
  return renderEmail({
    layout: context.layout,
    fallbackLayout: DEFAULT_EMAIL_LAYOUT,
    subject,
    body,
    org: context.orgName,
    platform: context.platform,
    reason,
    ...(footer && language ? { footer, locale: language.locale } : {}),
    values: {
      code: values.code,
      link: values.link,
      email: values.email,
      org: context.orgName,
      platform: context.platform,
      ...(context.accent ? { accent: context.accent } : {}),
      ...(logo ? { logo } : {}),
    },
  });
}

export function confirmLink(tokenHash: string, type: string, redirectTo: string): string {
  let origin: string;
  try {
    origin = new URL(redirectTo).origin;
  } catch {
    throw new HookError(`GoTrue sent no usable redirect_to (${redirectTo})`, 500);
  }
  const params = new URLSearchParams({ token_hash: tokenHash, type });
  return `${origin}/auth/confirm?${params}`;
}

export function transport() {
  const host = process.env.SMTP_HOST;
  const from = process.env.SMTP_FROM;
  if (!host || !from) throw new HookError("SMTP_HOST and SMTP_FROM must be set", 500);
  const port = Number(process.env.SMTP_PORT ?? 587);
  return {
    from,
    mailer: createTransport({
      host,
      port,
      secure: port === 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" }
        : undefined,
    }),
  };
}

const KIND: Record<string, EmailTemplateKey> = {
  signup: "signUp",
  invite: "invite",
  magiclink: "signIn",
  recovery: "signIn",
  email_change: "emailChange",
  reauthentication: "reauthentication",
};

export function origin(redirectTo: string): string {
  try {
    return new URL(redirectTo).origin;
  } catch {
    throw new HookError(`GoTrue sent no usable redirect_to (${redirectTo})`, 500);
  }
}

async function reserve(orgId: string | undefined, kind: EmailTemplateKey): Promise<void> {
  const { data, error } = await createAdminClient().rpc("record_email_send", {
    p_kind: kind,
    ...(orgId ? { p_org: orgId } : {}),
  });
  if (error) throw new HookError(`couldn't record the send: ${error.message}`, 500);
  if (data === "limit") {
    throw new HookError(
      "daily email limit reached",
      429,
      "This organization has sent as many emails as it can today. Try again tomorrow.",
    );
  }
  if (data === "suspended") {
    throw new HookError("organization is suspended", 403, "This organization is suspended.");
  }
}

export async function sendAuthEmail(payload: SendEmailPayload): Promise<void> {
  const { user, email_data: data } = payload;
  const key = KIND[data.email_action_type];
  if (!key) {
    if (data.email_action_type.endsWith("_notification")) {
      console.warn(`[bogey] send-email hook: no template for ${data.email_action_type}; skipped`);
      return;
    }
    throw new HookError(`can't send ${data.email_action_type} emails`, 400);
  }
  const context = await loadContext(text(user.user_metadata?.org));
  const language = await emailLanguage(await accountLocale(user.id));
  const { from, mailer } = transport();
  const base = origin(data.redirect_to);

  const send = async (to: string, code: string, tokenHash: string) => {
    await reserve(context.orgId, key);
    const rendered = renderAuthEmail(
      context,
      key,
      {
        code,
        link: confirmLink(tokenHash, data.email_action_type, data.redirect_to),
        email: to,
        origin: base,
      },
      language,
    );
    await mailer.sendMail({
      from: { name: context.senderName, address: from },
      to,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
  };

  if (data.email_action_type === "email_change") {
    if (user.new_email) await send(user.new_email, data.token, data.token_hash);
    if (data.token_hash_new) await send(user.email, data.token_new ?? "", data.token_hash_new);
    return;
  }
  await send(user.email, data.token, data.token_hash);
}

export async function sendTestEmail(options: {
  to: string;
  kind: string;
  orgId?: string;
  eventId?: string;
  locale?: string;
}): Promise<void> {
  const own = (EMAIL_KIND_KEYS as Tuple<string>).includes(options.kind);
  const plugin = own ? undefined : findPluginEmailKind(options.kind);
  if (!own && !plugin) throw new Error("Unknown email kind");
  const admin = createAdminClient();
  const { data: event } = options.eventId
    ? await admin.from("events").select("org_id").eq("id", options.eventId).maybeSingle()
    : { data: null };
  const orgId = event?.org_id ?? options.orgId;
  const { data: org } = orgId
    ? await admin.from("orgs").select("id, name").eq("id", orgId).maybeSingle()
    : { data: null };
  const context = await loadContextFor(org, options.eventId);
  const { from, mailer } = transport();
  const host = (getRequestHeader("x-forwarded-host") ?? getRequestHeader("host") ?? "")
    .split(",")[0]!
    .trim();
  const base = `${/^localhost(:\d+)?$/.test(host) ? "http" : "https"}://${host}`;
  const kind: EmailKind = plugin?.kind ?? EMAIL_KINDS[options.kind as EmailTemplateKey];
  const auth = (AUTH_EMAIL_KEYS as Tuple<string>).includes(options.kind);
  const logo = logoUrl(base);
  const language = await emailLanguage(options.locale);
  const template = templateFor(context, options.kind, kind, language);
  const rendered = renderEmail({
    layout: context.layout,
    fallbackLayout: DEFAULT_EMAIL_LAYOUT,
    subject: template.subject,
    body: template.body,
    org: context.orgName,
    platform: context.platform,
    reason: template.reason,
    ...(template.footer && language ? { footer: template.footer, locale: language.locale } : {}),
    values: {
      ...Object.fromEntries(kind.variables.map((variable) => [variable.name, variable.example])),
      code: "123456",
      link: auth ? `${base}/auth/confirm?token_hash=sample&type=magiclink` : base,
      email: options.to,
      org: context.orgName,
      platform: context.platform,
      ...(context.accent ? { accent: context.accent } : {}),
      ...(logo ? { logo } : {}),
    },
  });
  await mailer.sendMail({
    from: { name: context.senderName, address: from },
    to: options.to,
    subject: `[Test] ${rendered.subject}`,
    text: rendered.text,
    html: rendered.html,
  });
}
