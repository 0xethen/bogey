import { expect, test } from "vite-plus/test";
import { check, mailProblem, MAIL_STUCK_MS } from "../src/lib/server/readiness.server.ts";

const fine = () => Promise.resolve(null);

test("ready when every probe answers", async () => {
  const report = await check({ database: fine, auth: fine, realtime: fine, email: fine });
  expect(report.ok).toBe(true);
  expect(report.checks.database).toMatchObject({ ok: true });
});

test("one failing probe makes it not ready and says which", async () => {
  const report = await check({
    database: fine,
    auth: () => Promise.resolve("HTTP 502"),
    realtime: () => Promise.reject(new Error("socket hang up")),
    email: fine,
  });
  expect(report.ok).toBe(false);
  expect(report.checks.auth).toMatchObject({ ok: false, detail: "HTTP 502" });
  expect(report.checks.realtime).toMatchObject({ ok: false, detail: "socket hang up" });
  expect(report.checks.email.ok).toBe(true);
});

test("mail only counts as stuck once it has waited a while", () => {
  const now = Date.parse("2026-10-18T12:00:00Z");
  expect(mailProblem(null, now)).toBeNull();
  expect(mailProblem(new Date(now - 60_000).toISOString(), now)).toBeNull();
  expect(mailProblem(new Date(now - MAIL_STUCK_MS - 1).toISOString(), now)).not.toBeNull();
});
