import { expect, test } from "vite-plus/test";
import {
  DEFAULT_HOME_LAYOUT,
  homeBlockSchema,
  homeLayoutSchema,
  isCoreNamespace,
  isSettingKey,
  scopesBelow,
  parseSettings,
  resolveSettings,
  settingDefaults,
  settingControl,
  settingsRegistry,
} from "../src/settings.ts";

test("valid values pass through", () => {
  expect(parseSettings("registration", "org", { signup: "invite" })).toEqual({ signup: "invite" });
});

test("a namespace can't be set outside its scopes", () => {
  expect(() => parseSettings("tenancy", "org", {})).toThrow(/at the org level/);
});

test("unknown keys and bad values are refused", () => {
  expect(() => parseSettings("registration", "org", { signup: "sometimes" })).toThrow(/signup/);
  expect(() => parseSettings("judging", "event", { blind: true, extra: 1 })).toThrow();
});

test("resolved values start from the defaults", () => {
  expect(resolveSettings("submissions", undefined)).toEqual({
    autoSubmit: false,
    deletion: "allow",
    reminderHours: 24,
    publicToggle: false,
  });
  expect(resolveSettings("submissions", { deletion: "none" }).deletion).toBe("none");
});

test("a stored key that no longer validates falls back alone", () => {
  expect(resolveSettings("schedule", { display: "sideways", hiddenWindows: ["judging"] })).toEqual({
    display: "list",
    hiddenWindows: ["judging"],
    showEventTimezone: false,
  });
});

test("every namespace's defaults pass its own schema", () => {
  for (const [namespace, defaults] of Object.entries(settingDefaults())) {
    if (!isCoreNamespace(namespace)) throw new Error(namespace);
    expect(settingsRegistry[namespace].schema.strict().safeParse(defaults).success).toBe(true);
  }
});

test("numbers get an input even when 1 is out of range", () => {
  expect(settingControl("audit", "retentionDays")?.kind).toBe("number");
  expect(settingControl("judging", "blind")?.kind).toBe("switch");
  expect(settingControl("submissions", "deletion")?.kind).toBe("select");
});

test("scopesBelow lists the lower levels that can set a namespace", () => {
  expect(scopesBelow("branding", "instance")).toEqual(["org", "event"]);
  expect(scopesBelow("registration", "org")).toEqual(["event"]);
  expect(scopesBelow("email", "org")).toEqual(["event"]);
  expect(scopesBelow("tenancy", "instance")).toEqual([]);
  expect(scopesBelow("branding", "event")).toEqual([]);
});

test("isSettingKey knows a namespace's keys", () => {
  expect(isSettingKey("judging", "blind")).toBe(true);
  expect(isSettingKey("judging", "nope")).toBe(false);
});

test("settingControl picks the control from the schema", () => {
  expect(settingControl("branding", "name")?.kind).toBe("text");
  expect(settingControl("judging", "blind")?.kind).toBe("switch");
  expect(settingControl("limits", "eventsPerOrg")?.kind).toBe("number");
  expect(settingControl("submissions", "deletion")?.kind).toBe("select");
  expect(settingControl("branding", "accent")).toBeNull();
});

test("the default home layout is valid", () => {
  expect(homeLayoutSchema.safeParse(DEFAULT_HOME_LAYOUT).success).toBe(true);
});

test("a hidden block keeps its flag", () => {
  const parsed = homeBlockSchema.parse({ id: "a", type: "agenda", hidden: true });
  expect(parsed.hidden).toBe(true);
  expect(homeBlockSchema.parse({ id: "a", type: "divider" }).hidden).toBeUndefined();
});

test("blocks the organizer fills in need what they show", () => {
  const image = { url: "https://example.com/a.png", alt: "" };
  expect(homeBlockSchema.safeParse({ id: "a", type: "divider" }).success).toBe(true);
  expect(homeBlockSchema.safeParse({ id: "a", type: "countdown", to: "start" }).success).toBe(true);
  expect(
    homeBlockSchema.safeParse({ id: "a", type: "callout", tone: "warning", body: "Hi" }).success,
  ).toBe(true);
  expect(
    homeBlockSchema.safeParse({ id: "a", type: "callout", tone: "loud", body: "" }).success,
  ).toBe(false);
  expect(homeBlockSchema.safeParse({ id: "a", type: "image", image }).success).toBe(true);
  expect(
    homeBlockSchema.safeParse({ id: "a", type: "image", image: { ...image, url: "nope" } }).success,
  ).toBe(false);
  expect(
    homeBlockSchema.safeParse({
      id: "a",
      type: "sponsors",
      sponsors: [{ name: "Acme", logo: image.url }],
    }).success,
  ).toBe(true);
  expect(
    homeBlockSchema.safeParse({
      id: "a",
      type: "sponsors",
      sponsors: [{ name: "Acme", logo: "javascript:alert(1)" }],
    }).success,
  ).toBe(false);
  expect(
    homeBlockSchema.safeParse({
      id: "a",
      type: "faq",
      questions: [{ question: "", answer: "" }],
    }).success,
  ).toBe(false);
});

test("the about block holds up to 12 images, and layouts saved before it did still parse", () => {
  const image = { url: "https://example.com/a.png", alt: "" };
  expect(homeBlockSchema.safeParse({ id: "a", type: "about" }).success).toBe(true);
  expect(homeBlockSchema.safeParse({ id: "a", type: "about", images: [image] }).success).toBe(true);
  expect(
    homeBlockSchema.safeParse({ id: "a", type: "about", images: Array(13).fill(image) }).success,
  ).toBe(false);
});
