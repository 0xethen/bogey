import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { createServerClient } from "../server.ts";
import { ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import { requireId, requireNumber, requireOneOf } from "./validate.ts";

export const TABLE_SCHEMES = ["numeric", "prefix"] as const;
export const TABLE_GROUPS = ["none", "division", "track"] as const;

export interface TableRow {
  submissionId: string;
  table: string | null;
  title: string;
  teamName: string;
  formId: string;
  formTitle: string;
  divisionName: string | null;
}

export const tableListFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<TableRow[]>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("submissions")
      .select(
        "id, title, table_label, form_id, teams(name, divisions(name)), submission_forms!inner(title, judged)",
      )
      .eq("event_id", eventId)
      .eq("status", "submitted")
      .eq("submission_forms.judged", true);
    if (error) return toFailure(error, "loading the table list");
    return ok(
      data
        .map((row) => ({
          submissionId: row.id,
          table: row.table_label,
          title: row.title || "Untitled",
          teamName: row.teams?.name ?? "A team",
          formId: row.form_id,
          formTitle: row.submission_forms.title,
          divisionName: row.teams?.divisions?.name ?? null,
        }))
        .sort(
          (a, b) =>
            (a.table ?? "~").localeCompare(b.table ?? "~", undefined, { numeric: true }) ||
            a.title.localeCompare(b.title),
        ),
    );
  });

export const tableListQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["table-list", eventId] as const,
    queryFn: async () => unwrap(await tableListFn({ data: eventId })),
    retry: retryPolicy,
  });

export const assignTablesFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    return {
      formId: requireId(raw.formId, "formId"),
      scheme: requireOneOf(raw.scheme ?? "numeric", TABLE_SCHEMES, "scheme"),
      group: requireOneOf(raw.group ?? "none", TABLE_GROUPS, "group"),
      start: Math.round(requireNumber(raw.start ?? 1, "Start", 0, 9999)),
      prefix: typeof raw.prefix === "string" ? raw.prefix.trim().slice(0, 10) : "",
      replace: raw.replace === true,
    };
  })
  .handler(async ({ data }): Promise<DbResult<number>> => {
    const supabase = createServerClient();
    const { data: count, error } = await supabase.rpc("assign_tables", {
      p_form: data.formId,
      p_scheme: data.scheme,
      p_start: data.start,
      p_prefix: data.prefix,
      p_group: data.group,
      p_replace: data.replace,
    });
    if (error) return toFailure(error, "numbering the tables");
    return ok(count);
  });

export const setTableFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { submissionId?: unknown; table?: unknown };
    const table = typeof raw.table === "string" ? raw.table.trim().slice(0, 20) : "";
    return { submissionId: requireId(raw.submissionId, "submissionId"), table };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase
      .from("submissions")
      .update({ table_label: data.table || null })
      .eq("id", data.submissionId);
    if (error) return toFailure(error, "setting the table");
    return ok(null);
  });

export const skipSubmissionFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { submissionId?: unknown; skipped?: unknown };
    return {
      submissionId: requireId(raw.submissionId, "submissionId"),
      skipped: raw.skipped !== false,
    };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("skip_submission", {
      p_submission: data.submissionId,
      p_skipped: data.skipped,
    });
    if (error) return toFailure(error, "skipping the team");
    return ok(null);
  });
