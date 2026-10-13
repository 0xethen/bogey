import { expect, test } from "@playwright/test";
import { env } from "./support.ts";

test("another org's host can't see this org's event", async ({ page }) => {
  test.skip(!env.otherOrigin, "set E2E_OTHER_ORIGIN to a second org's origin");
  await page.goto(`${env.otherOrigin}/gallery/${env.event}`);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});
