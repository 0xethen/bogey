import { expect, test } from "vite-plus/test";
import { defaultSchedule } from "../src/lib/schedule-defaults.ts";

const now = "2026-10-01T12:00:00.000Z";
const start = "2026-10-10T14:00:00.000Z";
const end = "2026-10-11T14:00:00.000Z";

test("no dates, no schedule", () => {
  expect(defaultSchedule("hackathon", null, end, now)).toEqual([]);
  expect(defaultSchedule("hackathon", start, null, now)).toEqual([]);
});

test("a hackathon's windows follow its dates; results and gallery wait", () => {
  const byKey = Object.fromEntries(
    defaultSchedule("hackathon", start, end, now).map((w) => [w.key, [w.opens_at, w.closes_at]]),
  );
  expect(byKey).toEqual({
    registration: [now, start],
    teams: [now, end],
    instructions: [start, null],
    submissions: [start, end],
    judging: [end, null],
  });
});

test("contests and custom events only schedule registration", () => {
  for (const kind of ["contest", "custom"] as const) {
    expect(defaultSchedule(kind, start, end, now).map((w) => w.key)).toEqual(["registration"]);
  }
});
