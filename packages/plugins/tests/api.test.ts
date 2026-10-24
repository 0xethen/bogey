import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import type { ActionsOf } from "../src/audit.ts";
import {
  isRouteListed,
  compareVersions,
  definePlugin,
  incompatibility,
  isSettingVisible,
  PLUGIN_API,
  pluginEventTypes,
  pluginLimits,
  pluginLimitsNamespace,
  pluginTogglesPerEvent,
  parseRepository,
  pluginRepositoryUrl,
  pluginAccountLinks,
  pluginAction,
  pluginActionLabel,
  pluginChromeCommands,
  pluginDefaults,
  pluginNamespace,
  pluginNetworkArea,
  pluginNetworkAreas,
  pluginWindow,
  settingsEditableAt,
  settingsLockedAbove,
  validPluginSettings,
  pluginPath,
  pluginPermissions,
  pluginPublicUrl,
  pluginRoles,
  pluginRoutes,
  readPluginSettings,
  matchPluginRoute,
  pluginPageUrl,
  routeArea,
  generalSettingNames,
  settingsSectionsOn,
  settingsPresetsOn,
} from "../src/api.ts";

const META = {
  api: 1,
  version: "1.0.0",
  description: "A plugin.",
  author: { name: "Test" },
  source: { repository: "github:someone/plugins" },
} as const;

const example = definePlugin({
  key: "checkin",
  name: "Check-in",
  ...META,
  windows: [{ key: "open", label: "Check-in" }],
  networkAreas: [{ key: "desk", label: "Desk" }],
  actions: ["checked_in"],
  routes: [{ path: "", label: "Check-in" }, { path: "/history" }],
  settings: {
    requireName: { type: "boolean", label: "Confirm names", default: true, scope: "org" },
    limit: { type: "number", label: "Limit", default: 10 },
    mode: {
      type: "select",
      label: "Mode",
      default: "email",
      options: [
        { value: "email", label: "Email" },
        { value: "name", label: "Name" },
      ],
    },
  },
});

describe("chrome contributions", () => {
  const base = { key: "chrome", name: "Chrome", ...META } as const;

  test("commands are a page, a link or an action, never two", () => {
    expect(() =>
      definePlugin({
        ...base,
        commands: [{ label: "Both", href: "https://example.com", action: "go" } as never],
      }),
    ).toThrow(/exactly one/);
    expect(() => definePlugin({ ...base, commands: [{ label: "None" } as never] })).toThrow(
      /exactly one/,
    );
  });

  test("a link needs an https URL", () => {
    expect(() =>
      definePlugin({ ...base, commands: [{ label: "Bad", href: "http://example.com" }] }),
    ).toThrow(/https/);
    expect(() =>
      definePlugin({ ...base, commands: [{ label: "Bad", href: "javascript:alert(1)" }] }),
    ).toThrow(/https/);
    expect(() =>
      definePlugin({ ...base, commands: [{ label: "Ok", href: "https://example.com/x" }] }),
    ).not.toThrow();
  });

  test("an action id is lowercase, unique and not empty", () => {
    expect(() => definePlugin({ ...base, commands: [{ label: "Bad", action: "Do It" }] })).toThrow(
      /action/,
    );
    expect(() =>
      definePlugin({
        ...base,
        commands: [
          { label: "One", action: "go" },
          { label: "Two", action: "go" },
        ],
      }),
    ).toThrow(/unique/);
  });

  test("an account link opens a public route or an https URL", () => {
    expect(() =>
      definePlugin({
        ...base,
        routes: [{ path: "/events" }],
        accountLinks: [{ label: "Events", path: "/events" }],
      }),
    ).toThrow(/public or account routes/);
    expect(() =>
      definePlugin({
        ...base,
        routes: [{ path: "/about", public: true }],
        accountLinks: [
          { label: "About", path: "/about" },
          { label: "Docs", href: "https://example.com/docs" },
        ],
      }),
    ).not.toThrow();
    expect(() =>
      definePlugin({ ...base, accountLinks: [{ label: "Bad", href: "ftp://example.com" }] }),
    ).toThrow(/https/);
  });

  test("lists links and actions, and account links resolve to URLs", () => {
    const plugin = definePlugin({
      ...base,
      routes: [
        { path: "", label: "Home" },
        { path: "/about", public: true },
      ],
      commands: [
        { label: "Home", path: "" },
        { label: "Issues", href: "https://github.com/example/issues", keywords: ["bug"] },
        { label: "Run it", action: "run_it" },
      ],
      accountLinks: [
        { label: "About", path: "/about" },
        { label: "Docs", href: "https://example.com/docs" },
      ],
    });
    expect(pluginChromeCommands([plugin]).map((c) => [c.label, c.href, c.action])).toEqual([
      ["Issues", "https://github.com/example/issues", undefined],
      ["Run it", undefined, "run_it"],
    ]);
    expect(pluginAccountLinks([plugin]).map((l) => [l.label, l.href, l.external])).toEqual([
      ["About", "/x/chrome/about", false],
      ["Docs", "https://example.com/docs", true],
    ]);
  });

  test("uses entries must look like tables, hosts and namespaces", () => {
    expect(() =>
      definePlugin({ ...base, uses: { network: ["https://api.github.com/x"] } }),
    ).toThrow(/bare host/);
    expect(() => definePlugin({ ...base, uses: { tables: ["Drop Table"] } })).toThrow(/table/);
    expect(() => definePlugin({ ...base, uses: { settings: ["Branding!"] } })).toThrow(/namespace/);
    expect(() =>
      definePlugin({
        ...base,
        uses: {
          tables: ["checkin_scans", "public.events"],
          network: ["api.github.com", "*.example.com"],
          settings: ["branding", "plugin.chrome"],
        },
      }),
    ).not.toThrow();
  });
});

describe("definePlugin", () => {
  test("rejects keys that can't safely appear in a URL or a database row", () => {
    expect(() => definePlugin({ key: "Check In", name: "x", ...META })).toThrow(/lowercase/);
    expect(() => definePlugin({ key: "a", name: "x", ...META })).toThrow();
    expect(() => definePlugin({ key: "trailing-", name: "x", ...META })).toThrow();
  });

  test("requires the plugin API version, and commands that open its own pages", () => {
    expect(() => definePlugin({ key: "valid-key", name: "x", ...META, api: 0 })).toThrow(/api/);
    expect(() =>
      definePlugin({
        key: "valid-key",
        name: "x",
        ...META,
        routes: [{ path: "" }],
        commands: [{ path: "/missing", label: "Missing" }],
      }),
    ).toThrow(/event or manage routes/);
  });

  test("hotkeys have unique ids and open the plugin's own pages", () => {
    const base = { key: "valid-key", name: "x", ...META, routes: [{ path: "" }] };
    expect(() =>
      definePlugin({ ...base, hotkeys: [{ id: "open", label: "Open", keys: "Mod+J", path: "" }] }),
    ).not.toThrow();
    expect(() =>
      definePlugin({
        ...base,
        hotkeys: [{ id: "open", label: "Open", keys: "Mod+J", path: "/missing" }],
      }),
    ).toThrow(/event or manage routes/);
    expect(() =>
      definePlugin({
        ...base,
        hotkeys: [
          { id: "open", label: "Open", keys: "Mod+J", path: "" },
          { id: "open", label: "Again", keys: "Mod+L", path: "" },
        ],
      }),
    ).toThrow(/unique id/);
  });

  test("rejects badly named or repeated actions", () => {
    expect(() =>
      definePlugin({ key: "valid-key", name: "x", ...META, actions: ["Checked In"] }),
    ).toThrow(/lowercase/);
    expect(() =>
      definePlugin({ key: "valid-key", name: "x", ...META, actions: ["done", "done"] }),
    ).toThrow(/twice/);
  });

  test("action labels name declared actions, and read in the audit log", () => {
    expect(() =>
      definePlugin({
        key: "valid-key",
        name: "x",
        ...META,
        actions: ["done"],
        actionLabels: { gone: "did something" },
      }),
    ).toThrow(/isn't one of its actions/);
    const labeled = definePlugin({
      key: "valid-key",
      name: "x",
      ...META,
      actions: ["done", "quiet"],
      actionLabels: { done: "finished it" },
    });
    expect(pluginActionLabel([labeled], "valid-key.done")).toBe("finished it");
    expect(pluginActionLabel([labeled], "valid-key.quiet")).toBeNull();
    expect(pluginActionLabel([labeled], "event.created")).toBeNull();
  });

  test("audit actions are typed from the manifest", () => {
    expectTypeOf<ActionsOf<typeof example>>().toEqualTypeOf<"checked_in">();
  });

  test("rejects a nameless plugin", () => {
    expect(() => definePlugin({ key: "valid-key", name: "  ", ...META })).toThrow(/name/);
  });

  test("rejects a route path that isn't rooted", () => {
    expect(() =>
      definePlugin({ key: "valid-key", name: "x", ...META, routes: [{ path: "history" }] }),
    ).toThrow(/must start with/);
  });

  test("an index route is allowed to be empty", () => {
    expect(() =>
      definePlugin({ key: "valid-key", name: "x", ...META, routes: [{ path: "" }] }),
    ).not.toThrow();
  });
});

describe("namespacing", () => {
  test("windows, settings and actions are prefixed with the plugin key", () => {
    expect(pluginWindow(example, "open")).toBe("checkin.open");
    expect(pluginNamespace(example)).toBe("plugin.checkin");
    expect(pluginAction(example, "checked_in")).toBe("checkin.checked_in");
  });

  test("network areas are prefixed with the plugin key", () => {
    expect(pluginNetworkArea(example, "desk")).toBe("checkin.desk");
    expect(pluginNetworkAreas([example])).toEqual([{ key: "checkin.desk", label: "Desk" }]);
    expect(() =>
      definePlugin({
        key: "valid-key",
        name: "x",
        ...META,
        networkAreas: [{ key: "Bad", label: "x" }],
      }),
    ).toThrow(/network area/);
  });

  test("routes mount under /x/<key>", () => {
    expect(pluginPath(example)).toBe("/x/checkin");
    expect(pluginPath(example, "/history")).toBe("/x/checkin/history");
  });

  test("pluginRoutes reports each route's area", () => {
    expect(pluginRoutes([example])).toEqual([
      { path: "", label: "Check-in", key: "checkin", name: "Check-in", area: "event" },
      { path: "/history", key: "checkin", name: "Check-in", area: "event" },
    ]);
  });
});

describe("readPluginSettings", () => {
  test("fills in every declared default", () => {
    expect(pluginDefaults(example)).toEqual({ requireName: true, limit: 10, mode: "email" });
    expect(readPluginSettings(example, {})).toEqual({
      requireName: true,
      limit: 10,
      mode: "email",
    });
  });

  test("stored values win over defaults", () => {
    expect(readPluginSettings(example, { requireName: false, limit: 3 })).toMatchObject({
      requireName: false,
      limit: 3,
    });
  });

  test("a value of the wrong type falls back to the default", () => {
    const settings = readPluginSettings(example, { requireName: "yes", limit: "lots" });

    expect(settings.requireName).toBe(true);
    expect(settings.limit).toBe(10);
  });

  test("a select value outside its options falls back", () => {
    expect(readPluginSettings(example, { mode: "telepathy" }).mode).toBe("email");
  });

  test("unknown keys are dropped rather than passed through", () => {
    expect(readPluginSettings(example, { removedLastVersion: 1 })).not.toHaveProperty(
      "removedLastVersion",
    );
  });

  test("null and undefined stored blobs are the same as no settings", () => {
    expect(readPluginSettings(example, null)).toEqual(pluginDefaults(example));
    expect(readPluginSettings(example, undefined)).toEqual(pluginDefaults(example));
  });
});

describe("provenance", () => {
  const base = { key: "valid-key", name: "x", api: 1, version: "1.0.0", description: "d" } as const;
  const author = { name: "Someone" };
  const source = { repository: "github:someone/thing" };

  test("requires a version that can actually be compared", () => {
    expect(() => definePlugin({ ...base, version: "v1", author, source })).toThrow(/semver/);
    expect(() => definePlugin({ ...base, version: "latest", author, source })).toThrow(/semver/);
  });

  test("requires a description and a named author", () => {
    expect(() => definePlugin({ ...base, description: " ", author, source })).toThrow(
      /description/,
    );
    expect(() => definePlugin({ ...base, author: { name: "  " }, source })).toThrow(/author/);
  });

  test("requires a parseable source repository", () => {
    expect(() => definePlugin({ ...base, author, source: { repository: "not a repo" } })).toThrow(
      /source.repository/,
    );
    expect(() => definePlugin({ ...base, author, source })).not.toThrow();
  });

  test("rejects a repository it could never fetch from", () => {
    expect(() =>
      definePlugin({ ...base, author, source: { repository: "someone/thing" } }),
    ).toThrow(/repository/);
    expect(() =>
      definePlugin({ ...base, author, source: { repository: "git@github.com:a/b.git" } }),
    ).toThrow(/repository/);
  });
});

describe("parseRepository", () => {
  test("reads both accepted spellings", () => {
    expect(parseRepository("github:0xethen/bogey")).toMatchObject({
      owner: "0xethen",
      repo: "bogey",
      url: "https://github.com/0xethen/bogey",
    });
    expect(parseRepository("https://github.com/0xethen/bogey")).toMatchObject({
      owner: "0xethen",
      repo: "bogey",
    });
    expect(parseRepository("https://github.com/0xethen/bogey.git")).toMatchObject({
      repo: "bogey",
    });
  });

  test("returns null rather than throwing on anything else", () => {
    for (const value of ["", "bogey", "gitlab:a/b", "https://example.com/a/b", "github:a"]) {
      expect(parseRepository(value), value).toBeNull();
    }
  });
});

describe("compareVersions", () => {
  test("orders releases", () => {
    expect(compareVersions("1.0.1", "1.0.0")).toBe(1);
    expect(compareVersions("1.1.0", "1.0.9")).toBe(1);
    expect(compareVersions("2.0.0", "10.0.0")).toBe(-1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });

  test("treats a pre-release as its release", () => {
    expect(compareVersions("2.0.0-beta.1", "2.0.0")).toBe(0);
  });

  test("tolerates ragged version lengths", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.2.1", "1.2")).toBe(1);
  });
});

describe("pluginRepositoryUrl", () => {
  const author = { name: "Someone" };
  const base = {
    key: "valid-key",
    name: "x",
    api: 1,
    version: "1.0.0",
    description: "d",
    author,
  } as const;

  test("points at the sub-directory when the plugin lives in a monorepo", () => {
    const manifest = definePlugin({
      ...base,
      source: { repository: "github:someone/plugins", directory: "packages/thing" },
    });

    expect(pluginRepositoryUrl(manifest)).toBe(
      "https://github.com/someone/plugins/tree/HEAD/packages/thing",
    );
  });
});

const sample = definePlugin({
  key: "sample",
  name: "Sample",
  ...META,
  routes: [{ path: "/join", public: true }],
});

describe("public routes", () => {
  test("a public path is mounted under /p like every other route", () => {
    expect(pluginPath(sample, "/join")).toBe("/x/sample/join");
  });

  test("a shareable URL keeps exactly one slash at the join", () => {
    expect(pluginPublicUrl(sample, "/join/tok", "https://bogey.test")).toBe(
      "https://bogey.test/x/sample/join/tok",
    );
    expect(pluginPublicUrl(sample, "/join/tok", "https://bogey.test/")).toBe(
      "https://bogey.test/x/sample/join/tok",
    );
  });

  test("a public route may not also require a permission", () => {
    expect(() =>
      definePlugin({
        key: "oops",
        name: "Oops",
        ...META,
        routes: [{ path: "/join", public: true, permission: "event.manage" }],
      }),
    ).toThrow(/public/);
  });
});

describe("route areas", () => {
  const areas = definePlugin({
    key: "areas",
    name: "Areas",
    ...META,
    routes: [
      { path: "", label: "Board" },
      { path: "/review", area: "manage", label: "Review" },
      { path: "/billing", area: "org", label: "Billing" },
      { path: "/linked", area: "account", label: "Linked accounts" },
      { path: "/runners", area: "admin", label: "Runners" },
      { path: "/problem", splat: true },
      { path: "/join", area: "public" },
      { path: "/old", public: true },
    ],
  });

  test("each area mounts under its own /x/<key>", () => {
    expect(pluginPageUrl(areas, "event", "", "spring")).toBe("/events/spring/x/areas");
    expect(pluginPageUrl(areas, "manage", "/review", "spring")).toBe(
      "/events/spring/manage/x/areas/review",
    );
    expect(pluginPageUrl(areas, "org", "/billing")).toBe("/org/x/areas/billing");
    expect(pluginPageUrl(areas, "account", "/linked")).toBe("/account/x/areas/linked");
    expect(pluginPageUrl(areas, "admin", "/runners")).toBe("/admin/x/areas/runners");
    expect(pluginPageUrl(areas, "public", "/join")).toBe("/x/areas/join");
  });

  test("`public: true` is the public area", () => {
    expect(routeArea({ public: true })).toBe("public");
    expect(routeArea({})).toBe("event");
    expect(pluginRoutes([areas], "public").map((route) => route.path)).toEqual(["/join", "/old"]);
  });

  test("a URL matches only its own area's routes", () => {
    expect(matchPluginRoute(areas, "org", "billing")?.route.path).toBe("/billing");
    expect(matchPluginRoute(areas, "event", "billing")).toBeNull();
    expect(matchPluginRoute(areas, "manage", "review/extra")).toBeNull();
  });

  test("splat routes and public pages get the rest of the path", () => {
    expect(matchPluginRoute(areas, "event", "problem/sum/2")).toMatchObject({
      route: { path: "/problem" },
      splat: "sum/2",
    });
    expect(matchPluginRoute(areas, "public", "join/tok")).toMatchObject({ splat: "tok" });
    expect(matchPluginRoute(areas, "event", undefined)?.route.path).toBe("");
  });

  test("permissions are for event and manage pages only", () => {
    expect(() =>
      definePlugin({
        key: "oops",
        name: "Oops",
        ...META,
        routes: [{ path: "/x", area: "org", permission: "event.manage" }],
      }),
    ).toThrow(/only event and manage pages/i);
  });

  test("public: true can't be combined with another area", () => {
    expect(() =>
      definePlugin({
        key: "oops",
        name: "Oops",
        ...META,
        routes: [{ path: "/x", public: true, area: "org" }],
      }),
    ).toThrow(/area/);
  });
});

describe("plugin roles and permissions", () => {
  const withRole = definePlugin({
    key: "mentors",
    name: "Mentors",
    ...META,
    permissions: ["attend", "review"],
    roles: [{ key: "mentor", label: "Mentor", grants: ["attend"] }],
  });

  test("keys and grants are namespaced to the plugin", () => {
    const [role] = pluginRoles([withRole]);
    expect(role?.key).toBe("mentors.mentor");
    expect(role?.grants).toEqual(["mentors.attend"]);
    expect(role?.source).toBe("mentors");
  });

  test("permissions are namespaced too", () => {
    expect(pluginPermissions([withRole])).toEqual(["mentors.attend", "mentors.review"]);
  });

  test("permission names fit the database's <plugin>.<name> shape", () => {
    for (const permission of ["review_all", "jury.read", "Review"]) {
      expect(() =>
        definePlugin({ key: "bad", name: "Bad", ...META, permissions: [permission] }),
      ).toThrow(/kebab-case/);
    }
  });

  test("a role may only grant permissions its own plugin declared", () => {
    expect(() =>
      definePlugin({
        key: "greedy",
        name: "Greedy",
        ...META,
        roles: [{ key: "boss", label: "Boss", grants: ["event.manage"] }],
      }),
    ).toThrow(/doesn't declare/);
  });

  test("two roles with the same key are refused", () => {
    expect(() =>
      definePlugin({
        key: "dupe",
        name: "Dupe",
        ...META,
        roles: [
          { key: "a", label: "A" },
          { key: "a", label: "A again" },
        ],
      }),
    ).toThrow(/twice/);
  });

  test("a plugin with no roles contributes none", () => {
    expect(pluginRoles([example])).toEqual([]);
    expect(pluginPermissions([example])).toEqual([]);
  });
});

describe("settings", () => {
  test("an org editor sees org and event settings, an event editor only event ones", () => {
    expect(settingsEditableAt(example, "org").map(([name]) => name)).toEqual([
      "requireName",
      "limit",
      "mode",
    ]);
    expect(settingsEditableAt(example, "event").map(([name]) => name)).toEqual(["limit", "mode"]);
  });

  test("unknown keys and wrong types are dropped before saving", () => {
    expect(validPluginSettings(example, { limit: 5, mode: "nope", extra: 1 })).toEqual({
      limit: 5,
    });
  });
});

describe("locked settings", () => {
  const locking = definePlugin({
    ...META,
    key: "locking",
    name: "Locking",
    settings: {
      everywhere: { type: "boolean", label: "Everywhere", lock: "instance", default: false },
      forEvents: { type: "string", label: "For events", lock: "org", default: "" },
      free: { type: "boolean", label: "Free", default: true },
    },
  });

  test("a locked setting can only be changed at its level, and is read-only below", () => {
    expect(settingsEditableAt(locking, "instance").map(([name]) => name)).toEqual([
      "everywhere",
      "forEvents",
      "free",
    ]);
    expect(settingsEditableAt(locking, "org").map(([name]) => name)).toEqual(["forEvents", "free"]);
    expect(settingsEditableAt(locking, "event").map(([name]) => name)).toEqual(["free"]);
    expect(settingsLockedAbove(locking, "instance")).toEqual([]);
    expect(settingsLockedAbove(locking, "org").map(([name]) => name)).toEqual(["everywhere"]);
    expect(settingsLockedAbove(locking, "event").map(([name]) => name)).toEqual([
      "everywhere",
      "forEvents",
    ]);
  });

  test("a setting can't have both a lock and a scope", () => {
    expect(() =>
      definePlugin({
        ...META,
        key: "both",
        name: "Both",
        settings: { x: { type: "boolean", label: "X", lock: "instance", scope: "org" } },
      }),
    ).toThrow(/both `lock` and `scope`/);
  });
});

describe("incompatibility", () => {
  test("loads supported APIs and explains the rest", () => {
    expect(incompatibility({ api: PLUGIN_API })).toBeNull();
    expect(incompatibility({ api: PLUGIN_API + 1 })).toMatch(/Upgrade Bogey/);
    expect(incompatibility({ api: 0 })).toMatch(/Update the plugin/);
  });
});

describe("settings shown conditionally", () => {
  const guarded = definePlugin({
    key: "guarded",
    name: "Guarded",
    ...META,
    settings: {
      mode: {
        type: "select",
        label: "Mode",
        default: "off",
        options: [
          { value: "off", label: "Off" },
          { value: "stop", label: "Stop" },
        ],
      },
      limit: {
        type: "number",
        label: "Limit",
        default: 3,
        min: 1,
        showWhen: { setting: "mode", in: ["stop"] },
      },
      always: { type: "boolean", label: "Always", default: false },
    },
  });

  test("a setting shows while the one it depends on has a matching value", () => {
    expect(isSettingVisible(guarded, "limit", { mode: "stop" })).toBe(true);
    expect(isSettingVisible(guarded, "limit", { mode: "off" })).toBe(false);
    expect(isSettingVisible(guarded, "always", { mode: "off" })).toBe(true);
  });

  test("a hidden setting hides what depends on it", () => {
    const chained = definePlugin({
      key: "chained",
      name: "Chained",
      ...META,
      settings: {
        on: { type: "boolean", label: "On" },
        mid: { type: "boolean", label: "Mid", showWhen: { setting: "on", in: [true] } },
        leaf: { type: "boolean", label: "Leaf", showWhen: { setting: "mid", in: [true] } },
      },
    });
    expect(isSettingVisible(chained, "leaf", { on: false, mid: true })).toBe(false);
    expect(isSettingVisible(chained, "leaf", { on: true, mid: true })).toBe(true);
  });

  test("a list of conditions all have to hold, and routes are listed by them", () => {
    const formats = definePlugin({
      key: "formats",
      name: "Formats",
      ...META,
      settings: {
        format: {
          type: "select",
          label: "Format",
          default: "contest",
          options: [
            { value: "contest", label: "Contest" },
            { value: "ctf", label: "CTF" },
          ],
        },
        scoring: { type: "boolean", label: "Scoring", default: false },
        penalty: {
          type: "number",
          label: "Penalty",
          showWhen: [
            { setting: "format", in: ["contest"] },
            { setting: "scoring", in: [true] },
          ],
        },
      },
      routes: [
        { path: "", label: "Problems", showWhen: { setting: "format", in: ["contest"] } },
        { path: "/ctf", label: "Challenges", showWhen: { setting: "format", in: ["ctf"] } },
      ],
    });
    expect(isSettingVisible(formats, "penalty", { format: "contest", scoring: true })).toBe(true);
    expect(isSettingVisible(formats, "penalty", { format: "ctf", scoring: true })).toBe(false);
    expect(isSettingVisible(formats, "penalty", { format: "contest", scoring: false })).toBe(false);
    const [problems, challenges] = formats.routes ?? [];
    expect(isRouteListed(formats, problems!, {})).toBe(true);
    expect(isRouteListed(formats, challenges!, {})).toBe(false);
    expect(isRouteListed(formats, challenges!, { format: "ctf" })).toBe(true);
  });

  test("it must name an earlier setting, and some value", () => {
    const settings = (showWhen: { setting: string; in: Array<string | number | boolean> }) => ({
      a: { type: "boolean" as const, label: "A", showWhen },
      b: { type: "boolean" as const, label: "B" },
    });
    expect(() =>
      definePlugin({
        key: "later",
        name: "Later",
        ...META,
        settings: settings({ setting: "b", in: [true] }),
      }),
    ).toThrow(/before it/);
    expect(() =>
      definePlugin({
        key: "self",
        name: "Self",
        ...META,
        settings: settings({ setting: "a", in: [true] }),
      }),
    ).toThrow(/before it/);
    expect(() =>
      definePlugin({
        key: "gone",
        name: "Gone",
        ...META,
        settings: settings({ setting: "zz", in: [true] }),
      }),
    ).toThrow(/before it/);
    expect(() =>
      definePlugin({
        key: "empty",
        name: "Empty",
        ...META,
        settings: {
          b: { type: "boolean", label: "B" },
          a: { type: "boolean", label: "A", showWhen: { setting: "b", in: [] } },
        },
      }),
    ).toThrow(/never show/);
  });
});

describe("org-scoped plugins and event types", () => {
  const contest = definePlugin({
    key: "contest",
    name: "Contest",
    ...META,
    scope: "org",
    eventTypes: [
      {
        key: "timed",
        label: "Timed contest",
        description: "Against a clock.",
        kind: "contest",
        teamSize: [1, 1],
      },
      { key: "open", label: "Open contest", description: "Any time." },
    ],
  });

  test("their event types are listed under the plugin's key", () => {
    expect(pluginEventTypes([contest])).toEqual([
      {
        id: "contest.timed",
        plugin: "contest",
        pluginName: "Contest",
        label: "Timed contest",
        description: "Against a clock.",
        kind: "contest",
        teamSize: [1, 1],
        settings: {},
        judgeConversations: false,
      },
      {
        id: "contest.open",
        plugin: "contest",
        pluginName: "Contest",
        label: "Open contest",
        description: "Any time.",
        kind: "custom",
        teamSize: [1, 4],
        settings: {},
        judgeConversations: false,
      },
    ]);
  });

  test("only event-scoped plugins are switched on per event", () => {
    expect(pluginTogglesPerEvent(contest)).toBe(false);
    expect(pluginTogglesPerEvent(example)).toBe(true);
  });

  test("an org-scoped plugin needs an event type, and only it can have them", () => {
    expect(() => definePlugin({ key: "bare", name: "Bare", ...META, scope: "org" })).toThrow(
      /eventTypes/,
    );
    expect(() =>
      definePlugin({
        key: "stray",
        name: "Stray",
        ...META,
        eventTypes: [{ key: "x", label: "X", description: "X." }],
      }),
    ).toThrow(/isn't org-scoped/);
  });

  test("event types need unique keys and sane team sizes", () => {
    const type = { key: "x", label: "X", description: "X." };
    expect(() =>
      definePlugin({ key: "dup", name: "Dup", ...META, scope: "org", eventTypes: [type, type] }),
    ).toThrow(/unique/);
    expect(() =>
      definePlugin({
        key: "size",
        name: "Size",
        ...META,
        scope: "org",
        eventTypes: [{ ...type, teamSize: [4, 2] }],
      }),
    ).toThrow(/teamSize/);
  });
});

describe("event type settings and limits", () => {
  const golf = definePlugin({
    key: "golfish",
    name: "Golfish",
    ...META,
    scope: "org",
    settings: {
      scoring: {
        type: "select",
        label: "Scoring",
        default: "icpc",
        options: [
          { value: "icpc", label: "ICPC" },
          { value: "golf", label: "Golf" },
        ],
      },
    },
    eventTypes: [
      {
        key: "golf",
        label: "Golf",
        description: "Fewest characters wins.",
        settings: { scoring: "golf" },
      },
    ],
    limits: { maxMemoryMb: { label: "Memory", unit: "MB" } },
  });

  test("an event type starts the plugin at its own settings", () => {
    expect(pluginEventTypes([golf])[0]?.settings).toEqual({ scoring: "golf" });
  });

  test("those settings have to be the plugin's, at values that fit", () => {
    const make = (settings: Record<string, string | number | boolean>) =>
      definePlugin({
        key: "bad",
        name: "Bad",
        ...META,
        scope: "org",
        settings: golf.settings,
        eventTypes: [{ key: "x", label: "X", description: "X.", settings }],
      });
    expect(() => make({ nope: true })).toThrow(/starts "nope"/);
    expect(() => make({ scoring: "chess" })).toThrow(/starts "scoring"/);
  });

  test("limits are listed under the plugin's key, with where the instance's value lives", () => {
    expect(pluginLimits([golf])).toEqual([
      {
        key: "golfish.maxMemoryMb",
        plugin: "golfish",
        pluginName: "Golfish",
        name: "maxMemoryMb",
        label: "Memory",
        unit: "MB",
      },
    ]);
    expect(pluginLimitsNamespace(golf)).toBe("plugin.golfish.limits");
  });

  test("a limit's name is camelCase", () => {
    expect(() =>
      definePlugin({
        key: "badlimit",
        name: "Bad",
        ...META,
        limits: { "max-memory": { label: "M" } },
      }),
    ).toThrow(/camelCase/);
  });
});

describe("settings sections", () => {
  const settings = {
    a: { type: "boolean", label: "A" },
    b: { type: "number", label: "B" },
    c: { type: "string", label: "C" },
  } as const;
  const placed = definePlugin({
    key: "placed",
    name: "Placed",
    ...META,
    settings,
    settingsPages: [{ key: "rules", label: "Rules" }],
    settingsSections: [
      { key: "safe", title: "Safe", page: "security", settings: ["a"] },
      { key: "mine", title: "Mine", page: "rules", settings: ["b"] },
    ],
  });

  test("sectioned settings leave the plugin's row; the rest stay", () => {
    expect(generalSettingNames(placed)).toEqual(["c"]);
  });

  test("sections are found by core page or by the plugin's own page", () => {
    expect(settingsSectionsOn([placed], "security").map((each) => each.section.key)).toEqual([
      "safe",
    ]);
    expect(settingsSectionsOn([placed], "placed:rules").map((each) => each.section.key)).toEqual([
      "mine",
    ]);
    expect(settingsSectionsOn([placed], "rules")).toEqual([]);
  });

  test("a section names a known page and its own settings, each once", () => {
    const make = (sections: Parameters<typeof definePlugin>[0]["settingsSections"]) => () =>
      definePlugin({ key: "bad", name: "Bad", ...META, settings, settingsSections: sections });
    expect(make([{ key: "x", title: "X", page: "nowhere", settings: ["a"] }])).toThrow(
      /names page/,
    );
    expect(make([{ key: "x", title: "X", page: "security", settings: ["z"] }])).toThrow(
      /isn't one of its settings/,
    );
    expect(
      make([
        { key: "x", title: "X", page: "security", settings: ["a"] },
        { key: "y", title: "Y", page: "judging", settings: ["a"] },
      ]),
    ).toThrow(/two sections/);
  });
});

describe("settings presets", () => {
  const settings = {
    mode: {
      type: "select",
      label: "Mode",
      default: "a",
      options: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ],
    },
    limit: { type: "number", label: "Limit", min: 0, max: 10 },
  } as const;
  const base = {
    key: "preset",
    name: "Preset",
    ...META,
    settings,
    settingsPages: [{ key: "rules", label: "Rules" }],
    settingsSections: [{ key: "all", title: "All", page: "rules", settings: ["mode", "limit"] }],
  } as const;

  test("are found on their page", () => {
    const plugin = definePlugin({
      ...base,
      settingsPresets: [
        { key: "strict", label: "Strict", page: "rules", values: { mode: "b", limit: 1 } },
        { key: "solo", label: "Solo", page: "judging", values: {}, teamSize: [1, 1] },
      ],
    });
    expect(settingsPresetsOn([plugin], "preset:rules")[0]?.presets.map((each) => each.key)).toEqual(
      ["strict"],
    );
    expect(settingsPresetsOn([plugin], "judging")[0]?.presets.map((each) => each.key)).toEqual([
      "solo",
    ]);
    expect(settingsPresetsOn([plugin], "rules")).toEqual([]);
  });

  test("set values that fit the plugin's settings", () => {
    const make =
      (values: Record<string, string | number | boolean>, teamSize?: [number, number]) => () =>
        definePlugin({
          ...base,
          settingsPresets: [
            { key: "x", label: "X", page: "rules", values, ...(teamSize ? { teamSize } : {}) },
          ],
        });
    expect(make({ mode: "c" })).toThrow(/doesn't fit/);
    expect(make({ limit: 11 })).toThrow(/doesn't fit/);
    expect(make({ other: true })).toThrow(/doesn't fit/);
    expect(make({})).toThrow(/sets nothing/);
    expect(make({ mode: "a" }, [3, 1])).toThrow(/teamSize/);
    expect(make({ mode: "a" }, [1, 3])).not.toThrow();
  });
});

describe("requires and shares", () => {
  const base = { key: "scores", name: "Scores", ...META };

  test("name other plugins and bare SQL names", () => {
    expect(() =>
      definePlugin({
        ...base,
        requires: ["challenges"],
        shares: { messages: true, sql: ["scores_board", "scores_rank"] },
      }),
    ).not.toThrow();
  });

  test("a plugin can't require itself or something that isn't a key", () => {
    expect(() => definePlugin({ ...base, requires: ["scores"] })).toThrow(/another plugin's key/);
    expect(() => definePlugin({ ...base, requires: ["Not A Key"] })).toThrow(
      /another plugin's key/,
    );
  });

  test("shares.sql takes names, not schemas or signatures", () => {
    expect(() => definePlugin({ ...base, shares: { sql: ["public.scores_board"] } })).toThrow(
      /bare name/,
    );
    expect(() => definePlugin({ ...base, shares: { sql: ["scores_rank(uuid)"] } })).toThrow(
      /bare name/,
    );
  });
});
