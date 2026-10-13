import { expect, test } from "vite-plus/test";
import { webhookFormat } from "../../src/queries/webhooks.ts";

test("chat services are recognized by their webhook address, like the database does", () => {
  expect(webhookFormat("https://discord.com/api/webhooks/1/abc")).toBe("discord");
  expect(webhookFormat("https://canary.discordapp.com/api/webhooks/1/abc")).toBe("discord");
  expect(webhookFormat("https://hooks.slack.com/services/T/B/x")).toBe("slack");
  expect(webhookFormat("https://example.com/discord.com/api/webhooks/1")).toBe("json");
});
