import { expect, test } from "@playwright/test";
import { env, expectHealthy, signIn } from "./support.ts";

test.describe("judge", () => {
  test.skip(!env.judge, "set E2E_JUDGE to a judge's email");

  test("opens the queue and scores a project", async ({ page }) => {
    await signIn(page, env.judge ?? "");
    await page.goto(`/events/${env.event}/judging`);
    await expectHealthy(page);
    const first = page.locator("main a[href*='/judging/']").first();
    test.skip((await first.count()) === 0, "nothing submitted for judging yet");
    await first.click();
    await expect(page.getByRole("heading", { name: "Your scores" })).toBeVisible();
    await page.getByLabel("Notes").fill("E2E check");
    await page.getByRole("button", { name: "Save for later" }).click();
    await expect(page.getByText("Not saved")).toHaveCount(0);
  });

  test("scores saved offline go out when the connection is back", async ({ page, context }) => {
    await signIn(page, env.judge ?? "");
    await page.goto(`/events/${env.event}/judging`);
    const first = page.locator("main a[href*='/judging/']").first();
    test.skip((await first.count()) === 0, "nothing submitted for judging yet");
    await first.click();
    await expect(page.getByRole("heading", { name: /Your scores/ })).toBeVisible();
    await context.setOffline(true);
    await page.getByLabel("Notes").fill(`Offline note ${Date.now()}`);
    await page.getByRole("button", { name: "Save for later" }).click();
    await expect(page.getByText(/waiting to send/)).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByText(/waiting to send/)).toHaveCount(0, { timeout: 40_000 });
  });

  test("can't open Manage", async ({ page }) => {
    await signIn(page, env.judge ?? "");
    await page.goto(`/events/${env.event}/manage`);
    await expect(page).not.toHaveURL(/\/manage/);
  });
});
