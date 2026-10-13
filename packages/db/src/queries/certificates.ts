import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  CERTIFICATE_KINDS,
  isCertificateKind,
  type CertificateKind,
} from "@bogey/utils/certificate";
import { createServerClient } from "../server.ts";
import { fail, ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import type { Tables } from "../types.ts";
import { requireId, requireOneOf, requireText } from "./validate.ts";

const certificateSchema = z.object({
  code: z.string(),
  name: z.string(),
  kind: z.string().refine(isCertificateKind),
  label: z.string(),
  issuedAt: z.string(),
  revoked: z.boolean(),
  event: z.string(),
  eventSlug: z.string(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  org: z.string(),
  body: z.string().nullable(),
  orientation: z.enum(["landscape", "portrait"]),
  background: z.string().nullable(),
});

export type Certificate = Omit<z.infer<typeof certificateSchema>, "kind"> & {
  kind: CertificateKind;
};

function parseCertificate(value: unknown): Certificate | null {
  const parsed = certificateSchema.safeParse(value);
  if (!parsed.success) return null;
  const kind = CERTIFICATE_KINDS.find((each) => each === parsed.data.kind);
  return kind ? { ...parsed.data, kind } : null;
}

export const certificateFn = createServerFn({ method: "GET" })
  .validator((code: unknown) => requireText(code, "code", 20).toUpperCase())
  .handler(async ({ data: code }): Promise<DbResult<Certificate | null>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase.rpc("verify_certificate", { p_code: code });
    if (error) return toFailure(error, "checking the certificate");
    return ok(parseCertificate(data));
  });

export const certificateQueryOptions = (code: string) =>
  queryOptions({
    queryKey: ["certificate", code.toUpperCase()] as const,
    queryFn: async () => unwrap(await certificateFn({ data: code })),
    retry: retryPolicy,
  });

export interface CertificateOption {
  kind: CertificateKind;
  awardId: string | null;
  label: string;
  code: string | null;
}

export const myCertificatesFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<CertificateOption[]>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase.rpc("my_certificates", { p_event: eventId });
    if (error) return toFailure(error, "loading your certificates");
    return ok(
      data.flatMap((row) => {
        const kind = CERTIFICATE_KINDS.find((each) => each === row.kind);
        return kind ? [{ kind, awardId: row.award_id, label: row.label, code: row.code }] : [];
      }),
    );
  });

export const myCertificatesQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["certificates", "mine", eventId] as const,
    queryFn: async () => unwrap(await myCertificatesFn({ data: eventId })),
    retry: retryPolicy,
  });

export const claimCertificateFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    return {
      eventId: requireId(raw.eventId, "eventId"),
      kind: requireOneOf(raw.kind, CERTIFICATE_KINDS, "kind"),
      awardId:
        raw.awardId === null || raw.awardId === undefined
          ? null
          : requireId(raw.awardId, "awardId"),
    };
  })
  .handler(async ({ data }): Promise<DbResult<string>> => {
    const supabase = createServerClient();
    const { data: code, error } = await supabase.rpc("claim_certificate", {
      p_event: data.eventId,
      p_kind: data.kind,
      ...(data.awardId ? { p_award: data.awardId } : {}),
    });
    if (error) return toFailure(error, "getting your certificate");
    return code ? ok(code) : fail("unknown", "No certificate was made.");
  });

export const eventCertificatesFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<Certificate[]>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase.rpc("event_certificates", { p_event: eventId });
    if (error) return toFailure(error, "loading certificates");
    return ok(data.flatMap((row) => parseCertificate(row) ?? []));
  });

export const eventCertificatesQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["certificates", "event", eventId] as const,
    queryFn: async () => unwrap(await eventCertificatesFn({ data: eventId })),
    retry: retryPolicy,
  });

export const issueCertificatesFn = createServerFn({ method: "POST" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<number>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase.rpc("issue_certificates", { p_event: eventId });
    return error ? toFailure(error, "issuing certificates") : ok(data);
  });

export const revokeCertificateFn = createServerFn({ method: "POST" })
  .validator((code: unknown) => requireText(code, "code", 20).toUpperCase())
  .handler(async ({ data: code }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { data: row, error: lookup } = await supabase
      .from("certificates")
      .select("id")
      .eq("code", code)
      .maybeSingle();
    if (lookup) return toFailure(lookup, "finding the certificate");
    if (!row) return fail("not_found", "That certificate is gone.");
    const { error } = await supabase.rpc("revoke_certificate", { p_id: row.id });
    return error ? toFailure(error, "revoking the certificate") : ok(null);
  });

export type CertificateTemplate = Tables<"certificate_templates">;

export const certificateTemplatesFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<CertificateTemplate[]>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("certificate_templates")
      .select("*")
      .eq("event_id", eventId);
    return error ? toFailure(error, "loading certificate wording") : ok(data);
  });

export const certificateTemplatesQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["certificates", "templates", eventId] as const,
    queryFn: async () => unwrap(await certificateTemplatesFn({ data: eventId })),
    retry: retryPolicy,
  });

export const saveCertificateTemplateFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    const background = typeof raw.background === "string" ? raw.background.trim() : "";
    if (background && !/^https:\/\//.test(background)) {
      throw new Error("A background picture needs a full address starting with https://");
    }
    return {
      orgId: requireId(raw.orgId, "orgId"),
      eventId: requireId(raw.eventId, "eventId"),
      kind: requireOneOf(raw.kind, CERTIFICATE_KINDS, "kind"),
      body: typeof raw.body === "string" ? raw.body.slice(0, 2000) : "",
      orientation: requireOneOf(raw.orientation, ["landscape", "portrait"] as const, "orientation"),
      background,
    };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("save_certificate_template", {
      p_org: data.orgId,
      p_event: data.eventId,
      p_kind: data.kind,
      p_body_md: data.body,
      p_orientation: data.orientation,
      ...(data.background ? { p_background_url: data.background } : {}),
    });
    return error ? toFailure(error, "saving the wording") : ok(null);
  });
