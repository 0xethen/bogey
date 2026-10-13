import { expect, test } from "vite-plus/test";
import {
  CERTIFICATE_KINDS,
  DEFAULT_CERTIFICATE_BODY,
  eventDates,
  fillCertificate,
  isCertificateKind,
} from "../src/certificate.ts";

test("variables are filled in and unknown ones come out empty", () => {
  expect(
    fillCertificate("Hi {{name}} at {{ event }}{{nope}}.", { name: "Ada", event: "Fall Hack" }),
  ).toBe("Hi Ada at Fall Hack.");
});

test("every kind has wording that names the person and the event", () => {
  for (const kind of CERTIFICATE_KINDS) {
    expect(DEFAULT_CERTIFICATE_BODY[kind]).toContain("{{name}}");
    expect(DEFAULT_CERTIFICATE_BODY[kind]).toContain("{{event}}");
  }
  expect(isCertificateKind("award")).toBe(true);
  expect(isCertificateKind("mentor")).toBe(false);
});

test("event dates read as one day, a range in a month, or a longer span", () => {
  expect(eventDates("2026-10-09T13:00:00Z", "2026-10-09T20:00:00Z")).toBe("October 9, 2026");
  expect(eventDates("2026-10-09T13:00:00Z", "2026-10-10T20:00:00Z")).toBe("October 9–10, 2026");
  expect(eventDates("2026-10-30T13:00:00Z", "2026-11-01T20:00:00Z")).toBe(
    "October 30, 2026 – November 1, 2026",
  );
  expect(eventDates(null, null)).toBe("");
});
