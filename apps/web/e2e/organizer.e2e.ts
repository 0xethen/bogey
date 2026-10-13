import { expect, test } from "@playwright/test";
import { env, expectHealthy, signIn, VIEWPORTS } from "./support.ts";

const MANAGE = [
  "",
  "/details",
  "/homepage",
  "/agenda",
  "/plugins",
  "/registration",
  "/people",
  "/teams",
  "/divisions",
  "/submissions",
  "/forms",
  "/prizes",
  "/judging",
  "/announcements",
  "/messages",
];

test.describe("organizer", () => {
  test.skip(!env.organizer, "set E2E_ORGANIZER to an organizer's email");

  test.beforeEach(async ({ page }) => {
    await signIn(page, env.organizer ?? "");
  });

  test("every Manage page opens", async ({ page }) => {
    test.setTimeout(MANAGE.length * 15_000);
    for (const path of MANAGE) {
      await page.goto(`/events/${env.event}/manage${path}`);
      await expectHealthy(page);
    }
  });

  test("Manage fits a phone, a tablet and a desktop", async ({ page }) => {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.goto(`/events/${env.event}/manage`);
      await expectHealthy(page);
    }
  });

  test("every export downloads", async ({ page }) => {
    const kinds = ["registrations", "members", "teams", "scores", "results", "awards", "votes"];
    for (const kind of kinds) {
      const response = await page.request.get(`/api/events/${env.event}/export/${kind}`);
      expect(response.status(), kind).toBe(200);
      expect(response.headers()["content-type"], kind).toContain("text/csv");
      expect(response.headers()["content-disposition"], kind).toContain(`${env.event}-${kind}.csv`);
    }
  });

  test("posts an announcement to judges, then deletes it", async ({ page }) => {
    const title = `E2E check ${Date.now()}`;
    await page.goto(`/events/${env.event}/messages?c=announcements`);
    const dialog = page.getByRole("dialog");
    //   await page.getByRole("button", { name: "New announcement..." }).click();
    //   await expect(dialog).toBeVisible({ timeout: 1000 });
    await dialog.getByLabel("Title").fill(title);
    await dialog.getByLabel("Message").fill("Checking the **composer**.");
    await dialog.getByLabel("Audience").click();
    await page.keyboard.press("ArrowDown");
    await page.getByRole("option", { name: "Judges" }).click();
    await page.keyboard.press("Escape");
    await dialog.getByRole("button", { name: "Post" }).click();
    await expect(dialog).toBeHidden();

    const row = page.locator("[data-slot=message]").filter({ hasText: title }).first();
    await expect(row).toContainText("Judges");
    await row.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText(title)).toHaveCount(0);
  });

  test("forms, judging and results are reachable and publishing is offered", async ({ page }) => {
    await page.goto(`/events/${env.event}/manage/forms`);
    await expectHealthy(page);
    await page.goto(`/events/${env.event}/manage/judging`);
    await expectHealthy(page);
    await expect(page.getByRole("button", { name: "Assign judges" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish results" })).toBeVisible();
  });

  test("the audit log records it", async ({ page }) => {
    await page.goto("/org/audit?group=announcement");
    await expectHealthy(page);
    await expect(page.getByText("posted an announcement").first()).toBeVisible();
  });
});
