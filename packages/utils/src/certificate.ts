export const CERTIFICATE_KINDS = ["participation", "award", "judge", "volunteer"] as const;
export type CertificateKind = (typeof CERTIFICATE_KINDS)[number];

export function isCertificateKind(value: string): value is CertificateKind {
  return CERTIFICATE_KINDS.some((kind) => kind === value);
}

export const CERTIFICATE_LABELS: Record<CertificateKind, string> = {
  participation: "Participation",
  award: "Award",
  judge: "Judge",
  volunteer: "Volunteer",
};

export const CERTIFICATE_VARIABLES: Record<string, string> = {
  name: "The person's name",
  event: "The event's name",
  org: "The organization's name",
  award: "The award's name (award certificates)",
  date: "When the event happened",
};

export const DEFAULT_CERTIFICATE_BODY: Record<CertificateKind, string> = {
  participation:
    "# Certificate of participation\n\nThis certifies that\n\n## {{name}}\n\ntook part in **{{event}}**, {{date}}.\n\n{{org}}",
  award:
    "# Certificate of achievement\n\nAwarded to\n\n## {{name}}\n\nfor **{{award}}** at **{{event}}**, {{date}}.\n\n{{org}}",
  judge:
    "# Certificate of appreciation\n\nThank you to\n\n## {{name}}\n\nfor judging at **{{event}}**, {{date}}.\n\n{{org}}",
  volunteer:
    "# Certificate of appreciation\n\nThank you to\n\n## {{name}}\n\nfor volunteering at **{{event}}**, {{date}}.\n\n{{org}}",
};

export function fillCertificate(body: string, values: Readonly<Record<string, string>>): string {
  return body.replace(/\{\{\s*([a-z]+)\s*\}\}/g, (_match, key: string) => values[key] ?? "");
}

export function eventDates(
  startsAt: string | null,
  endsAt: string | null,
  locale = "en-US",
): string {
  if (!startsAt) return "";
  const start = new Date(startsAt);
  const end = endsAt ? new Date(endsAt) : null;
  const month = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" });
  const day = new Intl.DateTimeFormat(locale, { day: "numeric", timeZone: "UTC" });
  const year = new Intl.DateTimeFormat(locale, { year: "numeric", timeZone: "UTC" });
  const full = (date: Date) => `${month.format(date)} ${day.format(date)}, ${year.format(date)}`;
  if (!end || end.toISOString().slice(0, 10) === start.toISOString().slice(0, 10))
    return full(start);
  if (month.format(start) === month.format(end) && year.format(start) === year.format(end)) {
    return `${month.format(start)} ${day.format(start)}–${day.format(end)}, ${year.format(start)}`;
  }
  return `${full(start)} – ${full(end)}`;
}

export function verificationPath(code: string): string {
  return `/certificates/${code}`;
}
