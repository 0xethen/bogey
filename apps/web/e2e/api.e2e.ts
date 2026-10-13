import { expect, test } from "@playwright/test";
import { env } from "./support.ts";

test("the event list is JSON and open to other sites", async ({ request }) => {
  const response = await request.get("/api/v1/events");
  expect(response.ok()).toBe(true);
  expect(response.headers()["access-control-allow-origin"]).toBe("*");
  const body = await response.json();
  expect(Array.isArray(body.events)).toBe(true);
});

test("a public event has an agenda calendar and an announcements feed", async ({ request }) => {
  const calendar = await request.get(`/api/v1/events/${env.event}/agenda.ics`);
  test.skip(calendar.status() === 404, "the demo event isn't public here");
  expect(calendar.headers()["content-type"]).toContain("text/calendar");
  expect(await calendar.text()).toContain("BEGIN:VCALENDAR");
  const feed = await request.get(`/api/v1/events/${env.event}/announcements.atom`);
  expect(feed.headers()["content-type"]).toContain("application/atom+xml");
});

test("an unknown event and an unknown calendar token are refused", async ({ request }) => {
  expect((await request.get("/api/v1/events/no-such-event-here")).status()).toBe(404);
  expect((await request.get("/api/v1/calendar/bgc_nothing.ics")).status()).toBe(404);
});

test("an unknown certificate code is not found", async ({ page }) => {
  const response = await page.goto("/certificates/AAAAAAAAAA");
  expect(response?.status()).toBe(404);
});
