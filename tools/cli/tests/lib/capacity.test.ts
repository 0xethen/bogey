import { expect, test } from "vite-plus/test";
import {
  assess,
  cloudAuthLimits,
  envAuthLimits,
  GOTRUE_DEFAULTS,
  sizing,
  tomlAuthLimits,
  type Snapshot,
} from "../../src/lib/capacity.ts";

const now = Date.parse("2026-10-18T12:00:00Z");

const ready: Snapshot = {
  people: 250,
  cloud: false,
  auth: { source: "env", limits: { emailSent: 500, otp: 500, verify: 500, tokenRefresh: 1000 } },
  realtime: {
    tenant: "realtime-dev",
    maxConcurrentUsers: 500,
    maxJoinsPerSecond: 250,
    maxEventsPerSecond: 500,
  },
  database: { maxConnections: 100, inUse: 30 },
  cron: { failedLastHour: [], lastDrainAt: "2026-10-18T11:59:00Z" },
  mail: { queued: 0, oldestQueuedAt: null },
  backupAt: "2026-10-18T02:00:00Z",
  event: null,
  now,
};

test("sizes 250 people as if they shared one IP", () => {
  expect(sizing(250)).toEqual({
    emailSent: 500,
    otp: 500,
    verify: 500,
    tokenRefresh: 1000,
    realtimeConnections: 500,
    realtimeJoins: 250,
    realtimeEvents: 500,
  });
  expect(sizing(10).realtimeJoins).toBe(100);
});

test("an instance sized for the event has nothing to say", () => {
  expect(assess(ready)).toEqual({ issues: [], notes: [] });
});

test("limits below the headcount break; limits below the target are notes", () => {
  const defaults = assess({ ...ready, auth: { source: "env", limits: GOTRUE_DEFAULTS } });
  expect(defaults.issues).toHaveLength(1);
  expect(defaults.issues[0]?.fix).toContain("GOTRUE_RATE_LIMIT_EMAIL_SENT=500");

  const tight = assess({
    ...ready,
    auth: { source: "cloud", limits: { emailSent: 300, otp: 300, verify: 300, tokenRefresh: 300 } },
  });
  expect(tight.issues).toEqual([]);
  expect(tight.notes[0]).toContain("Authentication → Rate Limits");
});

test("Realtime's default 200 connections can't take 250 people", () => {
  const { issues } = assess({
    ...ready,
    realtime: {
      tenant: "realtime-dev",
      maxConcurrentUsers: 200,
      maxJoinsPerSecond: 100,
      maxEventsPerSecond: 100,
    },
  });
  expect(issues[0]?.message).toContain("too_many_connections");
  expect(issues[0]?.fix).toContain("max_concurrent_users = 500");
});

test("stuck mail, failed jobs and a stopped drain are issues", () => {
  const { issues } = assess({
    ...ready,
    cron: { failedLastHour: ["bogey-webhooks"], lastDrainAt: "2026-10-18T11:00:00Z" },
    mail: { queued: 9, oldestQueuedAt: "2026-10-18T11:30:00Z" },
  });
  expect(issues.map((issue) => issue.message)).toEqual([
    "Background jobs failed in the last hour: bogey-webhooks.",
    "The email drain last ran at 2026-10-18T11:00:00Z; it should run every minute.",
    "9 email(s) are waiting, the oldest since 2026-10-18T11:30:00Z.",
  ]);
});

test("Cloud without a token says where to look instead of guessing", () => {
  const { issues, notes } = assess({ ...ready, cloud: true, auth: null, realtime: null });
  expect(issues).toEqual([]);
  expect(notes.join("\n")).toContain("SUPABASE_ACCESS_TOKEN");
  expect(notes.join("\n")).toContain("Free 200");
});

test("reads limits from config.toml, the environment and the Management API", () => {
  const toml = `[auth]\nenabled = true\n\n[auth.rate_limit]\nemail_sent = 2\ntoken_refresh = 150\nsign_in_sign_ups = 30\n\n[auth.email]\nemail_sent = 999\n`;
  expect(tomlAuthLimits(toml)).toEqual({ emailSent: 2, otp: 30, verify: 30, tokenRefresh: 150 });
  expect(envAuthLimits({ PATH: "/bin" })).toBeNull();
  expect(envAuthLimits({ GOTRUE_SITE_URL: "x", GOTRUE_RATE_LIMIT_OTP: "400" })).toEqual({
    ...GOTRUE_DEFAULTS,
    otp: 400,
  });
  expect(cloudAuthLimits({ rate_limit_email_sent: 100, rate_limit_verify: 60 })).toEqual({
    ...GOTRUE_DEFAULTS,
    emailSent: 100,
    verify: 60,
  });
});
