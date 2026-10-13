import { expect, test } from "vite-plus/test";
import {
  formatDateRange,
  formatDateTime,
  formatRelative,
  formatTime,
  isoToWallTime,
  wallTimeToIso,
} from "../src/time.ts";

const utc = { timeZone: "UTC" };

test("formatDateRange collapses shared parts", () => {
  expect(formatDateRange("2026-03-03T12:00:00Z", "2026-03-05T12:00:00Z", utc)).toBe(
    "Mar 3 – 5, 2026",
  );
  expect(formatDateRange("2026-03-30T12:00:00Z", "2026-04-02T12:00:00Z", utc)).toBe(
    "Mar 30 – Apr 2, 2026",
  );
});

test("formatDateRange handles missing ends", () => {
  expect(formatDateRange(null, null, utc)).toBeNull();
  expect(formatDateRange("2026-03-03T12:00:00Z", null, utc)).toBe("Mar 3, 2026");
});

test("formatDateRange uses the event's timezone, not the viewer's", () => {
  expect(formatDateRange("2026-03-04T02:00:00Z", null, { timeZone: "America/New_York" })).toBe(
    "Mar 3, 2026",
  );
});

test("formatRelative picks the largest whole unit", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  expect(formatRelative("2026-01-01T03:00:00Z", now)).toBe("in 3 hours");
  expect(formatRelative("2025-12-30T00:00:00Z", now)).toBe("2 days ago");
  expect(formatRelative("2026-01-01T00:00:20Z", now)).toBe("now");
});

test("wall time converts through the event's timezone, across DST", () => {
  expect(wallTimeToIso("2026-01-15T09:00", "America/New_York")).toBe("2026-01-15T14:00:00.000Z");
  expect(wallTimeToIso("2026-07-15T09:00", "America/New_York")).toBe("2026-07-15T13:00:00.000Z");
  expect(wallTimeToIso("", "UTC")).toBeNull();
  expect(isoToWallTime("2026-07-15T13:00:00.000Z", "America/New_York")).toBe("2026-07-15T09:00");
});

test("output uses plain spaces so server and browser render identical text", () => {
  const text = formatDateRange("2026-03-03T12:00:00Z", "2026-03-05T12:00:00Z", utc) ?? "";
  expect(/[\u2009\u202f\u00a0]/.test(text)).toBe(false);
});

test("24-hour clocks and named zones", () => {
  const at = "2026-03-08T21:30:00Z";
  expect(formatTime(at, { timeZone: "UTC", hour12: false })).toBe("21:30");
  expect(formatTime(at, { timeZone: "UTC", hour12: true })).toBe("9:30 PM");
  expect(formatTime(at, { timeZone: "America/New_York", zone: true })).toBe("5:30 PM EDT");
  expect(formatDateTime(at, { timeZone: "UTC" })).toBe("Mar 8, 9:30 PM");
});
