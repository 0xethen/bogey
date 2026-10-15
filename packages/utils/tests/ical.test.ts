import { expect, test } from "vite-plus/test";
import { escapeText, foldLine, icalTime, toIcal } from "../src/ical.ts";

test("times are UTC without separators", () => {
  expect(icalTime(new Date("2026-10-09T14:30:05.123Z"))).toBe("20261009T143005Z");
});

test("text escapes the characters iCalendar reserves", () => {
  expect(escapeText("a, b; c\\d\nnext")).toBe("a\\, b\\; c\\\\d\\nnext");
});

test("long lines fold at 75 octets and unfold to the original", () => {
  const line = "SUMMARY:" + "é".repeat(80);
  const folded = foldLine(line);
  for (const part of folded.split("\r\n")) {
    expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
  }
  expect(folded.replace(/\r\n /g, "")).toBe(line);
  expect(foldLine("short")).toBe("short");
});

test("a calendar has one VEVENT per entry, ends missing ends after an hour", () => {
  const text = toIcal({
    name: "Hack, 2026",
    now: new Date("2026-10-01T00:00:00Z"),
    entries: [
      {
        uid: "a@bogey",
        title: "Opening",
        startsAt: new Date("2026-10-09T14:00:00Z"),
        location: "Hall A",
        url: "https://x.test/e",
      },
      {
        uid: "b@bogey",
        title: "Lunch",
        startsAt: new Date("2026-10-09T16:00:00Z"),
        endsAt: new Date("2026-10-09T17:30:00Z"),
      },
    ],
  });
  expect(text.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
  expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
  expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  expect(text).toContain("X-WR-CALNAME:Hack\\, 2026");
  expect(text).toContain("DTEND:20261009T150000Z");
  expect(text).toContain("DTEND:20261009T173000Z");
  expect(text).toContain("LOCATION:Hall A");
  expect(text).not.toContain("\n\n");
});
