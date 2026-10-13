function plain(text: string): string {
  return text.replace(/[\u2009\u202f\u00a0]/g, " ");
}

export interface FormatOptions {
  timeZone: string;
  locale?: string;
  hour12?: boolean;
  zone?: boolean;
}

export function formatDate(
  value: string | Date,
  { timeZone, locale = "en-US" }: FormatOptions,
): string {
  return plain(
    new Intl.DateTimeFormat(locale, {
      timeZone,
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(value)),
  );
}

export function dateParts(
  value: string | Date,
  { timeZone, locale = "en-US" }: FormatOptions,
): { month: string; day: string; weekday: string } {
  const parts = new Intl.DateTimeFormat(locale, {
    timeZone,
    month: "short",
    day: "numeric",
    weekday: "short",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return { month: part("month"), day: part("day"), weekday: part("weekday") };
}

export function formatDateTime(
  value: string | Date,
  { timeZone, locale = "en-US", hour12, zone = false }: FormatOptions,
): string {
  return plain(
    new Intl.DateTimeFormat(locale, {
      timeZone,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12,
      timeZoneName: zone ? "short" : undefined,
    }).format(new Date(value)),
  );
}

export function formatTime(
  value: string | Date,
  { timeZone, locale = "en-US", hour12, zone = false }: FormatOptions,
): string {
  return plain(
    new Intl.DateTimeFormat(locale, {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
      hour12,
      timeZoneName: zone ? "short" : undefined,
    }).format(new Date(value)),
  );
}

export function formatDateRange(
  start: string | Date | null,
  end: string | Date | null,
  { timeZone, locale = "en-US" }: FormatOptions,
): string | null {
  if (!start && !end) return null;
  if (!start || !end) return formatDate((start ?? end)!, { timeZone, locale });
  const format = new Intl.DateTimeFormat(locale, {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return plain(format.formatRange(new Date(start), new Date(end)));
}

export function formatTimeRange(
  start: string | Date,
  end: string | Date | null,
  { timeZone, locale = "en-US", hour12, zone = false }: FormatOptions,
): string {
  const format = new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12,
    timeZoneName: zone ? "short" : undefined,
  });
  return plain(
    end ? format.formatRange(new Date(start), new Date(end)) : format.format(new Date(start)),
  );
}

const RELATIVE_UNITS: Tuple<[Intl.RelativeTimeFormatUnit, number]> = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

export function formatRelative(
  value: string | Date,
  now: Date = new Date(),
  locale = "en-US",
): string {
  const delta = new Date(value).getTime() - now.getTime();
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (Math.abs(delta) >= ms) return format.format(Math.round(delta / ms), unit);
  }
  return format.format(0, "second");
}

function zoneOffset(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return (
    Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) -
    instant
  );
}

export function wallTimeToIso(local: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  const guess = Date.UTC(y!, mo! - 1, d!, h!, mi!);
  const first = guess - zoneOffset(guess, timeZone);
  return new Date(guess - zoneOffset(first, timeZone)).toISOString();
}

export function isoToWallTime(iso: string | null, timeZone: string): string {
  if (!iso) return "";
  const instant = new Date(iso).getTime();
  return new Date(instant + zoneOffset(instant, timeZone)).toISOString().slice(0, 16);
}
