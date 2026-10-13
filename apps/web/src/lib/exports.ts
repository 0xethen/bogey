export const EXPORT_KINDS = [
  "registrations",
  "members",
  "teams",
  "submissions",
  "submission-files",
  "scores",
  "results",
  "awards",
  "attendance",
  "votes",
  "audit",
] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export function isExportKind(value: string): value is ExportKind {
  return EXPORT_KINDS.some((kind) => kind === value);
}

export const FORM_EXPORTS: Tuple<ExportKind> = ["submissions", "submission-files"];

export function exportHref(slug: string, kind: ExportKind, formKey?: string): string {
  const query = formKey ? `?form=${encodeURIComponent(formKey)}` : "";
  return `/api/events/${encodeURIComponent(slug)}/export/${kind}${query}`;
}
