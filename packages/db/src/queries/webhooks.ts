import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { createServerClient } from "../server.ts";
import { fail, ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import type { Tables } from "../types.ts";
import { requireId, requireText } from "./validate.ts";

export type Webhook = Tables<"webhooks">;
export type WebhookDelivery = Tables<"webhook_deliveries">;

export const WEBHOOK_KINDS = [
  { key: "registration.created", label: "someone registers" },
  {
    key: "registration.updated",
    label: "A registration changes (approved, rejected, withdrawn...)",
  },
  { key: "team.created", label: "a team is created" },
  { key: "submission.submitted", label: "a project is submitted" },
  { key: "results.published", label: "results are published" },
  { key: "window.opened", label: "a window opens" },
  { key: "window.closed", label: "a window closes" },
  { key: "announcement.posted", label: "an announcement goes up" },
  { key: "checkin.created", label: "someone checks in" },
] as const;

export type WebhookKind = (typeof WEBHOOK_KINDS)[number]["key"];

export type WebhookFormat = "discord" | "slack" | "json";

// Matches private.webhook_format: chat services get a message in their own shape.
export function webhookFormat(url: string): WebhookFormat {
  if (/^https:\/\/((ptb|canary)\.)?discord(app)?\.com\/api\/webhooks\//i.test(url))
    return "discord";
  if (/^https:\/\/hooks\.slack\.com\//i.test(url)) return "slack";
  return "json";
}

const KIND_KEYS: readonly string[] = WEBHOOK_KINDS.map((kind) => kind.key);

function requireKinds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error("Pick at least one thing to hear about.");
  const kinds = value.filter((entry): entry is string => typeof entry === "string");
  if (kinds.length !== value.length || kinds.some((kind) => !KIND_KEYS.includes(kind))) {
    throw new Error("Some of those events aren't ones a webhook can listen to.");
  }
  return [...new Set(kinds)];
}

interface Scope {
  orgId: string;
  eventId?: string;
}

function requireScope(input: unknown): Scope {
  const raw = (input ?? {}) as { orgId?: unknown; eventId?: unknown };
  return {
    orgId: requireId(raw.orgId, "orgId"),
    ...(raw.eventId === undefined ? {} : { eventId: requireId(raw.eventId, "eventId") }),
  };
}

export const webhooksFn = createServerFn({ method: "GET" })
  .validator(requireScope)
  .handler(async ({ data }): Promise<DbResult<Webhook[]>> => {
    const supabase = createServerClient();
    const query = supabase
      .from("webhooks")
      .select("*")
      .eq("org_id", data.orgId)
      .order("created_at");
    const { data: rows, error } = await (data.eventId ? query.eq("event_id", data.eventId) : query);
    if (error) return toFailure(error, "loading webhooks");
    return ok(rows);
  });

export const webhooksQueryOptions = (scope: Scope) =>
  queryOptions({
    queryKey: ["webhooks", scope.orgId, scope.eventId ?? null] as const,
    queryFn: async () => unwrap(await webhooksFn({ data: scope })),
    retry: retryPolicy,
  });

export const webhookDeliveriesFn = createServerFn({ method: "GET" })
  .validator(requireScope)
  .handler(async ({ data }): Promise<DbResult<WebhookDelivery[]>> => {
    const supabase = createServerClient();
    const query = supabase
      .from("webhook_deliveries")
      .select("*")
      .eq("org_id", data.orgId)
      .order("created_at", { ascending: false })
      .limit(50);
    const { data: rows, error } = await (data.eventId ? query.eq("event_id", data.eventId) : query);
    if (error) return toFailure(error, "loading deliveries");
    return ok(rows);
  });

export const webhookDeliveriesQueryOptions = (scope: Scope) =>
  queryOptions({
    queryKey: ["webhook-deliveries", scope.orgId, scope.eventId ?? null] as const,
    queryFn: async () => unwrap(await webhookDeliveriesFn({ data: scope })),
    refetchInterval: 15_000,
    retry: retryPolicy,
  });

export interface NewWebhook {
  orgId: string;
  eventId: string | null;
  url: string;
  events: string[];
}

export const createWebhookFn = createServerFn({ method: "POST" })
  .validator((input: unknown): NewWebhook => {
    const raw = (input ?? {}) as Record<string, unknown>;
    return {
      orgId: requireId(raw.orgId, "orgId"),
      eventId:
        raw.eventId === null || raw.eventId === undefined
          ? null
          : requireId(raw.eventId, "eventId"),
      url: requireText(raw.url, "url", 500),
      events: requireKinds(raw.events),
    };
  })
  .handler(async ({ data }): Promise<DbResult<{ id: string; secret: string }>> => {
    const supabase = createServerClient();
    const { data: rows, error } = await supabase.rpc("create_webhook", {
      p_org: data.orgId,
      ...(data.eventId ? { p_event: data.eventId } : {}),
      p_url: data.url,
      p_events: data.events,
    });
    if (error) return toFailure(error, "adding the webhook");
    const row = rows[0];
    return row
      ? ok({ id: row.webhook_id, secret: row.secret })
      : fail("unknown", "No webhook was made.");
  });

export const updateWebhookFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    return {
      id: requireId(raw.id, "id"),
      url: requireText(raw.url, "url", 500),
      events: requireKinds(raw.events),
      disabled: raw.disabled === true,
    };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("update_webhook", {
      p_id: data.id,
      p_url: data.url,
      p_events: data.events,
      p_disabled: data.disabled,
    });
    return error ? toFailure(error, "saving the webhook") : ok(null);
  });

export const deleteWebhookFn = createServerFn({ method: "POST" })
  .validator((id: unknown) => requireId(id, "id"))
  .handler(async ({ data: id }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("delete_webhook", { p_id: id });
    return error ? toFailure(error, "deleting the webhook") : ok(null);
  });

export const rotateWebhookSecretFn = createServerFn({ method: "POST" })
  .validator((id: unknown) => requireId(id, "id"))
  .handler(async ({ data: id }): Promise<DbResult<string>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase.rpc("rotate_webhook_secret", { p_id: id });
    if (error) return toFailure(error, "making a new secret");
    return data ? ok(data) : fail("unknown", "No secret was made.");
  });

export const resendWebhookDeliveryFn = createServerFn({ method: "POST" })
  .validator((id: unknown) => requireId(id, "id"))
  .handler(async ({ data: id }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("resend_webhook_delivery", { p_id: id });
    return error ? toFailure(error, "sending it again") : ok(null);
  });
