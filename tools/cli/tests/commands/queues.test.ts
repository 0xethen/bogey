import { expect, test } from "vite-plus/test";
import { summarize } from "../../src/commands/queues.ts";

const now = Date.parse("2026-10-10T12:00:00Z");

test("a queue counts what waits, what failed lately and the oldest wait", () => {
  const queue = summarize(
    "Email",
    [
      { status: "queued", created_at: "2026-10-10T11:59:00Z", last_error: null },
      { status: "sending", created_at: "2026-10-10T11:00:00Z", last_error: null },
      { status: "sent", created_at: "2026-10-10T10:00:00Z", last_error: null },
      { status: "failed", created_at: "2026-10-10T09:00:00Z", last_error: "smtp refused" },
      { status: "failed", created_at: "2026-10-01T09:00:00Z", last_error: "old" },
    ],
    now,
  );
  expect(queue).toEqual({
    name: "Email",
    queued: 2,
    failedLastDay: 1,
    oldestQueuedAt: "2026-10-10T11:00:00Z",
    lastError: "smtp refused",
  });
});

test("an empty queue is calm", () => {
  expect(summarize("Webhooks", [], now)).toMatchObject({
    queued: 0,
    oldestQueuedAt: null,
    lastError: null,
  });
});
