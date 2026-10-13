import { expect, test } from "@playwright/test";
import { env, expectHealthy, signIn, VIEWPORTS, watchConsole } from "./support.ts";

for (const viewport of VIEWPORTS) {
  test(`sign-in page at ${viewport.name} width`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/auth/login");
    await expectHealthy(page);
  });
}

const ACCOUNT = ["/account", "/account/preferences", "/account/calendar", "/events"];
const EVENT = [
  "",
  "/agenda",
  "/messages",
  "/announcements",
  "/pages",
  "/prizes",
  "/team",
  "/submission",
  "/certificates",
  "/manage/prizes",
  "/manage/certificates",
  "/manage/webhooks",
];
const ORG = ["", "/events", "/members", "/settings", "/settings/webhooks", "/audit", "/plugins"];

test.describe("every signed-in route loads without console errors", () => {
  test.skip(!env.organizer, "set E2E_ORGANIZER to an organizer's email");

  test("organizer", async ({ page }) => {
    test.setTimeout((ACCOUNT.length + EVENT.length + ORG.length) * 20_000);
    const console = watchConsole(page);
    await signIn(page, env.organizer ?? "");
    const paths = [
      ...ACCOUNT,
      ...EVENT.map((path) => `/events/${env.event}${path}`),
      ...ORG.map((path) => `/org${path}`),
    ];
    for (const path of paths) {
      await page.goto(path);
      await expectHealthy(page);
    }
    expect(console.errors()).toEqual([]);
  });
});
