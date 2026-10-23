import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  CERTIFICATE_KINDS,
  isCertificateKind,
  parseCertificateLayout,
  type CertificateKind,
  type CertificateLayout,
  type CertificateOrientation,
} from "@bogey/utils/certificate";
import { createAdminClient } from "../admin.ts";
import { createServerClient } from "../server.ts";
import { removeStorageOrphans } from "../storage-orphans.ts";
import { fail, ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import { COLUMN_VALUES, type Json, type Tables } from "../types.ts";
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
  layout: z.unknown(),
  orientation: z.enum(COLUMN_VALUES.certificate_templates.orientation),
});

export type Certificate = Omit<z.infer<typeof certificateSchema>, "kind" | "layout"> & {
  kind: CertificateKind;
  /** Null draws the standard design. */
  layout: CertificateLayout | null;
};

function parseCertificate(value: unknown): Certificate | null {
  const parsed = certificateSchema.safeParse(value);
  if (!parsed.success) return null;
  const kind = CERTIFICATE_KINDS.find((each) => each === parsed.data.kind);
  if (!kind) return null;
  const layout = parsed.data.layout ? parseCertificateLayout(parsed.data.layout) : null;
  return { ...parsed.data, kind, layout };
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

export interface CertificateDesign {
  kind: CertificateKind;
  /** Null for the organization's own designs. */
  eventId: string | null;
  orientation: CertificateOrientation;
  layout: CertificateLayout;
  updatedAt: string;
}

export interface CertificateDesigns {
  /** This event's (or, for the organization, its own) designs. */
  own: CertificateDesign[];
  /** What an event falls back to; empty for the organization itself. */
  org: CertificateDesign[];
}

function toDesign(row: Tables<"certificate_templates">): CertificateDesign | null {
  const kind = CERTIFICATE_KINDS.find((each) => each === row.kind);
  if (!kind) return null;
  return {
    kind,
    eventId: row.event_id,
    orientation: row.orientation === "portrait" ? "portrait" : "landscape",
    layout: parseCertificateLayout(row.layout),
    updatedAt: row.updated_at,
  };
}

export interface DesignScope {
  orgId: string;
  eventId: string | null;
}

function readScope(raw: Record<string, unknown>): DesignScope {
  return {
    orgId: requireId(raw.orgId, "orgId"),
    eventId:
      raw.eventId === null || raw.eventId === undefined ? null : requireId(raw.eventId, "eventId"),
  };
}

export const certificateDesignsFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => readScope((input ?? {}) as Record<string, unknown>))
  .handler(async ({ data }): Promise<DbResult<CertificateDesigns>> => {
    const supabase = createServerClient();
    const query = supabase.from("certificate_templates").select("*").eq("org_id", data.orgId);
    const { data: rows, error } = await (data.eventId
      ? query.or(`event_id.eq.${data.eventId},event_id.is.null`)
      : query.is("event_id", null));
    if (error) return toFailure(error, "loading certificate designs");
    const designs = rows.flatMap((row) => toDesign(row) ?? []);
    return ok({
      own: designs.filter((design) => design.eventId === data.eventId),
      org: data.eventId ? designs.filter((design) => design.eventId === null) : [],
    });
  });

export const certificateDesignsQueryOptions = (scope: DesignScope) =>
  queryOptions({
    queryKey: ["certificates", "designs", scope.orgId, scope.eventId] as const,
    queryFn: async () => unwrap(await certificateDesignsFn({ data: scope })),
    retry: retryPolicy,
  });

/** Saves a design, or with `layout: null` goes back to the organization's (or the standard) one.
 * Files the design stopped pointing to are removed once it's saved. */
export const saveCertificateDesignFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    return {
      ...readScope(raw),
      kind: requireOneOf(raw.kind, CERTIFICATE_KINDS, "kind"),
      layout: raw.layout === null ? null : parseCertificateLayout(raw.layout),
      orientation: requireOneOf(
        raw.orientation ?? "landscape",
        COLUMN_VALUES.certificate_templates.orientation,
        "orientation",
      ),
    };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("save_certificate_template", {
      p_org: data.orgId,
      p_kind: data.kind,
      p_layout: data.layout as unknown as Json,
      p_orientation: data.orientation,
      ...(data.eventId ? { p_event: data.eventId } : {}),
    });
    if (error) return toFailure(error, "saving the design");
    // the cron sweep retries whatever this misses
    await removeStorageOrphans().catch((sweep: unknown) =>
      console.warn(
        "[bogey/db] removing unused files:",
        sweep instanceof Error ? sweep.message : sweep,
      ),
    );
    return ok(null);
  });

const fileCopies = z.array(z.object({ from: z.string(), to: z.string() }));

/** Gives the event its own copy of the organization's design, files included. */
export const copyCertificateDesignFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    return {
      eventId: requireId(raw.eventId, "eventId"),
      kind: requireOneOf(raw.kind, CERTIFICATE_KINDS, "kind"),
    };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { data: files, error } = await supabase.rpc("copy_certificate_template", {
      p_event: data.eventId,
      p_kind: data.kind,
    });
    if (error) return toFailure(error, "copying the design");
    const parsed = fileCopies.safeParse(files);
    if (!parsed.success) return fail("unknown", "The database answered in an unexpected way.");
    const storage = createAdminClient().storage.from("event-assets");
    const missed: string[] = [];
    for (const file of parsed.data) {
      const { error: copying } = await storage.copy(file.from, file.to);
      if (copying) missed.push(file.from.slice(file.from.lastIndexOf("/") + 1));
    }
    if (missed.length > 0) {
      return fail(
        "unknown",
        `The design was copied, but not these pictures: ${missed.join(", ")}.`,
      );
    }
    return ok(null);
  });
