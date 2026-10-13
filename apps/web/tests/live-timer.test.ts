import { describe, expect, test } from "vite-plus/test";
import { formatRemaining } from "../src/components/navigation/header/Clock.tsx";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatRemaining", () => {
  test("always shows hours, even when there are none", () => {
    expect(formatRemaining(14 * MINUTE + 3 * SECOND)).toBe("00:14:03");
    expect(formatRemaining(9 * SECOND)).toBe("00:00:09");
  });

  test("pads every part to two digits", () => {
    expect(formatRemaining(HOUR + MINUTE + SECOND)).toBe("01:01:01");
  });

  test("adds days only once there is a day", () => {
    expect(formatRemaining(23 * HOUR + 59 * MINUTE + 59 * SECOND)).toBe("23:59:59");
    expect(formatRemaining(DAY)).toBe("1d 00:00:00");
    expect(formatRemaining(2 * DAY + 3 * HOUR)).toBe("2d 03:00:00");
  });

  test("hours wrap into days rather than accumulating", () => {
    expect(formatRemaining(25 * HOUR)).toBe("1d 01:00:00");
  });

  test("past the deadline reads zero, never negative", () => {
    expect(formatRemaining(0)).toBe("00:00:00");
    expect(formatRemaining(-1)).toBe("00:00:00");
    expect(formatRemaining(-5 * HOUR)).toBe("00:00:00");
  });

  test("rounds down, so it never claims time that isn't there", () => {
    expect(formatRemaining(1999)).toBe("00:00:01");
    expect(formatRemaining(999)).toBe("00:00:00");
  });
});
