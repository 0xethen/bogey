import { z } from "zod";
import type { Json } from "../types.ts";
import {
  buildManifest,
  type ArchiveData,
  type FileRef,
  type Manifest,
  type Person,
  type Plan,
  type Row,
} from "./engine.ts";
import { ARCHIVE_FORMAT, ARCHIVE_TABLES, type TableSpec } from "./spec.ts";

const json: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(json),
    z.record(z.string(), json),
  ]),
);
const rowSchema: z.ZodType<Row> = z.record(z.string(), json.optional());
const rowsSchema = z.array(rowSchema);

const manifestSchema: z.ZodType<Manifest> = z.object({
  format: z.number(),
  exportedAt: z.string(),
  org: z.object({ slug: z.string(), name: z.string() }),
  event: z.object({ slug: z.string(), name: z.string() }),
  tables: z.record(z.string(), z.number()),
  people: z.array(z.object({ id: z.string(), email: z.string(), displayName: z.string() })),
  files: z.array(z.object({ bucket: z.string(), path: z.string() })),
});

export interface RestAccess {
  url: string;
  apikey: string;
  bearer: string;
}

function headers(access: RestAccess): Record<string, string> {
  return { apikey: access.apikey, authorization: `Bearer ${access.bearer}` };
}

async function getJson(access: RestAccess, path: string): Promise<unknown> {
  const response = await fetch(`${access.url}${path}`, { headers: headers(access) });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${path.split("?")[0]}: ${response.status} ${text.slice(0, 200)}`);
  }
  return text ? JSON.parse(text) : null;
}

const PAGE = 1000;

function filterFor(spec: TableSpec, eventId: string): string {
  const own = `${spec.event}=eq.${encodeURIComponent(eventId)}`;
  return spec.table === "settings" ? `${own}&scope=eq.event` : own;
}

export async function readRows(
  access: RestAccess,
  spec: TableSpec,
  eventId: string,
): Promise<Row[]> {
  const rows: Row[] = [];
  const order = spec.id ? `&order=${spec.id}.asc` : "";
  for (let offset = 0; ; offset += PAGE) {
    const path = `/rest/v1/${spec.table}?${filterFor(spec, eventId)}&select=*${order}&limit=${PAGE}&offset=${offset}`;
    const page = rowsSchema.parse(await getJson(access, path));
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

const peopleSchema = z.array(
  z.object({ user_id: z.string(), email: z.string(), display_name: z.string() }),
);

async function readPeople(access: RestAccess, eventId: string): Promise<Person[]> {
  const response = await fetch(`${access.url}/rest/v1/rpc/event_archive_people`, {
    method: "POST",
    headers: { ...headers(access), "content-type": "application/json" },
    body: JSON.stringify({ p_event: eventId }),
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(`event_archive_people: ${response.status} ${text.slice(0, 200)}`);
  return peopleSchema
    .parse(JSON.parse(text))
    .map((row) => ({ id: row.user_id, email: row.email, displayName: row.display_name }));
}

export async function readArchive(access: RestAccess, eventId: string): Promise<ArchiveData> {
  const tables = new Map<string, Row[]>();
  for (const spec of ARCHIVE_TABLES) tables.set(spec.table, await readRows(access, spec, eventId));
  const event = tables.get("events")?.[0];
  if (!event || typeof event.slug !== "string" || typeof event.name !== "string") {
    throw new Error("That event isn't there, or you can't read it.");
  }
  const orgRows = rowsSchema.parse(
    await getJson(
      access,
      `/rest/v1/orgs?id=eq.${encodeURIComponent(String(event.org_id))}&select=slug,name`,
    ),
  );
  const org = orgRows[0];
  const people = await readPeople(access, eventId);
  return {
    manifest: buildManifest(
      {
        org: { slug: String(org?.slug ?? ""), name: String(org?.name ?? "") },
        event: { slug: event.slug, name: event.name },
        people,
        exportedAt: new Date().toISOString(),
      },
      tables,
    ),
    tables,
  };
}

export async function downloadFile(
  access: RestAccess,
  file: FileRef,
): Promise<Uint8Array<ArrayBuffer>> {
  const path = file.path.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(
    `${access.url}/storage/v1/object/authenticated/${file.bucket}/${path}`,
    {
      headers: headers(access),
    },
  );
  if (!response.ok) throw new Error(`${file.bucket}/${file.path}: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function uploadFile(
  access: RestAccess,
  bucket: string,
  path: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<void> {
  const target = path.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`${access.url}/storage/v1/object/${bucket}/${target}`, {
    method: "POST",
    headers: {
      ...headers(access),
      "content-type": "application/octet-stream",
      "x-upsert": "true",
    },
    body: bytes,
  });
  if (!response.ok)
    throw new Error(`${bucket}/${path}: ${response.status} ${await response.text()}`);
}

export function archiveTexts(data: ArchiveData): Array<{ path: string; text: string }> {
  return [
    { path: "manifest.json", text: JSON.stringify(data.manifest, null, 2) },
    ...[...data.tables].map(([name, rows]) => ({
      path: `tables/${name}.json`,
      text: JSON.stringify(rows, null, 2),
    })),
  ];
}

export function archiveFilePath(file: FileRef): string {
  return `files/${file.bucket}/${file.path}`;
}

export function parseArchive(read: (path: string) => string | undefined): ArchiveData {
  const manifestText = read("manifest.json");
  if (manifestText === undefined)
    throw new Error("This isn't an archive: manifest.json is missing.");
  const manifest = manifestSchema.parse(JSON.parse(manifestText));
  if (manifest.format !== ARCHIVE_FORMAT) {
    throw new Error(
      `This archive is format ${manifest.format}; this version of Bogey reads format ${ARCHIVE_FORMAT}.`,
    );
  }
  const tables = new Map<string, Row[]>();
  for (const spec of ARCHIVE_TABLES) {
    const text = read(`tables/${spec.table}.json`);
    tables.set(spec.table, text === undefined ? [] : rowsSchema.parse(JSON.parse(text)));
  }
  return { manifest, tables };
}

const CHUNK = 500;

async function send(
  access: RestAccess,
  method: "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<void> {
  const response = await fetch(`${access.url}/rest/v1/${path}`, {
    method,
    headers: {
      ...headers(access),
      "content-type": "application/json",
      prefer: "return=minimal",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    throw new Error(
      `${path.split("?")[0]}: ${response.status} ${(await response.text()).slice(0, 300)}`,
    );
  }
}

export async function applyPlan(
  access: RestAccess,
  plan: Plan,
  readFile: (path: string) => Promise<Uint8Array<ArrayBuffer> | undefined>,
  progress: (message: string) => void = () => {},
): Promise<void> {
  try {
    for (const step of plan.steps) {
      progress(`${step.table} (${step.rows.length})`);
      if (step.replace) await send(access, "DELETE", `${step.table}?event_id=eq.${plan.eventId}`);
      for (let at = 0; at < step.rows.length; at += CHUNK) {
        await send(access, "POST", step.table, step.rows.slice(at, at + CHUNK));
      }
    }
    for (const file of plan.files) {
      progress(`file ${file.to}`);
      const bytes = await readFile(archiveFilePath({ bucket: file.bucket, path: file.from }));
      if (bytes) await uploadFile(access, file.bucket, file.to, bytes);
    }
  } catch (error) {
    await send(access, "DELETE", `events?id=eq.${plan.eventId}`).catch(() => undefined);
    throw error;
  }
}
