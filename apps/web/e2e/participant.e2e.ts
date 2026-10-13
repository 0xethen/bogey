import { expect, test } from "@playwright/test";
import { env, expectHealthy, signIn } from "./support.ts";

test.describe("participant", () => {
  test.skip(!env.participant, "set E2E_PARTICIPANT to a participant's email");

  test.beforeEach(async ({ page }) => {
    await signIn(page, env.participant ?? "");
  });

  test("sees the event, its agenda and messages", async ({ page }) => {
    for (const path of ["", "/agenda", "/messages"]) {
      await page.goto(`/events/${env.event}${path}`);
      await expectHealthy(page);
    }
  });

  test("has a bell and notification choices on Account", async ({ page }) => {
    await page.goto(`/events/${env.event}`);
    await expect(page.getByRole("button", { name: /^Notifications/ })).toBeVisible();
    await page.goto("/account");
    await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
  });

  test("can't open Manage", async ({ page }) => {
    await page.goto(`/events/${env.event}/manage`);
    await expect(page).not.toHaveURL(/\/manage/);
  });

  test("uses the team board", async ({ page }) => {
    await page.goto(`/events/${env.event}/team`);
    await expectHealthy(page);
    const card = page.getByRole("heading", { name: "Find a team" });
    const post = page.getByRole("heading", { name: "Find teammates" });
    test.skip((await card.count()) + (await post.count()) === 0, "teams are closed or full");
    if (await card.count()) {
      await page.getByLabel("Skills").fill("e2e, testing");
      await page.getByLabel("About you").fill("Here to test the board");
    } else {
      await page.getByLabel("What you're building").fill(`E2E ${Date.now()}`);
    }
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByText("Couldn't save")).toHaveCount(0);
  });

  test("team, then a submission, then the results page", async ({ page }) => {
    await page.goto(`/events/${env.event}/team`);
    await expectHealthy(page);
    if (await page.getByRole("button", { name: "Create team" }).count()) {
      await page.getByLabel("Team name").fill(`E2E team ${Date.now()}`);
      await page.getByRole("button", { name: "Create team" }).click();
    }

    await page.goto(`/events/${env.event}/submission`);
    await expectHealthy(page);
    if (await page.getByRole("button", { name: "Start a draft" }).count()) {
      await page.getByRole("button", { name: "Start a draft" }).click();
    }
    await page.getByLabel("Title").fill("E2E project");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Not submitted yet")).toHaveCount(0);

    await page.goto(`/events/${env.event}/results`);
    await expectHealthy(page);
  });
});
