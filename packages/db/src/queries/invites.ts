import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { createServerClient } from "../server.ts";
import { fail, ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import type { Json, Tables } from "../types.ts";
import { parseForm, FIELD_KINDS, type FormField } from "./registration.ts";
import { fieldsProblem } from "@bogey/utils/registration-form";
import { idList, requireId, requireText } from "./validate.ts";

const TOKEN = /^[0-9a-f]{24}$/;

export interface InviteLinkView {
  eventId: string;
  eventName: string;
  eventSlug: string;
  orgName: string;
  label: string;
  isOpen: boolean;
  form: FormField[];
  startsOn: string | null;
}

export const inviteLinkViewFn = createServerFn({ method: "GET" })
  .validator((token: unknown) => (typeof token === "string" && TOKEN.test(token) ? token : null))
  .handler(async ({ data: token }): Promise<DbResult<InviteLinkView | null>> => {
    if (!token) return ok(null);
    const supabase = createServerClient();
    const { data, error } = await supabase.rpc("invite_link_view", { p_token: token });
    if (error) return toFailure(error, "opening the invite");
    const row = data?.[0];
    if (!row) return ok(null);
    return ok({
      eventId: row.event_id,
      eventName: row.event_name,
      eventSlug: String(row.event_slug),
      orgName: row.org_name,
      label: row.label,
      isOpen: row.is_open,
      form: parseForm(row.form),
      startsOn: row.starts_on,
    });
  });

export const inviteLinkViewQueryOptions = (token: string) =>
  queryOptions({
    queryKey: ["invite-link", token] as const,
    queryFn: async () => unwrap(await inviteLinkViewFn({ data: token })),
    retry: retryPolicy,
  });

export interface InviteLink extends Tables<"invite_links"> {
  used: number;
}

export const eventInviteLinksFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<InviteLink[]>> => {
    const supabase = createServerClient();
    const [links, uses] = await Promise.all([
      supabase
        .from("invite_links")
        .select("*")
        .eq("event_id", eventId)
        .order("created_at", { ascending: false }),
      supabase
        .from("registrations")
        .select("invite_link_id")
        .eq("event_id", eventId)
        .not("invite_link_id", "is", null),
    ]);
    const error = links.error ?? uses.error;
    if (error) return toFailure(error, "loading invite links");
    const counts = new Map<string, number>();
    for (const row of uses.data ?? []) {
      if (row.invite_link_id)
        counts.set(row.invite_link_id, (counts.get(row.invite_link_id) ?? 0) + 1);
    }
    return ok((links.data ?? []).map((link) => ({ ...link, used: counts.get(link.id) ?? 0 })));
  });

export const eventInviteLinksQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["invite-links", eventId] as const,
    queryFn: async () => unwrap(await eventInviteLinksFn({ data: eventId })),
    retry: retryPolicy,
  });

export const createInviteLinkFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    const capacity =
      raw.capacity === null || raw.capacity === undefined ? null : Number(raw.capacity);
    if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 100_000)) {
      throw new Error("Limit must be a whole number above 0");
    }
    const closesAt =
      typeof raw.closesAt === "string" && !Number.isNaN(Date.parse(raw.closesAt))
        ? raw.closesAt
        : null;
    return {
      eventId: requireId(raw.eventId, "eventId"),
      label: requireText(raw.label, "Label", 80),
      autoApprove: raw.autoApprove === true,
      capacity,
      closesAt,
    };
  })
  .handler(async ({ data }): Promise<DbResult<Tables<"invite_links">>> => {
    const supabase = createServerClient();
    const { data: userData } = await supabase.auth.getUser();
    const { data: row, error } = await supabase
      .from("invite_links")
      .insert({
        event_id: data.eventId,
        label: data.label,
        auto_approve: data.autoApprove,
        capacity: data.capacity,
        closes_at: data.closesAt,
        created_by: userData.user?.id ?? null,
      })
      .select("*")
      .single();
    if (error) return toFailure(error, "creating the invite link");
    return ok(row);
  });

export const setInviteLinkDisabledFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { id?: unknown; disabled?: unknown };
    return { id: requireId(raw.id, "id"), disabled: raw.disabled === true };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { data: rows, error } = await supabase
      .from("invite_links")
      .update({ disabled_at: data.disabled ? new Date().toISOString() : null })
      .eq("id", data.id)
      .select("id");
    if (error) return toFailure(error, "updating the invite link");
    if (!rows.length) return fail("forbidden", "Only organizers can change invite links.");
    return ok(null);
  });

export const deleteInviteLinkFn = createServerFn({ method: "POST" })
  .validator((id: unknown) => requireId(id, "id"))
  .handler(async ({ data: id }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { data: rows, error } = await supabase
      .from("invite_links")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) return toFailure(error, "removing the invite link");
    if (!rows.length) return fail("forbidden", "Only organizers can remove invite links.");
    return ok(null);
  });

export const onboardingFormFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<FormField[]>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("onboarding_forms")
      .select("fields")
      .eq("event_id", eventId)
      .maybeSingle();
    if (error) return toFailure(error, "loading the registration form");
    return ok(parseForm(data?.fields));
  });

export const onboardingFormQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["registration-form", eventId] as const,
    queryFn: async () => unwrap(await onboardingFormFn({ data: eventId })),
    retry: retryPolicy,
  });

function optionList(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw
        .filter((option): option is string => typeof option === "string" && !!option.trim())
        .map((option) => option.trim().slice(0, 100))
    : [];
}

function numberOrUndefined(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

function readShowWhen(raw: unknown): FormField["showWhen"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const when: Record<string, unknown> = { ...raw };
  if (typeof when.field !== "string") return undefined;
  if (typeof when.ageUnder === "number") return { field: when.field, ageUnder: when.ageUnder };
  if (!Array.isArray(when.in)) return undefined;
  return {
    field: when.field,
    in: when.in.filter(
      (value): value is string | boolean => typeof value === "string" || typeof value === "boolean",
    ),
  };
}

function fieldToJson(field: FormField): Json {
  return {
    key: field.key,
    label: field.label,
    kind: field.kind,
    required: field.required,
    ...(field.options ? { options: field.options } : {}),
    ...(field.help ? { help: field.help } : {}),
    ...(field.text ? { text: field.text } : {}),
    ...(field.min !== undefined ? { min: field.min } : {}),
    ...(field.max !== undefined ? { max: field.max } : {}),
    ...(field.showWhen
      ? {
          showWhen:
            "ageUnder" in field.showWhen
              ? { field: field.showWhen.field, ageUnder: field.showWhen.ageUnder }
              : { field: field.showWhen.field, in: [...field.showWhen.in] },
        }
      : {}),
    ...(field.divisionIds?.length ? { divisionIds: [...field.divisionIds] } : {}),
    ...(field.tagIds?.length ? { tagIds: [...field.tagIds] } : {}),
  };
}

export const saveOnboardingFormFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { eventId?: unknown; fields?: unknown };
    if (!Array.isArray(raw.fields) || raw.fields.length > 50) {
      throw new Error("A form has at most 50 questions");
    }
    const fields = raw.fields.map((entry: unknown): FormField => {
      const field: Record<string, unknown> =
        entry && typeof entry === "object" && !Array.isArray(entry) ? { ...entry } : {};
      const key = typeof field.key === "string" ? field.key : "";
      const kind = FIELD_KINDS.find((candidate) => candidate === field.kind);
      if (!kind) throw new Error("Unknown question type");
      const options = optionList(field.options);
      const min = numberOrUndefined(field.min);
      const max = numberOrUndefined(field.max);
      const showWhen = readShowWhen(field.showWhen);
      const text =
        typeof field.text === "string" && field.text.trim() ? field.text.trim().slice(0, 5000) : "";
      const divisionIds = idList(field.divisionIds, "Divisions");
      const tagIds = idList(field.tagIds, "Tags");
      return {
        key,
        label: requireText(field.label, "Question", 200),
        kind,
        required: field.required === true,
        ...(kind === "select" || kind === "multiselect" ? { options } : {}),
        ...(typeof field.help === "string" && field.help.trim()
          ? { help: field.help.trim().slice(0, 500) }
          : {}),
        ...(kind === "consent" && text ? { text } : {}),
        ...(kind === "number" && min !== undefined ? { min } : {}),
        ...(kind === "number" && max !== undefined ? { max } : {}),
        ...(showWhen ? { showWhen } : {}),
        ...(divisionIds.length ? { divisionIds } : {}),
        ...(tagIds.length ? { tagIds } : {}),
      };
    });
    const problem = fieldsProblem(fields);
    if (problem) throw new Error(problem);
    return { eventId: requireId(raw.eventId, "eventId"), fields };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase
      .from("onboarding_forms")
      .upsert(
        { event_id: data.eventId, fields: data.fields.map(fieldToJson) },
        { onConflict: "event_id" },
      );
    if (error) return toFailure(error, "saving the registration form");
    return ok(null);
  });
