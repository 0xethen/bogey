import type { PlainKey } from "#/lib/translate.tsx";

// what the caller may put in the projects spreadsheet: "all" for organizers, judging.judgeExport for judges
export type ProjectExportAccess = "off" | "projects" | "results" | "all";
export type ProjectExportFormat = "csv" | "xlsx";

// "organizer": only people who manage the event; "results": needs judging results access
type Need = "projects" | "results" | "organizer";

export const PROJECT_FIELDS = [
  { key: "title", label: "projectExport.field.title", need: "projects" },
  { key: "team", label: "projectExport.field.team", need: "projects" },
  { key: "members", label: "projectExport.field.members", need: "organizer" },
  { key: "emails", label: "projectExport.field.emails", need: "organizer" },
  { key: "division", label: "projectExport.field.division", need: "projects" },
  { key: "tracks", label: "projectExport.field.tracks", need: "projects" },
  { key: "status", label: "projectExport.field.status", need: "projects" },
  { key: "submittedAt", label: "projectExport.field.submittedAt", need: "projects" },
  { key: "table", label: "projectExport.field.table", need: "projects" },
  { key: "public", label: "projectExport.field.public", need: "projects" },
  { key: "round", label: "projectExport.field.round", need: "results" },
  { key: "rank", label: "projectExport.field.rank", need: "results" },
  { key: "divisionRank", label: "projectExport.field.divisionRank", need: "results" },
  { key: "score", label: "projectExport.field.score", need: "results" },
  { key: "rawScore", label: "projectExport.field.rawScore", need: "results" },
  { key: "judges", label: "projectExport.field.judges", need: "results" },
  { key: "awards", label: "projectExport.field.awards", need: "organizer" },
  { key: "votes", label: "projectExport.field.votes", need: "organizer" },
] as const satisfies Tuple<{ key: string; label: PlainKey; need: Need }>;

export type ProjectFieldKey = (typeof PROJECT_FIELDS)[number]["key"];

// form answers are `answer:<item key>`, criterion averages `criterion:<criterion id>`
export type ProjectColumn =
  | { kind: "field"; key: ProjectFieldKey }
  | { kind: "answer"; key: string }
  | { kind: "criterion"; key: string };

export const PROJECT_PRESETS = ["basic", "results", "judging", "everything"] as const;
export type ProjectPreset = (typeof PROJECT_PRESETS)[number];

const PRESET_FIELDS: Record<ProjectPreset, Tuple<ProjectFieldKey>> = {
  basic: ["title", "team", "members", "division", "tracks", "status", "submittedAt", "table"],
  results: [
    "title",
    "team",
    "division",
    "tracks",
    "table",
    "rank",
    "divisionRank",
    "score",
    "judges",
    "awards",
  ],
  judging: ["table", "title", "team", "division", "tracks"],
  everything: PROJECT_FIELDS.map((field) => field.key),
};

export function columnId(column: ProjectColumn): string {
  return column.kind === "field" ? column.key : `${column.kind}:${column.key}`;
}

export function parseColumn(id: string): ProjectColumn | null {
  const [kind, ...rest] = id.split(":");
  const key = rest.join(":");
  if ((kind === "answer" || kind === "criterion") && key) return { kind, key };
  const field = PROJECT_FIELDS.find((candidate) => candidate.key === id);
  return field ? { kind: "field", key: field.key } : null;
}

export function canUse(need: Need, access: ProjectExportAccess): boolean {
  if (access === "off") return false;
  if (need === "organizer") return access === "all";
  return need === "projects" || access !== "projects";
}

export function isExportAccess(value: unknown): value is ProjectExportAccess {
  return value === "off" || value === "projects" || value === "results" || value === "all";
}

export function columnNeed(column: ProjectColumn): Need {
  if (column.kind === "answer") return "projects";
  if (column.kind === "criterion") return "results";
  return PROJECT_FIELDS.find((field) => field.key === column.key)?.need ?? "organizer";
}

// every column the caller may use: project fields, form answers, results, criterion averages, awards
export function availableColumns(
  items: Tuple<{ key: string }>,
  criteria: Tuple<{ id: string }>,
  access: ProjectExportAccess,
): ProjectColumn[] {
  const fields = (needs: Tuple<Need>, except: Tuple<ProjectFieldKey> = []): ProjectColumn[] =>
    PROJECT_FIELDS.filter((field) => needs.includes(field.need) && !except.includes(field.key)).map(
      (field) => ({ kind: "field", key: field.key }),
    );
  const all: ProjectColumn[] = [
    ...fields(["projects", "organizer"], ["awards", "votes"]),
    ...items.map((item): ProjectColumn => ({ kind: "answer", key: item.key })),
    ...fields(["results"]),
    ...criteria.map((criterion): ProjectColumn => ({ kind: "criterion", key: criterion.id })),
    { kind: "field", key: "awards" },
    { kind: "field", key: "votes" },
  ];
  return all.filter((column) => canUse(columnNeed(column), access));
}

// the columns a preset picks, in catalog order, from what the caller may use
export function presetColumns(
  preset: ProjectPreset,
  available: Tuple<ProjectColumn>,
): ProjectColumn[] {
  const fields = new Set<string>(PRESET_FIELDS[preset]);
  return available.filter((column) => {
    if (column.kind === "field") return fields.has(column.key);
    if (column.kind === "answer") return preset === "basic" || preset === "everything";
    return preset === "results" || preset === "everything";
  });
}

export function projectExportHref(
  slug: string,
  options: { form: string; columns: Tuple<ProjectColumn>; format: ProjectExportFormat },
): string {
  const query = new URLSearchParams({
    form: options.form,
    fields: options.columns.map(columnId).join(","),
    format: options.format,
  });
  return `/api/events/${encodeURIComponent(slug)}/export/submissions?${query}`;
}
