import { expect, test } from "vite-plus/test";
import { findKeys, findText, routeOf, type SourceFile } from "../src/find-text.ts";

const catalog = {
  "adminTab.overview": "Overview",
  "manage.overviewHelp": "The overview shows your event at a glance.",
  "auth.signInTitle": "Sign in to {name}",
  "teams.sizeRange": "{min} to {max}",
  "webhookKind.team.created": "A team is created",
};

const files: Tuple<SourceFile> = [
  {
    path: "apps/web/src/routes/_authed/events/$slug/manage/index.tsx",
    text: 'const a = 1;\ntitle={t("adminTab.overview")}',
  },
  { path: "apps/web/src/routes/_authed/admin/index.tsx", text: 'msg("adminTab.overview")' },
  {
    path: "apps/web/src/components/settings/sections/webhooks.tsx",
    text: "label: t(`webhookKind.${kind}`)",
  },
];

test("exact matches come before messages that only contain the text", () => {
  expect(findKeys(catalog, "overview", false)).toEqual([
    "adminTab.overview",
    "manage.overviewHelp",
  ]);
  expect(findKeys(catalog, "Overview", true)).toEqual(["adminTab.overview"]);
});

test("a {param} matches whatever the page showed in its place", () => {
  expect(findKeys(catalog, "Sign in to Hack GT", true)).toEqual(["auth.signInTitle"]);
});

test("a template that's mostly params doesn't match everything", () => {
  expect(findKeys(catalog, "Sign in to Hack GT", true)).not.toContain("teams.sizeRange");
});

test("a key skips the text lookup", () => {
  expect(findKeys(catalog, "adminTab.overview", false)).toEqual(["adminTab.overview"]);
});

test("usages are found by key, and --in narrows them by path", () => {
  const [hit] = findText("Overview", { exact: true, within: "manage" }, files, catalog);
  expect(hit?.usages).toEqual([
    { file: "apps/web/src/routes/_authed/events/$slug/manage/index.tsx", line: 2, dynamic: false },
  ]);
});

test("keys built at runtime show up as dynamic", () => {
  const [hit] = findText("A team is created", {}, files, catalog);
  expect(hit?.usages).toEqual([
    { file: "apps/web/src/components/settings/sections/webhooks.tsx", line: 1, dynamic: true },
  ]);
});

test("route files map to their URL", () => {
  expect(routeOf("apps/web/src/routes/_authed/events/$slug/manage/index.tsx")).toBe(
    "/events/$slug/manage",
  );
  expect(routeOf("apps/web/src/routes/_authed/events/$slug/manage/route.tsx")).toBe(
    "/events/$slug/manage",
  );
  expect(routeOf("apps/web/src/routes/_authed/account/-components/notifications.tsx")).toBe(
    "/account",
  );
  expect(routeOf("apps/web/src/lib/manage-pages.ts")).toBeNull();
});
