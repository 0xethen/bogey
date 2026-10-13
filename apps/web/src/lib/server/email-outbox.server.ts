import { createHmac, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@bogey/db/admin";
import type { Tables } from "@bogey/db/types";
import { jsonRecord } from "@bogey/db/types";
import { EMAIL_KINDS, type EmailKind } from "@bogey/config/email";
import {
  NOTIFICATION_KINDS,
  isNotificationKind,
  type ChannelChoice,
} from "@bogey/config/notifications";
import { findPluginEmailKind } from "#/lib/server/plugin-emails.server.ts";
import { DEFAULT_EMAIL_LAYOUT } from "@bogey/utils/email-layout";
import { renderEmail } from "@bogey/utils/email-template";
import {
  emailLanguage,
  loadContextFor,
  logoUrl,
  templateFor,
  transport,
  type EmailContext,
} from "#/lib/server/send-email.server.ts";

export const EMAIL_MAX_ATTEMPTS = 5;

const DRAIN_BUDGET_MS = 50_000;
const BATCH = 20;
const REPLAY_WINDOW_S = 5 * 60;

function hmacHex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyDrainSignature(
  headers: Pick<Headers, "get">,
  secret: string,
  now: number = Date.now(),
): boolean {
  const timestamp = headers.get("x-bogey-timestamp");
  const signature = headers.get("x-bogey-signature");
  if (!timestamp || !signature || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > REPLAY_WINDOW_S) return false;
  return sameText(signature, hmacHex(secret, timestamp));
}

export function unsubscribeToken(secret: string, userId: string, kind: string): string {
  const encoded = Buffer.from(kind).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(`unsubscribe:${userId}:${kind}`)
    .digest("base64url");
  return `${userId}.${encoded}.${signature}`;
}

export function readUnsubscribeToken(
  secret: string,
  token: string,
): { userId: string; kind: string } | null {
  const [userId, encoded, signature, ...extra] = token.split(".");
  if (!userId || !encoded || !signature || extra.length > 0) return null;
  const kind = Buffer.from(encoded, "base64url").toString();
  const expected = unsubscribeToken(secret, userId, kind);
  return sameText(expected, token) ? { userId, kind } : null;
}

let cachedSecret: string | undefined;

export async function drainSecret(): Promise<string> {
  if (cachedSecret) return cachedSecret;
  const { data, error } = await createAdminClient().rpc("email_drain_secret");
  if (error || !data)
    throw new Error(`couldn't read the drain secret: ${error?.message ?? "empty"}`);
  cachedSecret = data;
  return data;
}

type OutboxRow = Tables<"email_outbox">;

type Outcome = { outcome: "sent" } | { outcome: "skipped" | "retry"; reason: string };

function stringVars(vars: OutboxRow["vars"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(jsonRecord(vars))) {
    if (typeof value === "string") out[name] = value;
    else if (typeof value === "number") out[name] = String(value);
  }
  return out;
}

async function originFor(orgId: string): Promise<string | null> {
  const { data } = await createAdminClient()
    .from("org_domains")
    .select("hostname, is_primary")
    .eq("org_id", orgId)
    .order("is_primary", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const local =
    /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(data.hostname) || data.hostname.endsWith(".localhost");
  return `${local ? "http" : "https"}://${data.hostname}`;
}

function kindFor(key: string): { key: string; kind: EmailKind } {
  if (key in EMAIL_KINDS) return { key, kind: EMAIL_KINDS[key as keyof typeof EMAIL_KINDS] };
  const plugin = findPluginEmailKind(key);
  return plugin ?? { key: "notification", kind: EMAIL_KINDS.notification };
}

function optOutKind(vars: Record<string, string>): string | null {
  const kind = vars.kind;
  if (!kind) return null;
  if (isNotificationKind(kind)) return NOTIFICATION_KINDS[kind].transactional ? null : kind;
  return kind;
}

async function sendOne(
  row: OutboxRow,
  secret: string,
  contexts: Map<string, Promise<EmailContext>>,
): Promise<Outcome> {
  const admin = createAdminClient();
  const { data: org } = await admin
    .from("orgs")
    .select("id, name")
    .eq("id", row.org_id)
    .maybeSingle();
  if (!org) return { outcome: "skipped", reason: "the organization is gone" };

  const limit = await admin.rpc("record_email_send", { p_kind: row.kind, p_org: org.id });
  if (limit.error) return { outcome: "retry", reason: limit.error.message };
  if (limit.data === "limit") return { outcome: "skipped", reason: "daily email limit reached" };
  if (limit.data === "suspended")
    return { outcome: "skipped", reason: "organization is suspended" };

  const contextKey = `${org.id}:${row.event_id ?? ""}`;
  let pending = contexts.get(contextKey);
  if (!pending) {
    pending = loadContextFor(org, row.event_id ?? undefined);
    contexts.set(contextKey, pending);
  }
  const context = await pending;

  const { key, kind } = kindFor(row.kind);
  const vars = stringVars(row.vars);
  const origin = (await originFor(org.id)) ?? "";
  const template = templateFor(context, key, kind, await emailLanguage(row.locale));
  const optOut = row.user_id ? optOutKind(vars) : null;
  const unsubscribeUrl =
    row.user_id && optOut && origin
      ? `${origin}/api/email/unsubscribe?${new URLSearchParams({ token: unsubscribeToken(secret, row.user_id, optOut) })}`
      : undefined;
  const logo = origin ? logoUrl(origin) : undefined;

  const rendered = renderEmail({
    layout: context.layout,
    fallbackLayout: DEFAULT_EMAIL_LAYOUT,
    subject: template.subject,
    body: template.body,
    org: context.orgName,
    platform: context.platform,
    reason: template.reason,
    ...(template.footer && row.locale ? { footer: template.footer, locale: row.locale } : {}),
    ...(unsubscribeUrl ? { unsubscribeUrl } : {}),
    values: {
      ...vars,
      link: `${origin}${vars.path ?? ""}`,
      email: row.to_email,
      org: context.orgName,
      platform: context.platform,
      ...(context.accent ? { accent: context.accent } : {}),
      ...(logo ? { logo } : {}),
    },
  });

  const { from, mailer } = transport();
  await mailer.sendMail({
    from: { name: context.senderName, address: from },
    to: row.to_email,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    ...(unsubscribeUrl
      ? {
          headers: {
            "List-Unsubscribe": `<${unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        }
      : {}),
  });
  return { outcome: "sent" };
}

export interface DrainResult {
  sent: number;
  skipped: number;
  retried: number;
}

export async function drainOutbox(): Promise<DrainResult> {
  const admin = createAdminClient();
  const secret = await drainSecret();
  const result: DrainResult = { sent: 0, skipped: 0, retried: 0 };
  const contexts = new Map<string, Promise<EmailContext>>();
  const started = Date.now();

  while (Date.now() - started < DRAIN_BUDGET_MS) {
    const { data: rows, error } = await admin.rpc("email_outbox_claim", { p_limit: BATCH });
    if (error) throw new Error(`couldn't claim mail: ${error.message}`);
    if (rows.length === 0) break;

    for (const row of rows) {
      let outcome: Outcome;
      try {
        outcome = await sendOne(row, secret, contexts);
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : "couldn't send";
        console.error(`[bogey] email outbox ${row.id}:`, reason);
        outcome = { outcome: "retry", reason };
      }
      const { error: finishError } = await admin.rpc("email_outbox_finish", {
        p_id: row.id,
        p_outcome: outcome.outcome,
        ...("reason" in outcome ? { p_error: outcome.reason } : {}),
        p_max_attempts: EMAIL_MAX_ATTEMPTS,
      });
      if (finishError) console.error(`[bogey] email outbox ${row.id}:`, finishError.message);
      if (outcome.outcome === "sent") result.sent += 1;
      else if (outcome.outcome === "skipped") result.skipped += 1;
      else result.retried += 1;
    }
  }
  return result;
}

export async function unsubscribe(userId: string, kind: string): Promise<void> {
  const admin = createAdminClient();
  const { data: current } = await admin
    .from("user_preferences")
    .select("value")
    .eq("user_id", userId)
    .eq("namespace", "notifications")
    .eq("key", "channels")
    .maybeSingle();
  const channels = jsonRecord(current?.value);
  const own: ChannelChoice = jsonRecord(channels[kind]);
  const { error } = await admin.from("user_preferences").upsert({
    user_id: userId,
    namespace: "notifications",
    key: "channels",
    value: { ...channels, [kind]: { ...own, email: false } },
  });
  if (error) throw new Error(error.message);
}
