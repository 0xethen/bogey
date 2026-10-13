import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

export const env = {
  organizer: process.env.E2E_ORGANIZER,
  participant: process.env.E2E_PARTICIPANT,
  judge: process.env.E2E_JUDGE,
  event: process.env.E2E_EVENT ?? "demo-hackathon",
  otherOrigin: process.env.E2E_OTHER_ORIGIN,
};

function signInCode(email: string): string {
  const output = execFileSync("node", ["tools/cli/src/bin.ts", "login", email], {
    cwd: ROOT,
    encoding: "utf-8",
  });
  const code = /\b(\d{6})\b/.exec(output)?.[1];
  if (!code) throw new Error(`bogey login printed no code: ${output}`);
  return code;
}

export async function signIn(page: Page, email: string) {
  await page.goto(`/auth/otp?email=${encodeURIComponent(email)}`);
  const input = page.locator('input[autocomplete="one-time-code"]');
  await input.click();
  await input.pressSequentially(signInCode(email));
  const signedIn = (url: URL) => !url.pathname.startsWith("/auth");
  try {
    await page.waitForURL(signedIn, { timeout: 5000 });
  } catch {
    await page.locator("form button[type=submit]").click();
    await page.waitForURL(signedIn);
  }
}

export async function expectHealthy(page: Page) {
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the page scrolls sideways").toBeLessThanOrEqual(1);
}

export const VIEWPORTS = [
  { name: "phone", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 900 },
] as const;

export function watchConsole(page: Page) {
  const seen: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) {
      seen.push(message.text());
    }
  });
  page.on("pageerror", (error) => seen.push(error.message));
  return { errors: () => seen };
}
