import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import {
  answerProblem,
  CORE_ANSWER_KINDS,
  isCoreAnswerKind,
  isPluginAnswerKind,
  loadPluginAnswerValidator,
  type AnswerKind,
} from "@bogey/utils/answers";
import { audienceReaches, type Audience, type Member } from "@bogey/utils/audience";
import { KEBAB } from "@bogey/utils/keys";
import { createServerClient } from "../server.ts";
import { fail, ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import type { Json, Tables } from "../types.ts";
import { idList, requireId, requireText } from "./validate.ts";
import { plural } from "@bogey/utils/text";

export type Submission = Tables<"submissions">;
export type SubmissionFile = Tables<"submission_files">;
export type SubmissionItemKind = AnswerKind;
export type SubmissionFormRow = Tables<"submission_forms">;

export interface SubmissionItem extends Audience {
  key: string;
  label: string;
  help: string | null;
  kind: SubmissionItemKind;
  required: boolean;
  options: string[];
  maxLength?: number;
  accept?: string;
  maxMb?: number;
  namesPeople?: boolean;
  config?: Record<string, string | number | boolean>;
}

const CORE_CONFIG_KEYS = ["maxLength", "accept", "maxMb", "namesPeople"];

function pluginConfig(value: {
  [key: string]: Json | undefined;
}): Record<string, string | number | boolean> | undefined {
  const out: Record<string, string | number | boolean> = {};
  for (const [name, entry] of Object.entries(value)) {
    if (CORE_CONFIG_KEYS.includes(name)) continue;
    if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
      out[name] = entry;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

export interface SubmissionForm extends SubmissionFormRow {
  items: SubmissionItem[];
  /** The divisions whose teams submit this form; empty means everyone. */
  divisionIds: string[];
}

/** Whether a team (or a participant without one) in this division gets the form. */
export function formReaches(form: Pick<SubmissionForm, "divisionIds">, division: string | null) {
  return form.divisionIds.length === 0 || (!!division && form.divisionIds.includes(division));
}

function parseItem(row: Tables<"submission_items">): SubmissionItem {
  const config =
    row.config && typeof row.config === "object" && !Array.isArray(row.config) ? row.config : {};
  const number = (value: Json | undefined) => (typeof value === "number" ? value : undefined);
  return {
    key: row.key,
    label: row.label,
    help: row.help,
    kind: isCoreAnswerKind(row.kind) || isPluginAnswerKind(row.kind) ? row.kind : "text",
    required: row.required,
    options: Array.isArray(row.options)
      ? row.options.filter((option): option is string => typeof option === "string")
      : [],
    maxLength: number(config.maxLength),
    accept: typeof config.accept === "string" ? config.accept : undefined,
    maxMb: number(config.maxMb),
    namesPeople: config.namesPeople === true || undefined,
    config: pluginConfig(config),
    ...(row.division_ids.length ? { divisionIds: row.division_ids } : {}),
    ...(row.tag_ids.length ? { tagIds: row.tag_ids } : {}),
  };
}

/** The form as this team (or teamless participant) sees it: only the items meant for them. */
function formFor(form: SubmissionForm, member: Member): SubmissionForm {
  return { ...form, items: form.items.filter((item) => audienceReaches(item, member)) };
}

async function loadForms(eventId: string): Promise<DbResult<SubmissionForm[]>> {
  const supabase = createServerClient();
  const [forms, items, divisions] = await Promise.all([
    supabase.from("submission_forms").select("*").eq("event_id", eventId).order("sort"),
    supabase.from("submission_items").select("*").eq("event_id", eventId).order("sort"),
    supabase
      .from("submission_form_divisions")
      .select("form_id, division_id")
      .eq("event_id", eventId),
  ]);
  const error = forms.error ?? items.error ?? divisions.error;
  if (error) return toFailure(error, "loading submission forms");
  return ok(
    (forms.data ?? []).map((form) => ({
      ...form,
      items: (items.data ?? []).filter((item) => item.form_id === form.id).map(parseItem),
      divisionIds: (divisions.data ?? [])
        .filter((row) => row.form_id === form.id)
        .map((row) => row.division_id),
    })),
  );
}

export const submissionFormsFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }) => loadForms(eventId));

export const submissionFormsQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["submission-forms", eventId] as const,
    queryFn: async () => unwrap(await submissionFormsFn({ data: eventId })),
    retry: retryPolicy,
  });

export interface MySubmissions {
  team: {
    id: string;
    name: string;
    members: number;
    divisionId: string | null;
    /** A teammate chose the team's division, so only they or an organizer change it. */
    divisionChosenByTeammate: boolean;
  } | null;
  forms: { form: SubmissionForm; submission: Submission | null; files: SubmissionFile[] }[];
}

export const mySubmissionsFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<MySubmissions>> => {
    const supabase = createServerClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return fail("forbidden", "Sign in first.");

    const [forms, membership, member] = await Promise.all([
      loadForms(eventId),
      supabase
        .from("team_members")
        .select("team_id, teams(name, division_id, division_chosen_by)")
        .eq("event_id", eventId)
        .eq("user_id", userData.user.id)
        .maybeSingle(),
      supabase
        .from("event_members")
        .select("division_id")
        .eq("event_id", eventId)
        .eq("user_id", userData.user.id)
        .maybeSingle(),
    ]);
    if (!forms.ok) return forms;
    const loadError = membership.error ?? member.error;
    if (loadError) return toFailure(loadError, "loading your submissions");
    if (!membership.data) {
      const division = member.data?.division_id ?? null;
      const tags = await supabase.rpc("audience_tags", { p_event: eventId });
      if (tags.error) return toFailure(tags.error, "loading your submissions");
      const own = { divisionId: division, tagIds: tags.data ?? [] };
      return ok({
        team: null,
        forms: forms.data
          .filter((form) => formReaches(form, division))
          .map((form) => ({ form: formFor(form, own), submission: null, files: [] })),
      });
    }
    const division = membership.data.teams?.division_id ?? null;
    const chooser = membership.data.teams?.division_chosen_by ?? null;

    const teamId = membership.data.team_id;
    const [submissions, members, tags] = await Promise.all([
      supabase.from("submissions").select("*").eq("event_id", eventId).eq("team_id", teamId),
      supabase.from("team_members").select("user_id").eq("team_id", teamId),
      supabase.rpc("audience_tags", { p_event: eventId, p_team: teamId }),
    ]);
    const error = submissions.error ?? members.error ?? tags.error;
    if (error) return toFailure(error, "loading your submissions");

    const ids = (submissions.data ?? []).map((row) => row.id);
    const { data: files, error: fileError } = ids.length
      ? await supabase.from("submission_files").select("*").in("submission_id", ids).order("sort")
      : { data: [], error: null };
    if (fileError) return toFailure(fileError, "loading your files");

    return ok({
      team: {
        id: teamId,
        name: membership.data.teams?.name ?? "Your team",
        members: members.data?.length || 1,
        divisionId: division,
        divisionChosenByTeammate:
          !!chooser &&
          chooser !== userData.user.id &&
          (members.data ?? []).some((member) => member.user_id === chooser),
      },
      forms: forms.data.flatMap((form) => {
        const submission = submissions.data?.find((row) => row.form_id === form.id) ?? null;
        // a draft started before the team changed divisions stays visible
        if (!submission && !formReaches(form, division)) return [];
        return {
          form: formFor(form, { divisionId: division, tagIds: tags.data ?? [] }),
          submission,
          files: submission
            ? (files ?? []).filter((file) => file.submission_id === submission.id)
            : [],
        };
      }),
    });
  });

export const mySubmissionsQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["my-submissions", eventId] as const,
    queryFn: async () => unwrap(await mySubmissionsFn({ data: eventId })),
    retry: retryPolicy,
  });

export const startSubmissionFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { eventId?: unknown; formId?: unknown; teamId?: unknown };
    return {
      eventId: requireId(raw.eventId, "eventId"),
      formId: requireId(raw.formId, "formId"),
      teamId: requireId(raw.teamId, "teamId"),
    };
  })
  .handler(async ({ data }): Promise<DbResult<Submission>> => {
    const supabase = createServerClient();
    const { data: row, error } = await supabase
      .from("submissions")
      .insert({ event_id: data.eventId, form_id: data.formId, team_id: data.teamId })
      .select("*")
      .single();
    if (error) {
      if (error.code === "42501") return fail("forbidden", "This submission isn't open right now.");
      if (error.code === "23505") return fail("conflict", "Your team already started this one.");
      return toFailure(error, "starting the submission");
    }
    return ok(row);
  });

export interface SubmissionChanges {
  id: string;
  title: string;
  answers: { [key: string]: string | boolean };
  isPublic: boolean;
}

async function noteRefusal(
  supabase: ReturnType<typeof createServerClient>,
  submissionId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("submissions")
    .select("event_id")
    .eq("id", submissionId)
    .maybeSingle();
  if (!data) return false;
  const { data: blocked } = await supabase.rpc("record_blocked_access", {
    p_event: data.event_id,
    p_area: "submissions",
  });
  return blocked === true;
}

export const saveSubmissionFn = createServerFn({ method: "POST" })
  .validator((input: unknown): SubmissionChanges => {
    const raw = (input ?? {}) as Record<string, unknown>;
    const answers: { [key: string]: string | boolean } = {};
    if (raw.answers && typeof raw.answers === "object" && !Array.isArray(raw.answers)) {
      for (const [key, value] of Object.entries(raw.answers)) {
        if (typeof value === "boolean") answers[key] = value;
        else if (typeof value === "string") answers[key] = value.slice(0, 50_000);
      }
    }
    return {
      id: requireId(raw.id, "id"),
      title: typeof raw.title === "string" ? raw.title.trim().slice(0, 120) : "",
      answers,
      isPublic: raw.isPublic !== false,
    };
  })
  .handler(async ({ data }): Promise<DbResult<Submission>> => {
    const supabase = createServerClient();
    const { data: current, error: readError } = await supabase
      .from("submissions")
      .select("form_id")
      .eq("id", data.id)
      .maybeSingle();
    if (readError) return toFailure(readError, "saving the submission");
    if (!current) return fail("not_found", "That submission is gone.");

    const { data: items, error: itemError } = await supabase
      .from("submission_items")
      .select("*")
      .eq("form_id", current.form_id);
    if (itemError) return toFailure(itemError, "saving the submission");

    const answers: { [key: string]: Json } = {};
    for (const item of (items ?? []).map(parseItem)) {
      if (item.kind === "file") continue;
      if (isPluginAnswerKind(item.kind)) await loadPluginAnswerValidator(item.kind);
      const value = data.answers[item.key];
      const problem = answerProblem({ ...item, required: false }, value);
      if (problem) return fail("invalid", problem);
      if (value !== undefined && value !== "") answers[item.key] = value;
    }

    const { data: row, error } = await supabase
      .from("submissions")
      .update({ title: data.title, answers, is_public: data.isPublic })
      .eq("id", data.id)
      .select("*")
      .maybeSingle();
    if (error) return toFailure(error, "saving the submission");
    if (!row) {
      return (await noteRefusal(supabase, data.id))
        ? fail("forbidden", "Connect to the event's network to change your submission.")
        : fail("forbidden", "This submission is closed, so it can't be changed now.");
    }
    return ok(row);
  });

export const submitProjectFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { id?: unknown; submit?: unknown };
    return { id: requireId(raw.id, "id"), submit: raw.submit !== false };
  })
  .handler(async ({ data }): Promise<DbResult<Submission>> => {
    const supabase = createServerClient();
    if (data.submit) {
      const { data: current } = await supabase
        .from("submissions")
        .select("answers, form_id")
        .eq("id", data.id)
        .maybeSingle();
      const { data: rows } = current
        ? await supabase.from("submission_items").select("*").eq("form_id", current.form_id)
        : { data: null };
      const stored =
        current?.answers && typeof current.answers === "object" && !Array.isArray(current.answers)
          ? current.answers
          : {};
      const items = (rows ?? []).map(parseItem);
      for (const item of items.filter((each) => isPluginAnswerKind(each.kind))) {
        if (isPluginAnswerKind(item.kind)) await loadPluginAnswerValidator(item.kind);
        const problem = answerProblem(item, stored[item.key]);
        if (problem) return fail("invalid", problem);
      }
    }
    const { data: row, error } = await supabase.rpc("submit_project", {
      p_submission: data.id,
      p_submit: data.submit,
    });
    if (error) {
      await noteRefusal(supabase, data.id);
      return toFailure(error, data.submit ? "submitting" : "unsubmitting");
    }
    return ok(row);
  });

export const addSubmissionFileFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    const size = Number(raw.sizeBytes);
    if (!Number.isFinite(size) || size < 0) throw new Error("Bad file size");
    return {
      eventId: requireId(raw.eventId, "eventId"),
      submissionId: requireId(raw.submissionId, "submissionId"),
      itemKey: requireText(raw.itemKey, "Item", 60),
      storagePath: requireText(raw.storagePath, "Path", 500),
      fileName: requireText(raw.fileName, "File name", 200),
      sizeBytes: size,
    };
  })
  .handler(async ({ data }): Promise<DbResult<SubmissionFile>> => {
    const supabase = createServerClient();
    const { data: row, error } = await supabase
      .from("submission_files")
      .insert({
        event_id: data.eventId,
        submission_id: data.submissionId,
        item_key: data.itemKey,
        storage_path: data.storagePath,
        file_name: data.fileName,
        size_bytes: data.sizeBytes,
      })
      .select("*")
      .single();
    if (error) return toFailure(error, "saving the file");
    return ok(row);
  });

export const removeSubmissionFileFn = createServerFn({ method: "POST" })
  .validator((id: unknown) => requireId(id, "id"))
  .handler(async ({ data: id }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { data: row, error } = await supabase
      .from("submission_files")
      .delete()
      .eq("id", id)
      .select("storage_path")
      .maybeSingle();
    if (error) return toFailure(error, "removing the file");
    if (!row) return fail("forbidden", "That file can't be removed now.");
    await supabase.storage.from("submissions").remove([row.storage_path]);
    return ok(null);
  });

export const submissionDetailFn = createServerFn({ method: "GET" })
  .validator((id: unknown) => requireId(id, "id"))
  .handler(async ({ data: id }): Promise<DbResult<TeamSubmission | null>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("submissions")
      .select("*, teams(name), submission_files(*)")
      .eq("id", id)
      .maybeSingle();
    if (error) return toFailure(error, "loading the submission");
    if (!data) return ok(null);
    const { teams, submission_files, ...row } = data;
    return ok({ ...row, teamName: teams?.name ?? "A team", files: submission_files ?? [] });
  });

export const submissionDetailQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ["submission", id] as const,
    queryFn: async () => unwrap(await submissionDetailFn({ data: id })),
    retry: retryPolicy,
  });

export interface TeamSubmission extends Submission {
  teamName: string;
  files: SubmissionFile[];
}

export const eventSubmissionsFn = createServerFn({ method: "GET" })
  .validator((eventId: unknown) => requireId(eventId, "eventId"))
  .handler(async ({ data: eventId }): Promise<DbResult<TeamSubmission[]>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("submissions")
      .select("*, teams(name), submission_files(*)")
      .eq("event_id", eventId)
      .order("submitted_at", { ascending: false, nullsFirst: false });
    if (error) return toFailure(error, "loading submissions");
    return ok(
      (data ?? []).map(({ teams, submission_files, ...row }) => ({
        ...row,
        teamName: teams?.name ?? "A team",
        files: submission_files ?? [],
      })),
    );
  });

export const eventSubmissionsQueryOptions = (eventId: string) =>
  queryOptions({
    queryKey: ["event-submissions", eventId] as const,
    queryFn: async () => unwrap(await eventSubmissionsFn({ data: eventId })),
    retry: retryPolicy,
  });

export const setDisqualifiedFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { id?: unknown; disqualified?: unknown };
    return { id: requireId(raw.id, "id"), disqualified: raw.disqualified === true };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { data: current, error: readError } = await supabase
      .from("submissions")
      .select("submitted_at")
      .eq("id", data.id)
      .maybeSingle();
    if (readError) return toFailure(readError, "updating the submission");
    if (!current) return fail("not_found", "That submission is gone.");
    const { data: rows, error } = await supabase
      .from("submissions")
      .update({
        status: data.disqualified ? "disqualified" : current.submitted_at ? "submitted" : "draft",
      })
      .eq("id", data.id)
      .select("id");
    if (error) return toFailure(error, "updating the submission");
    if (!rows.length) return fail("forbidden", "Only organizers can change this.");
    return ok(null);
  });

export const deleteSubmissionFn = createServerFn({ method: "POST" })
  .validator((id: unknown) => requireId(id, "id"))
  .handler(async ({ data: id }): Promise<DbResult<"deleted" | "requested">> => {
    const supabase = createServerClient();
    const { data, error } = await supabase.rpc("delete_submission", { p_submission: id });
    if (error) {
      await noteRefusal(supabase, id);
      return toFailure(error, "deleting the submission");
    }
    return ok(data === "requested" ? "requested" : "deleted");
  });

export const cancelSubmissionDeletionFn = createServerFn({ method: "POST" })
  .validator((id: unknown) => requireId(id, "id"))
  .handler(async ({ data: id }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("cancel_submission_deletion", { p_submission: id });
    if (error) return toFailure(error, "cancelling the deletion request");
    return ok(null);
  });

const ITEM_KEY = /^[a-z][a-z0-9_]{0,39}$/;

function primitiveConfig(raw: unknown): Record<string, string | number | boolean> | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (!/^[a-z][A-Za-z0-9_]{0,39}$/.test(name) || CORE_CONFIG_KEYS.includes(name)) continue;
    if (typeof value === "string") out[name] = value.slice(0, 2000);
    else if (typeof value === "number" && Number.isFinite(value)) out[name] = value;
    else if (typeof value === "boolean") out[name] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

export interface FormDefinition {
  eventId: string;
  form: {
    id: string | null;
    key: string;
    title: string;
    descriptionMd: string;
    windowKey: string;
    judged: boolean;
    divisionIds: string[];
  };
  items: SubmissionItem[];
}

export const saveSubmissionFormFn = createServerFn({ method: "POST" })
  .validator((input: unknown): FormDefinition => {
    const raw = (input ?? {}) as { eventId?: unknown; form?: unknown; items?: unknown };
    const form = (raw.form ?? {}) as Record<string, unknown>;
    const key = typeof form.key === "string" ? form.key : "";
    if (!KEBAB.test(key)) throw new Error("The form key must be lowercase words with dashes");
    const windowKey = typeof form.windowKey === "string" ? form.windowKey : "submissions";
    if (!KEBAB.test(windowKey)) throw new Error("Unknown window");
    if (!Array.isArray(raw.items) || raw.items.length > 60) {
      throw new Error("A form has at most 60 items");
    }
    const seen = new Set<string>();
    const positive = (value: unknown) =>
      typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
    const items = raw.items.map((entry): SubmissionItem => {
      const item = (entry ?? {}) as Record<string, unknown>;
      const itemKey = typeof item.key === "string" ? item.key : "";
      if (!ITEM_KEY.test(itemKey)) throw new Error(`"${itemKey}" isn't a valid item key`);
      if (seen.has(itemKey)) throw new Error(`Two items use the key "${itemKey}"`);
      seen.add(itemKey);
      const kind =
        typeof item.kind === "string" &&
        (CORE_ANSWER_KINDS.some((candidate) => candidate === item.kind) ||
          isPluginAnswerKind(item.kind))
          ? (item.kind as SubmissionItemKind)
          : undefined;
      if (!kind) throw new Error("Unknown item type");
      const options = Array.isArray(item.options)
        ? item.options.filter((o): o is string => typeof o === "string" && !!o.trim())
        : [];
      if (kind === "select" && !options.length) throw new Error("A choice needs options");
      return {
        key: itemKey,
        label: requireText(item.label, "Item label", 200),
        help: typeof item.help === "string" && item.help.trim() ? item.help.trim() : null,
        kind,
        required: item.required === true,
        options,
        maxLength: positive(item.maxLength),
        accept:
          typeof item.accept === "string" && item.accept.trim() ? item.accept.trim() : undefined,
        maxMb: positive(item.maxMb),
        namesPeople: item.namesPeople === true || undefined,
        config: isPluginAnswerKind(kind) ? primitiveConfig(item.config) : undefined,
        divisionIds: idList(item.divisionIds, "Item divisions"),
        tagIds: idList(item.tagIds, "Item tags"),
      };
    });
    return {
      eventId: requireId(raw.eventId, "eventId"),
      form: {
        id: typeof form.id === "string" && form.id ? requireId(form.id, "form id") : null,
        key,
        title: requireText(form.title, "Title", 80),
        descriptionMd:
          typeof form.descriptionMd === "string" ? form.descriptionMd.slice(0, 5000) : "",
        windowKey,
        judged: form.judged !== false,
        divisionIds: Array.isArray(form.divisionIds)
          ? form.divisionIds.slice(0, 50).map((id) => requireId(id, "division"))
          : [],
      },
      items,
    };
  })
  .handler(async ({ data }): Promise<DbResult<SubmissionFormRow>> => {
    const supabase = createServerClient();
    const items: Json = data.items.map((item) => ({
      key: item.key,
      label: item.label,
      help: item.help ?? "",
      kind: item.kind,
      required: item.required,
      options: item.kind === "select" ? item.options : null,
      config: {
        ...(item.maxLength ? { maxLength: item.maxLength } : {}),
        ...(item.accept ? { accept: item.accept } : {}),
        ...(item.maxMb ? { maxMb: item.maxMb } : {}),
        ...(item.namesPeople ? { namesPeople: true } : {}),
        ...(item.config ?? {}),
      },
      division_ids: [...(item.divisionIds ?? [])],
      tag_ids: [...(item.tagIds ?? [])],
    }));
    const { data: row, error } = await supabase.rpc("save_submission_form", {
      p_event: data.eventId,
      p_form: {
        ...(data.form.id ? { id: data.form.id } : {}),
        key: data.form.key,
        title: data.form.title,
        description_md: data.form.descriptionMd,
        window_key: data.form.windowKey,
        judged: data.form.judged,
        division_ids: data.form.divisionIds,
      },
      p_items: items,
    });
    if (error) {
      if (error.code === "23505") return fail("conflict", "Another form already uses that key.");
      return toFailure(error, "saving the form");
    }
    return ok(row);
  });

export const deleteSubmissionFormFn = createServerFn({ method: "POST" })
  .validator((id: unknown) => requireId(id, "id"))
  .handler(async ({ data: id }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { count, error: countError } = await supabase
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("form_id", id);
    if (countError) return toFailure(countError, "deleting the form");
    if (count) {
      return fail(
        "conflict",
        `${plural(count, "team has", "teams have")} already started this one, so it can't be deleted.`,
      );
    }
    const { data: rows, error } = await supabase
      .from("submission_forms")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) return toFailure(error, "deleting the form");
    if (!rows.length) return fail("forbidden", "Only organizers can delete forms.");
    return ok(null);
  });
