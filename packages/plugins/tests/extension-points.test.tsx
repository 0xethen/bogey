import { afterEach, describe, expect, test } from "vite-plus/test";
import { answerProblem, clearPluginAnswerValidators } from "@bogey/utils/answers";
import {
  definePlugin,
  itemConfigDefaults,
  pluginApiRoutes,
  pluginItemTypes,
  pluginRankingMethods,
  pluginSessionKinds,
  validItemConfig,
} from "../src/api.ts";
import { definePluginRuntime } from "../src/runtime.tsx";

const BASE = {
  key: "extras",
  name: "Extras",
  api: 1,
  version: "1.0.0",
  description: "Adds extension points.",
  author: { name: "Test" },
  source: { repository: "github:someone/plugins" },
} as const;

const manifest = definePlugin({
  ...BASE,
  itemTypes: [
    {
      kind: "stars",
      label: "Star rating",
      description: "One to five stars",
      config: {
        max: { type: "number", label: "Most stars", default: 5, min: 1, max: 10 },
        half: { type: "boolean", label: "Half stars" },
      },
    },
  ],
  ranking: [{ key: "pairwise", label: "Pairwise", description: "Compare two at a time" }],
  sessionKinds: [{ key: "demo", label: "Demo", icon: "presentation", tone: "blue" }],
  serverRoutes: [
    { path: "/ping", method: "GET" },
    { path: "/votes/count", method: "POST" },
  ],
});

describe("manifest declarations", () => {
  test("item types, ranking methods, session kinds and server routes are namespaced by the plugin", () => {
    const [type] = pluginItemTypes([manifest]);
    expect(type?.kind).toBe("extras.stars");
    expect(pluginRankingMethods([manifest])[0]?.id).toBe("extras.pairwise");
    expect(pluginSessionKinds([manifest])[0]?.id).toBe("extras.demo");
    expect(pluginApiRoutes([manifest]).map((route) => route.url)).toEqual([
      "/api/x/extras/ping",
      "/api/x/extras/votes/count",
    ]);
  });

  test("an item type's settings keep values that fit and start from their defaults", () => {
    const [type] = pluginItemTypes([manifest]);
    if (!type) throw new Error("no item type");
    expect(itemConfigDefaults(type)).toEqual({ max: 5 });
    expect(validItemConfig(type, { max: 7, half: true, extra: 1 })).toEqual({ max: 7, half: true });
    expect(validItemConfig(type, { max: 99, half: "yes" })).toEqual({});
  });

  test("bad declarations are refused with the plugin and the name", () => {
    const bad = (extra: Record<string, unknown>) => () => definePlugin({ ...BASE, ...extra });
    expect(bad({ itemTypes: [{ kind: "Stars", label: "S", description: "d" }] })).toThrow(
      /item type "Stars"/,
    );
    expect(
      bad({
        itemTypes: [
          { kind: "a", label: "A", description: "d" },
          { kind: "a", label: "B", description: "d" },
        ],
      }),
    ).toThrow(/unique kind/);
    expect(
      bad({
        itemTypes: [
          {
            kind: "a",
            label: "A",
            description: "d",
            config: { maxLength: { type: "number", label: "x" } },
          },
        ],
      }),
    ).toThrow(/maxLength/);
    expect(bad({ ranking: [{ key: "Bad Key", label: "x", description: "d" }] })).toThrow(
      /ranking method/,
    );
    expect(bad({ sessionKinds: [{ key: "k", label: "K", icon: "nope", tone: "blue" }] })).toThrow(
      /icons and tones/,
    );
    expect(bad({ serverRoutes: [{ path: "ping", method: "GET" }] })).toThrow(/server route/);
    expect(bad({ serverRoutes: [{ path: "/Ping", method: "GET" }] })).toThrow(/server route/);
    expect(bad({ serverRoutes: [{ path: "/a/:", method: "GET" }] })).toThrow(/server route/);
    expect(bad({ serverRoutes: [{ path: "/a/:Slug", method: "GET" }] })).toThrow(/server route/);
    expect(bad({ serverRoutes: [{ path: "/ping", method: "TRACE" }] })).toThrow(/server route/);
    expect(
      bad({
        serverRoutes: [
          { path: "/ping", method: "GET" },
          { path: "/ping", method: "GET" },
        ],
      }),
    ).toThrow(/twice/);
    expect(bad({ serverRoutes: [{ path: "/up", method: "POST", maxBodyMb: 65 }] })).toThrow(
      /maxBodyMb/,
    );
    expect(bad({ serverRoutes: [{ path: "/up", method: "POST", maxBodyMb: 0 }] })).toThrow(
      /maxBodyMb/,
    );
  });
});

describe("definePluginRuntime", () => {
  afterEach(() => clearPluginAnswerValidators());

  const Field = () => null;
  const View = () => null;

  test("requires an implementation of every declared item type and server route", () => {
    // @ts-expect-error `itemTypes` and `serverRoutes` are required by the manifest
    expect(() => definePluginRuntime(manifest, {})).toThrow(/item type "stars"/);
    expect(() =>
      definePluginRuntime(manifest, {
        itemTypes: { stars: { Field, View, validate: () => null } },
        // @ts-expect-error `POST /votes/count` is missing
        serverRoutes: { "GET /ping": () => new Response("pong") },
      }),
    ).toThrow(/POST \/votes\/count/);
  });

  test("registers each item type's validator so answers are checked with the plugin's rules", () => {
    const runtime = definePluginRuntime(manifest, {
      itemTypes: {
        stars: {
          Field,
          View,
          validate: (value, item) => {
            const max = typeof item.config.max === "number" ? item.config.max : 5;
            return Number(value) > max ? "Too many stars" : null;
          },
        },
      },
      serverRoutes: {
        "GET /ping": () => new Response("pong"),
        "POST /votes/count": () => new Response("1"),
      },
    });
    expect(Object.keys(runtime.itemTypes)).toEqual(["extras.stars"]);
    expect(Object.keys(runtime.serverRoutes)).toEqual(["GET /ping", "POST /votes/count"]);
    const rules = {
      kind: "extras.stars" as const,
      label: "Rating",
      required: false,
      config: { max: 3 },
    };
    expect(answerProblem(rules, "4")).toBe("Too many stars");
    expect(answerProblem(rules, "3")).toBeNull();
  });
});
