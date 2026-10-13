import type { Json } from "../types.ts";
import { ARCHIVE_FORMAT, ARCHIVE_TABLES, type TableSpec } from "./spec.ts";

export type Row = { [column: string]: Json | undefined };

export interface Person {
  id: string;
  email: string;
  displayName: string;
}

export interface FileRef {
  bucket: string;
  path: string;
}

export interface Manifest {
  format: number;
  exportedAt: string;
  org: { slug: string; name: string };
  event: { slug: string; name: string };
  tables: Record<string, number>;
  people: Person[];
  files: FileRef[];
}

export interface ArchiveData {
  manifest: Manifest;
  tables: ReadonlyMap<string, readonly Row[]>;
}

function isRecord(value: Json | undefined): value is { [key: string]: Json | undefined } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function filesOf(tables: ReadonlyMap<string, readonly Row[]>): FileRef[] {
  const files: FileRef[] = [];
  for (const row of tables.get("submission_files") ?? []) {
    if (typeof row.storage_path === "string")
      files.push({ bucket: "submissions", path: row.storage_path });
  }
  const visit = (value: Json | undefined): void => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (isRecord(value)) {
      if (typeof value.path === "string") files.push({ bucket: "registrations", path: value.path });
      Object.values(value).forEach(visit);
    }
  };
  for (const row of tables.get("registrations") ?? []) visit(row.answers);
  const seen = new Set<string>();
  return files.filter((file) => {
    const key = `${file.bucket}/${file.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildManifest(
  info: Pick<Manifest, "org" | "event" | "people" | "exportedAt">,
  tables: ReadonlyMap<string, readonly Row[]>,
): Manifest {
  return {
    format: ARCHIVE_FORMAT,
    exportedAt: info.exportedAt,
    org: info.org,
    event: info.event,
    tables: Object.fromEntries([...tables].map(([name, rows]) => [name, rows.length])),
    people: info.people,
    files: filesOf(tables),
  };
}

export interface ImportOptions {
  orgId: string;
  slug: string;
  name?: string;
  shiftMs: number;
  people: boolean;
  users: ReadonlyMap<string, string>;
  newId: () => string;
}

export interface Step {
  table: string;
  replace: boolean;
  rows: Row[];
}

export interface FileCopy {
  bucket: string;
  from: string;
  to: string;
}

export interface Plan {
  eventId: string;
  steps: Step[];
  files: FileCopy[];
  skipped: Record<string, number>;
}

const REQUIRED_PERSON = new Set(["user_id", "judge_id", "voter_id"]);

export function remapString(value: string, ids: ReadonlyMap<string, string>): string {
  const whole = ids.get(value);
  if (whole !== undefined) return whole;
  if (!value.includes("/")) return value;
  return value
    .split("/")
    .map((part) => ids.get(part) ?? part)
    .join("/");
}

export function remapJson(
  value: Json | undefined,
  ids: ReadonlyMap<string, string>,
): Json | undefined {
  if (typeof value === "string") return remapString(value, ids);
  if (Array.isArray(value)) return value.map((entry) => remapJson(entry, ids) ?? null);
  if (isRecord(value)) {
    const out: { [key: string]: Json | undefined } = {};
    for (const [key, entry] of Object.entries(value)) out[key] = remapJson(entry, ids);
    return out;
  }
  return value;
}

function shiftDate(value: Json | undefined, shiftMs: number): Json | undefined {
  if (typeof value !== "string" || shiftMs === 0) return value;
  const time = Date.parse(value);
  return Number.isNaN(time) ? value : new Date(time + shiftMs).toISOString();
}

export function planImport(data: ArchiveData, options: ImportOptions): Plan {
  if (data.manifest.format !== ARCHIVE_FORMAT) {
    throw new Error(
      `This archive is format ${data.manifest.format}; this version of Bogey reads format ${ARCHIVE_FORMAT}.`,
    );
  }
  const specs = ARCHIVE_TABLES.filter(
    (spec) => !spec.exportOnly && (options.people || !spec.people),
  );

  const ids = new Map<string, string>();
  for (const spec of specs) {
    if (!spec.id) continue;
    for (const row of data.tables.get(spec.table) ?? []) {
      const old = row[spec.id];
      if (typeof old === "string" && !ids.has(old)) ids.set(old, options.newId());
    }
  }
  const oldEvent = (data.tables.get("events") ?? [])[0]?.id;
  if (typeof oldEvent !== "string") throw new Error("The archive has no event in it.");
  const eventId = ids.get(oldEvent);
  if (!eventId) throw new Error("The archive's event has no id.");

  const everything = new Map<string, string>([...ids, ...options.users]);
  const skipped: Record<string, number> = {};
  const steps: Step[] = [];
  const files: FileCopy[] = [];

  const mapRow = (spec: TableSpec, row: Row): Row | null => {
    const out: Row = {};
    for (const [column, value] of Object.entries(row)) {
      if (spec.omit.includes(column)) continue;
      out[column] = remapJson(value, everything);
    }
    if (spec.id) {
      const old = row[spec.id];
      if (typeof old === "string") out[spec.id] = ids.get(old);
    }
    if (spec.table !== "events") out[spec.event] = eventId;
    for (const [column, ref] of Object.entries(spec.refs)) {
      const old = row[column];
      if (typeof old !== "string") continue;
      const mapped = ref === "user" ? options.users.get(old) : ids.get(old);
      if (mapped === undefined) {
        if (ref === "user" && !REQUIRED_PERSON.has(column)) {
          out[column] = null;
          continue;
        }
        return null;
      }
      out[column] = mapped;
    }
    for (const column of spec.dates) out[column] = shiftDate(out[column], options.shiftMs);
    for (const column of spec.clear) out[column] = null;

    if (spec.table === "events") {
      out.org_id = options.orgId;
      out.slug = options.slug;
      if (options.name) out.name = options.name;
      out.visibility = "draft";
    }
    if (spec.table === "announcements") out.also_notify = false;
    if (spec.table === "submission_files" && typeof row.storage_path === "string") {
      const to = remapString(row.storage_path, everything);
      out.storage_path = to;
      files.push({ bucket: "submissions", from: row.storage_path, to });
    }
    return out;
  };

  for (const spec of specs) {
    const rows: Row[] = [];
    for (const row of data.tables.get(spec.table) ?? []) {
      const mapped = mapRow(spec, row);
      if (mapped) rows.push(mapped);
      else skipped[spec.table] = (skipped[spec.table] ?? 0) + 1;
    }
    if (rows.length > 0 || spec.replace)
      steps.push({ table: spec.table, replace: spec.replace, rows });
  }

  if (options.people) {
    const seen = new Set(files.map((file) => file.from));
    for (const file of data.manifest.files) {
      if (file.bucket === "registrations" && !seen.has(file.path)) {
        files.push({
          bucket: file.bucket,
          from: file.path,
          to: remapString(file.path, everything),
        });
      }
    }
  }
  return { eventId, steps, files, skipped };
}

export function shiftTo(data: ArchiveData, startsAt: string): number {
  const old = (data.tables.get("events") ?? [])[0]?.starts_at;
  const was = typeof old === "string" ? Date.parse(old) : Number.NaN;
  const now = Date.parse(startsAt);
  if (Number.isNaN(was)) throw new Error("The archived event has no start date to move from.");
  if (Number.isNaN(now)) throw new Error(`"${startsAt}" is not a date.`);
  return now - was;
}
