import { createServerClient } from "@bogey/db/server";
import { getOrgFn } from "@bogey/db/tenant";
import { previewResultsFn } from "@bogey/db/queries/judging";
import { settingsForFn } from "@bogey/db/queries/settings";
import { jsonRecord, type Json, type Tables } from "@bogey/db/types";
import { readFields, type Answer, type FormField } from "@bogey/utils/registration-form";
import { scaleScores, type Normalize } from "@bogey/utils/score-scale";
import type { CsvCell } from "@bogey/utils/csv";
import { formatMessage } from "@bogey/utils/messages";
import { en } from "@bogey/config/messages";
import {
  csvResponse,
  xlsxResponse,
  zipResponse,
  type ZipEntry,
} from "#/lib/server/download.server.ts";
import { isExportKind, type ExportKind } from "#/lib/exports.ts";
import {
  availableColumns,
  columnId,
  columnNeed,
  isExportAccess,
  parseColumn,
  presetColumns,
  PROJECT_FIELDS,
  type ProjectExportAccess,
  type ProjectFieldKey,
} from "#/lib/project-export.ts";
import { ExportError, readAll, readAllIn } from "#/lib/server/export-reads.server.ts";

type Client = ReturnType<typeof createServerClient>;
type Event = Tables<"events">;

const LINK_SECONDS = 7 * 24 * 60 * 60;

function must<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new ExportError(500, result.error.message);
  if (result.data === null) throw new ExportError(500, "The database returned nothing.");
  return result.data;
}

const byId = <T extends { id: string }>(rows: Tuple<T>) =>
  new Map(rows.map((row) => [row.id, row]));

const yesNo = (value: boolean) => (value ? "yes" : "no");

function fileName(slug: string, kind: string, extension: string, suffix?: string): string {
  return [slug, kind, suffix].filter(Boolean).join("-") + `.${extension}`;
}

async function findEvent(supabase: Client, slug: string): Promise<Event> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user)
    throw new ExportError(401, "Your credentials are invalid or expired. Please log in again.");
  const org = await getOrgFn();
  if (!org.ok || !org.data) throw new ExportError(404, "There's no event at this address.");
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("org_id", org.data.id)
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new ExportError(500, error.message);
  if (!data) throw new ExportError(404, "There's no event at this address.");
  return data;
}

async function allowed(supabase: Client, event: Event, kind: ExportKind): Promise<void> {
  const { error } = await supabase.rpc("log_export", { p_event: event.id, p_kind: kind });
  if (error) throw new ExportError(403, "You can't download this.");
}

function isFileAnswer(answer: Answer): answer is Extract<Answer, { path: string }> {
  return typeof answer === "object" && !Array.isArray(answer) && "path" in answer;
}

function answerText(answer: Answer | undefined, links: ReadonlyMap<string, string>): string {
  if (answer === undefined) return "";
  if (typeof answer === "boolean") return yesNo(answer);
  if (typeof answer === "string" || typeof answer === "number") return String(answer);
  if (Array.isArray(answer)) return answer.join("; ");
  if (isFileAnswer(answer)) return links.get(answer.path) ?? answer.name;
  return answer.at ? `agreed ${answer.at}` : "agreed";
}

function readAnswers(raw: Json): Record<string, Answer> {
  const out: Record<string, Answer> = {};
  for (const [key, value] of Object.entries(jsonRecord(raw))) {
    if (value === undefined || value === null) continue;
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      (Array.isArray(value) && value.every((entry) => typeof entry === "string"))
    ) {
      out[key] = value as Answer;
      continue;
    }
    const record = jsonRecord(value);
    if (typeof record.path === "string") {
      out[key] = {
        path: record.path,
        name: typeof record.name === "string" ? record.name : record.path,
        size: typeof record.size === "number" ? record.size : 0,
        type: typeof record.type === "string" ? record.type : "",
      };
    } else if (record.accepted === true) {
      out[key] = {
        accepted: true,
        ...(typeof record.at === "string" ? { at: record.at } : {}),
      };
    }
  }
  return out;
}

async function registrations(supabase: Client, event: Event): Promise<Response> {
  const [rows, form, divisions] = await Promise.all([
    readAll((from, to) =>
      supabase
        .from("registrations")
        .select("*")
        .eq("event_id", event.id)
        .order("created_at")
        .order("id")
        .range(from, to),
    ),
    supabase.from("onboarding_forms").select("fields").eq("event_id", event.id).maybeSingle(),
    supabase.from("divisions").select("id, name").eq("event_id", event.id),
  ]);
  const fields: FormField[] = readFields(form.data?.fields);
  const divisionNames = new Map(must(divisions).map((division) => [division.id, division.name]));

  const parsed = rows.map((row) => ({ row, answers: readAnswers(row.answers) }));
  const paths = parsed.flatMap(({ answers }) =>
    Object.values(answers).flatMap((answer) => (isFileAnswer(answer) ? [answer.path] : [])),
  );
  const links = new Map<string, string>();
  if (paths.length > 0) {
    const signed = await supabase.storage
      .from("registrations")
      .createSignedUrls(paths, LINK_SECONDS);
    for (const entry of signed.data ?? []) {
      if (entry.path && entry.signedUrl) links.set(entry.path, entry.signedUrl);
    }
  }

  return csvResponse(
    fileName(event.slug, "registrations", "csv"),
    [
      "Email",
      "Name",
      "Role",
      "Status",
      "Division",
      "Source",
      "Registered at",
      "Reviewed at",
      ...fields.map((field) => field.label),
    ],
    parsed.map(({ row, answers }) => [
      row.email,
      row.full_name,
      row.role,
      row.status,
      row.division_id ? divisionNames.get(row.division_id) : "",
      row.source,
      row.created_at,
      row.reviewed_at,
      ...fields.map((field) => answerText(answers[field.key], links)),
    ]),
  );
}

async function members(supabase: Client, event: Event): Promise<Response> {
  const [people, regs, teamRows, teamMembers, checkins, divisions] = await Promise.all([
    readAll((from, to) =>
      supabase
        .from("event_members")
        .select("*")
        .eq("event_id", event.id)
        .order("created_at")
        .order("user_id")
        .range(from, to),
    ),
    readAll((from, to) =>
      supabase
        .from("registrations")
        .select("id, user_id, email, full_name")
        .eq("event_id", event.id)
        .not("user_id", "is", null)
        .order("id")
        .range(from, to),
    ),
    supabase.from("teams").select("id, name").eq("event_id", event.id),
    readAll((from, to) =>
      supabase
        .from("team_members")
        .select("team_id, user_id")
        .eq("event_id", event.id)
        .order("user_id")
        .range(from, to),
    ),
    readAll((from, to) =>
      supabase
        .from("checkins")
        .select("user_id, checked_in_at, checked_out_at, method")
        .eq("event_id", event.id)
        .order("user_id")
        .range(from, to),
    ),
    supabase.from("divisions").select("id, name").eq("event_id", event.id),
  ]);
  const profiles = await readAllIn(
    people.map((person) => person.user_id),
    (ids, from, to) =>
      supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", ids)
        .order("id")
        .range(from, to),
  );
  const names = new Map(profiles.map((profile) => [profile.id, profile.display_name]));
  const registration = new Map(regs.flatMap((row) => (row.user_id ? [[row.user_id, row]] : [])));
  const teamNames = new Map(must(teamRows).map((team) => [team.id, team.name]));
  const teamOf = new Map(teamMembers.map((row) => [row.user_id, teamNames.get(row.team_id)]));
  const checkin = new Map(checkins.map((row) => [row.user_id, row]));
  const divisionNames = new Map(must(divisions).map((division) => [division.id, division.name]));

  return csvResponse(
    fileName(event.slug, "members", "csv"),
    [
      "Name",
      "Email",
      "Role",
      "Status",
      "Division",
      "Team",
      "Checked in at",
      "Checked out at",
      "Check-in method",
      "Joined at",
    ],
    people.map((person) => {
      const reg = registration.get(person.user_id);
      const stamp = checkin.get(person.user_id);
      return [
        names.get(person.user_id) ?? reg?.full_name,
        reg?.email,
        person.role,
        person.status,
        person.division_id ? divisionNames.get(person.division_id) : "",
        teamOf.get(person.user_id),
        stamp?.checked_in_at,
        stamp?.checked_out_at,
        stamp?.method,
        person.created_at,
      ];
    }),
  );
}

async function teams(supabase: Client, event: Event): Promise<Response> {
  const [rows, memberRows, divisions] = await Promise.all([
    readAll((from, to) =>
      supabase
        .from("teams")
        .select("*")
        .eq("event_id", event.id)
        .order("name")
        .order("id")
        .range(from, to),
    ),
    readAll((from, to) =>
      supabase
        .from("team_members")
        .select("team_id, user_id, role")
        .eq("event_id", event.id)
        .order("team_id")
        .order("user_id")
        .range(from, to),
    ),
    supabase.from("divisions").select("id, name").eq("event_id", event.id),
  ]);
  const profiles = await readAllIn(
    memberRows.map((row) => row.user_id),
    (ids, from, to) =>
      supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", ids)
        .order("id")
        .range(from, to),
  );
  const names = new Map(profiles.map((profile) => [profile.id, profile.display_name]));
  const divisionNames = new Map(must(divisions).map((division) => [division.id, division.name]));
  const byTeam = Map.groupBy(memberRows, (row) => row.team_id);

  return csvResponse(
    fileName(event.slug, "teams", "csv"),
    ["Team", "Division", "Members", "Captain", "Member names", "Locked", "Created at"],
    rows.map((team) => {
      const people = byTeam.get(team.id) ?? [];
      return [
        team.name,
        team.division_id ? divisionNames.get(team.division_id) : "",
        people.length,
        people
          .filter((row) => row.role === "captain")
          .map((row) => names.get(row.user_id))
          .join("; "),
        people.map((row) => names.get(row.user_id)).join("; "),
        yesNo(team.locked_at !== null),
        team.created_at,
      ];
    }),
  );
}

async function findForm(supabase: Client, event: Event, key: string | null) {
  const forms = must(
    await supabase.from("submission_forms").select("*").eq("event_id", event.id).order("sort"),
  );
  const form = key
    ? forms.find((candidate) => candidate.key === key)
    : forms.length === 1
      ? forms[0]
      : null;
  if (!form) throw new ExportError(400, "Say which form to export with ?form=<key>.");
  return form;
}

async function namesOf(supabase: Client, ids: Tuple<string>): Promise<Map<string, string>> {
  const profiles = await readAllIn(ids, (chunk, from, to) =>
    supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", chunk)
      .order("id")
      .range(from, to),
  );
  return new Map(profiles.map((profile) => [profile.id, profile.display_name]));
}

interface ExportResult {
  roundName: string;
  rank: number | null;
  divisionRank: number | null;
  score: number | null;
  rawScore: number | null;
  judges: number | null;
  criteria: Record<string, number>;
}

function parseExportResults(raw: Json): Map<string, ExportResult> {
  const out = new Map<string, ExportResult>();
  if (!Array.isArray(raw)) return out;
  for (const entry of raw) {
    const row = jsonRecord(entry);
    if (typeof row.submission_id !== "string") continue;
    const number = (value: Json | undefined) => (typeof value === "number" ? value : null);
    const criteria: Record<string, number> = {};
    for (const [id, mean] of Object.entries(jsonRecord(row.criteria ?? null))) {
      if (typeof mean === "number") criteria[id] = mean;
    }
    out.set(row.submission_id, {
      roundName: typeof row.round_name === "string" ? row.round_name : "",
      rank: number(row.rank),
      divisionRank: number(row.division_rank),
      score: number(row.score),
      rawScore: number(row.raw_score),
      judges: number(row.judges),
      criteria,
    });
  }
  return out;
}

async function exportAccess(supabase: Client, event: Event): Promise<ProjectExportAccess> {
  const { data, error } = await supabase.rpc("project_export_access", { p_event: event.id });
  if (error) throw new ExportError(500, error.message);
  return isExportAccess(data) ? data : "off";
}

// one row per project of a form; `fields` picks the columns (the basic preset when it's missing)
async function submissions(
  supabase: Client,
  event: Event,
  params: URLSearchParams,
): Promise<Response> {
  const form = await findForm(supabase, event, params.get("form"));
  const [access, items, criteriaRows] = await Promise.all([
    exportAccess(supabase, event),
    supabase.from("submission_items").select("*").eq("form_id", form.id).order("sort"),
    supabase.from("criteria").select("id, label").eq("event_id", event.id).order("sort"),
  ]);
  const itemList = must(items);
  const criteria = must(criteriaRows);
  const available = availableColumns(itemList, criteria, access);
  const requested = params.get("fields");
  const allowed = new Set(available.map(columnId));
  const columns = requested
    ? requested.split(",").flatMap((id) => {
        const column = parseColumn(id.trim());
        return column && allowed.has(columnId(column)) ? [column] : [];
      })
    : presetColumns("basic", available);
  if (columns.length === 0) throw new ExportError(400, "Pick at least one column to export.");
  const wants = (key: ProjectFieldKey) =>
    columns.some((column) => column.kind === "field" && column.key === key);
  const wantsResults = columns.some(
    (column) =>
      column.kind === "criterion" || (column.kind === "field" && columnNeed(column) === "results"),
  );

  const [rows, teamRows, trackRows, links, files, divisions] = await Promise.all([
    readAll((from, to) =>
      supabase
        .from("submissions")
        .select("*")
        .eq("form_id", form.id)
        .order("created_at")
        .order("id")
        .range(from, to),
    ),
    supabase.from("teams").select("id, name, division_id").eq("event_id", event.id),
    supabase.from("tracks").select("id, name").eq("event_id", event.id),
    readAll((from, to) =>
      supabase
        .from("submission_tracks")
        .select("submission_id, track_id")
        .eq("event_id", event.id)
        .order("submission_id")
        .order("track_id")
        .range(from, to),
    ),
    readAll((from, to) =>
      supabase
        .from("submission_files")
        .select("submission_id, item_key, file_name")
        .eq("event_id", event.id)
        .order("id")
        .range(from, to),
    ),
    supabase.from("divisions").select("id, name").eq("event_id", event.id),
  ]);
  const teamById = byId(must(teamRows));
  const trackNames = new Map(must(trackRows).map((track) => [track.id, track.name]));
  const divisionNames = new Map(must(divisions).map((division) => [division.id, division.name]));
  const tracksOf = Map.groupBy(links, (row) => row.submission_id);
  const filesOf = Map.groupBy(files, (row) => row.submission_id);
  const criterionLabels = new Map(criteria.map((criterion) => [criterion.id, criterion.label]));
  const itemByKey = new Map(itemList.map((item) => [item.key, item]));

  const membersOf = new Map<string, { name: string; email: string }[]>();
  if (wants("members") || wants("emails")) {
    const [memberRows, regs] = await Promise.all([
      readAll((from, to) =>
        supabase
          .from("team_members")
          .select("team_id, user_id, role")
          .eq("event_id", event.id)
          .order("team_id")
          .order("user_id")
          .range(from, to),
      ),
      readAll((from, to) =>
        supabase
          .from("registrations")
          .select("id, user_id, email, full_name")
          .eq("event_id", event.id)
          .not("user_id", "is", null)
          .order("id")
          .range(from, to),
      ),
    ]);
    const names = await namesOf(
      supabase,
      memberRows.map((row) => row.user_id),
    );
    const registration = new Map(regs.flatMap((row) => (row.user_id ? [[row.user_id, row]] : [])));
    for (const row of memberRows) {
      const reg = registration.get(row.user_id);
      const list = membersOf.get(row.team_id) ?? [];
      list.push({ name: names.get(row.user_id) ?? reg?.full_name ?? "", email: reg?.email ?? "" });
      membersOf.set(row.team_id, list);
    }
  }

  const [results, awardRows, voteRows] = await Promise.all([
    wantsResults
      ? supabase.rpc("project_export_results", { p_event: event.id })
      : Promise.resolve(null),
    wants("awards")
      ? supabase
          .from("awards")
          .select("submission_id, label")
          .eq("event_id", event.id)
          .order("sort")
      : Promise.resolve(null),
    wants("votes") ? supabase.rpc("vote_counts", { p_event: event.id }) : Promise.resolve(null),
  ]);
  const resultOf = results ? parseExportResults(must(results)) : new Map<string, ExportResult>();
  const awardsOf = Map.groupBy(awardRows ? must(awardRows) : [], (row) => row.submission_id);
  const votesOf = new Map(
    (voteRows ? must(voteRows) : []).map((row) => [row.submission_id, row.votes]),
  );

  const header = columns.map((column) => {
    if (column.kind === "answer") return itemByKey.get(column.key)?.label ?? column.key;
    if (column.kind === "criterion")
      return formatMessage(en["projectExport.criterionColumn"], {
        criterion: criterionLabels.get(column.key) ?? column.key,
      });
    return en[
      PROJECT_FIELDS.find((field) => field.key === column.key)?.label ?? "projectExport.field.title"
    ];
  });

  const body = rows.map((row) => {
    const team = teamById.get(row.team_id);
    const result = resultOf.get(row.id);
    const answers = jsonRecord(row.answers);
    const people = membersOf.get(row.team_id) ?? [];
    const answer = (key: string): CsvCell => {
      if (itemByKey.get(key)?.kind === "file") {
        return (filesOf.get(row.id) ?? [])
          .filter((file) => file.item_key === key)
          .map((file) => file.file_name)
          .join("; ");
      }
      const value = answers[key];
      if (typeof value === "boolean") return yesNo(value);
      if (Array.isArray(value))
        return value.filter((entry) => typeof entry === "string").join("; ");
      return typeof value === "string" || typeof value === "number" ? value : "";
    };
    const field = (key: ProjectFieldKey): CsvCell => {
      switch (key) {
        case "title":
          return row.title;
        case "team":
          return team?.name;
        case "members":
          return people.map((person) => person.name).join("; ");
        case "emails":
          return people
            .map((person) => person.email)
            .filter(Boolean)
            .join("; ");
        case "division":
          return team?.division_id ? divisionNames.get(team.division_id) : "";
        case "tracks":
          return (tracksOf.get(row.id) ?? [])
            .map((link) => trackNames.get(link.track_id))
            .join("; ");
        case "status":
          return row.status;
        case "submittedAt":
          return row.submitted_at;
        case "table":
          return row.table_label;
        case "public":
          return yesNo(row.is_public);
        case "round":
          return result?.roundName;
        case "rank":
          return result?.rank;
        case "divisionRank":
          return result?.divisionRank;
        case "score":
          return result?.score;
        case "rawScore":
          return result?.rawScore;
        case "judges":
          return result?.judges;
        case "awards":
          return (awardsOf.get(row.id) ?? []).map((award) => award.label).join("; ");
        case "votes":
          return votesOf.get(row.id) ?? 0;
      }
    };
    return columns.map((column) =>
      column.kind === "field"
        ? field(column.key)
        : column.kind === "answer"
          ? answer(column.key)
          : result?.criteria[column.key],
    );
  });
  const rankAt = columns.findIndex((column) => column.kind === "field" && column.key === "rank");
  if (rankAt >= 0) {
    const rankOf = (cells: Tuple<CsvCell>) => {
      const value = cells[rankAt];
      return typeof value === "number" ? value : Infinity;
    };
    body.sort((a, b) => rankOf(a) - rankOf(b));
  }

  if (params.get("format") === "xlsx") {
    return xlsxResponse(
      fileName(event.slug, "projects", "xlsx", form.key),
      form.title,
      header,
      body,
    );
  }
  return csvResponse(fileName(event.slug, "projects", "csv", form.key), header, body);
}

const safeSegment = (text: string) =>
  [...text]
    .map((char) => (char.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(char) ? "_" : char))
    .join("")
    .replace(/^\.+/, "_")
    .trim()
    .slice(0, 80) || "untitled";

async function* chunksOf(blob: Blob): AsyncGenerator<Uint8Array, void, undefined> {
  const reader = blob.stream().getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

async function submissionFiles(
  supabase: Client,
  event: Event,
  formKey: string | null,
): Promise<Response> {
  const form = await findForm(supabase, event, formKey);
  const subs = await readAll((from, to) =>
    supabase
      .from("submissions")
      .select("id, title, team_id")
      .eq("form_id", form.id)
      .order("id")
      .range(from, to),
  );
  const teamById = byId(
    must(await supabase.from("teams").select("id, name").eq("event_id", event.id)),
  );
  const files = await readAllIn(
    subs.map((sub) => sub.id),
    (ids, from, to) =>
      supabase
        .from("submission_files")
        .select("*")
        .in("submission_id", ids)
        .order("submission_id")
        .order("sort")
        .order("id")
        .range(from, to),
  );
  const subById = byId(subs);

  async function* entries(): AsyncGenerator<ZipEntry, void, undefined> {
    const used = new Set<string>();
    for (const file of files) {
      const sub = subById.get(file.submission_id);
      const team = sub ? teamById.get(sub.team_id)?.name : undefined;
      const folder = safeSegment(`${team ?? "team"} - ${sub?.title ?? "submission"}`);
      let name = `${folder}/${safeSegment(file.item_key)}/${safeSegment(file.file_name)}`;
      for (let n = 2; used.has(name); n += 1)
        name = `${folder}/${safeSegment(file.item_key)}/${n}-${safeSegment(file.file_name)}`;
      used.add(name);
      const { data, error } = await supabase.storage
        .from("submissions")
        .download(file.storage_path);
      if (error || !data) continue;
      yield { name, chunks: chunksOf(data) };
    }
  }

  return zipResponse(fileName(event.slug, "submission-files", "zip", form.key), entries());
}

async function normalizeMode(event: Event): Promise<Normalize> {
  const settings = await settingsForFn({ data: { eventId: event.id, namespaces: ["judging"] } });
  if (!settings.ok) return "none";
  const value = jsonRecord(settings.data.judging).normalize;
  return value === "minmax" || value === "zscore" ? value : "none";
}

async function scores(supabase: Client, event: Event): Promise<Response> {
  const [rows, criteria, rounds, subs, teamRows, mode] = await Promise.all([
    readAll((from, to) =>
      supabase.from("scores").select("*").eq("event_id", event.id).order("id").range(from, to),
    ),
    supabase.from("criteria").select("*").eq("event_id", event.id),
    supabase.from("judging_rounds").select("*").eq("event_id", event.id),
    readAll((from, to) =>
      supabase
        .from("submissions")
        .select("id, title, team_id")
        .eq("event_id", event.id)
        .order("id")
        .range(from, to),
    ),
    supabase.from("teams").select("id, name").eq("event_id", event.id),
    normalizeMode(event),
  ]);
  const criterionById = byId(must(criteria));
  const roundById = byId(must(rounds));
  const subById = byId(subs);
  const teamById = byId(must(teamRows));
  const judges = await namesOf(
    supabase,
    rows.map((row) => row.judge_id),
  );

  const known = rows.flatMap((row) => {
    const criterion = criterionById.get(row.criterion_id);
    return criterion ? [{ row, criterion }] : [];
  });
  const scaled = scaleScores(
    known.map(({ row, criterion }) => ({
      judgeId: row.judge_id,
      roundId: row.round_id,
      criterionId: row.criterion_id,
      value: row.value,
      min: criterion.min_score,
      max: criterion.max_score,
    })),
    mode,
  );

  return csvResponse(
    fileName(event.slug, "scores", "csv"),
    [
      "Round",
      "Judge",
      "Team",
      "Project",
      "Criterion",
      "Score",
      "Range",
      "Normalized",
      "Weight",
      "Scored at",
    ],
    known.map(({ row, criterion }, index) => {
      const sub = subById.get(row.submission_id);
      return [
        roundById.get(row.round_id)?.name,
        judges.get(row.judge_id),
        sub ? teamById.get(sub.team_id)?.name : "",
        sub?.title,
        criterion.label,
        row.value,
        `${criterion.min_score}-${criterion.max_score}`,
        Math.round((scaled[index]?.adjusted ?? 0) * 10_000) / 10_000,
        criterion.weight,
        row.updated_at,
      ];
    }),
  );
}

async function results(supabase: Client, event: Event): Promise<Response> {
  const ranking = await previewResultsFn({ data: event.id });
  if (!ranking.ok) throw new ExportError(500, ranking.error.message);
  const divisions = await supabase.from("divisions").select("id, name").eq("event_id", event.id);
  const divisionNames = new Map(must(divisions).map((division) => [division.id, division.name]));
  return csvResponse(
    fileName(event.slug, "results", "csv"),
    [
      "Form",
      "Round",
      "Rank",
      "Division rank",
      "Division",
      "Team",
      "Project",
      "Score",
      "Score without normalization",
      "Judges",
      "Judges left out for a conflict",
    ],
    ranking.data.map((row) => [
      row.formTitle,
      row.roundName,
      row.rank,
      row.divisionRank,
      row.divisionId ? divisionNames.get(row.divisionId) : "",
      row.teamName,
      row.title,
      row.score,
      row.rawScore,
      row.judges,
      row.conflicted,
    ]),
  );
}

async function awards(supabase: Client, event: Event): Promise<Response> {
  const [rows, subs, teamRows, tracks] = await Promise.all([
    supabase.from("awards").select("*").eq("event_id", event.id).order("sort"),
    readAll((from, to) =>
      supabase
        .from("submissions")
        .select("id, title, team_id")
        .eq("event_id", event.id)
        .order("id")
        .range(from, to),
    ),
    supabase.from("teams").select("id, name").eq("event_id", event.id),
    supabase.from("tracks").select("id, name, prize_md, sponsor_name").eq("event_id", event.id),
  ]);
  const subById = byId(subs);
  const teamById = byId(must(teamRows));
  const trackById = byId(must(tracks));
  return csvResponse(
    fileName(event.slug, "awards", "csv"),
    ["Award", "Kind", "Place", "Track", "Sponsor", "Prize", "Team", "Project", "Note"],
    must(rows).map((award) => {
      const sub = subById.get(award.submission_id);
      const track = award.track_id ? trackById.get(award.track_id) : undefined;
      return [
        award.label,
        award.kind,
        award.place,
        track?.name,
        track?.sponsor_name,
        track?.prize_md,
        sub ? teamById.get(sub.team_id)?.name : "",
        sub?.title,
        award.note_md,
      ];
    }),
  );
}

async function attendance(supabase: Client, event: Event): Promise<Response> {
  const [rows, sessions] = await Promise.all([
    supabase.rpc("event_attendance", { p_event: event.id }),
    supabase.from("event_sessions").select("id, name").eq("event_id", event.id),
  ]);
  const names = new Map(must(sessions).map((session) => [session.id, session.name]));
  return csvResponse(
    fileName(event.slug, "attendance", "csv"),
    ["Name", "Session", "Expected", "Attended at"],
    must(rows).map((row) => [
      row.display_name,
      names.get(row.session_id) ?? row.session_id,
      yesNo(row.expected),
      row.attended_at,
    ]),
  );
}

async function votes(supabase: Client, event: Event): Promise<Response> {
  const [rows, subs, teamRows] = await Promise.all([
    supabase.rpc("vote_counts", { p_event: event.id }),
    readAll((from, to) =>
      supabase
        .from("submissions")
        .select("id, title, team_id")
        .eq("event_id", event.id)
        .order("id")
        .range(from, to),
    ),
    supabase.from("teams").select("id, name").eq("event_id", event.id),
  ]);
  const subById = byId(subs);
  const teamById = byId(must(teamRows));
  return csvResponse(
    fileName(event.slug, "votes", "csv"),
    ["Team", "Project", "Votes"],
    must(rows)
      .map((row) => ({ row, sub: subById.get(row.submission_id) }))
      .sort((a, b) => b.row.votes - a.row.votes)
      .map(({ row, sub }) => [sub ? teamById.get(sub.team_id)?.name : "", sub?.title, row.votes]),
  );
}

async function audit(supabase: Client, event: Event): Promise<Response> {
  const rows = await readAll((from, to) =>
    supabase
      .from("audit_log")
      .select("*")
      .eq("event_id", event.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to),
  );
  const actors = await namesOf(
    supabase,
    rows.flatMap((row) => (row.actor_id ? [row.actor_id] : [])),
  );
  return csvResponse(
    fileName(event.slug, "audit", "csv"),
    ["When", "Who", "Action", "Target type", "Target", "Details"],
    rows.map((row) => [
      row.created_at,
      row.actor_id ? actors.get(row.actor_id) : "",
      row.action,
      row.target_type,
      row.target_id,
      JSON.stringify(row.meta),
    ]),
  );
}

export async function exportResponse(
  slug: string,
  rawKind: string,
  params: URLSearchParams,
): Promise<Response> {
  const formKey = params.get("form");
  try {
    if (!isExportKind(rawKind)) throw new ExportError(404, "There's no such export.");
    const supabase = createServerClient();
    const event = await findEvent(supabase, slug);
    await allowed(supabase, event, rawKind);
    switch (rawKind) {
      case "registrations":
        return await registrations(supabase, event);
      case "members":
        return await members(supabase, event);
      case "teams":
        return await teams(supabase, event);
      case "submissions":
        return await submissions(supabase, event, params);
      case "submission-files":
        return await submissionFiles(supabase, event, formKey);
      case "scores":
        return await scores(supabase, event);
      case "results":
        return await results(supabase, event);
      case "awards":
        return await awards(supabase, event);
      case "attendance":
        return await attendance(supabase, event);
      case "votes":
        return await votes(supabase, event);
      case "audit":
        return await audit(supabase, event);
    }
  } catch (error) {
    const status = error instanceof ExportError ? error.status : 500;
    const message = error instanceof ExportError ? error.message : "The export failed.";
    return new Response(message, {
      status,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "private, no-store",
      },
    });
  }
}
