export interface CalendarEntry {
  uid: string;
  title: string;
  startsAt: Date;
  endsAt?: Date | null;
  description?: string | null;
  location?: string | null;
  url?: string | null;
}

export function icalTime(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  let limit = 75;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (size + bytes > limit) {
      parts.push(current);
      current = "";
      size = 0;
      limit = 74;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export interface Calendar {
  name: string;
  entries: Tuple<CalendarEntry>;
  now?: Date;
}

export function toIcal({ name, entries, now = new Date() }: Calendar): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Bogey//Agenda//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`,
  ];
  for (const entry of entries) {
    const end = entry.endsAt ?? new Date(entry.startsAt.getTime() + 60 * 60 * 1000);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${entry.uid}`,
      `DTSTAMP:${icalTime(now)}`,
      `DTSTART:${icalTime(entry.startsAt)}`,
      `DTEND:${icalTime(end)}`,
      `SUMMARY:${escapeText(entry.title)}`,
    );
    if (entry.description) lines.push(`DESCRIPTION:${escapeText(entry.description)}`);
    if (entry.location) lines.push(`LOCATION:${escapeText(entry.location)}`);
    if (entry.url) lines.push(`URL:${entry.url}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
