import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import { definePlugin } from "../src/api.ts";
import { prefixMessages } from "../src/messages.ts";
import {
  definePluginRuntime,
  type PluginAreaRoutes,
  type PluginOrgContext,
  type PluginRouteContext,
  type PluginSignedInContext,
} from "../src/runtime.tsx";

const META = {
  api: 1,
  version: "1.0.0",
  description: "Pages in every area.",
  author: { name: "Test" },
  source: { repository: "github:someone/plugins" },
} as const;

const manifest = definePlugin({
  key: "areas",
  name: "Areas",
  ...META,
  routes: [
    { path: "", label: "Board" },
    { path: "/review", area: "manage", label: "Review" },
    { path: "/billing", area: "org" },
    { path: "/linked", area: "account" },
    { path: "/runners", area: "admin" },
    { path: "/join", area: "public" },
  ],
  translations: ["es"],
});

const Event = ({ eventId }: PluginRouteContext) => <p>{eventId}</p>;
const Org = ({ orgId }: PluginOrgContext & { splat: string }) => <p>{orgId}</p>;
const Plain = ({ splat }: PluginSignedInContext & { splat: string }) => <p>{splat}</p>;
const Join = () => null;

describe("definePluginRuntime areas", () => {
  const runtime = definePluginRuntime(manifest, {
    routes: { "": Event, "/review": Event, "/billing": Org, "/linked": Plain, "/runners": Plain },
    publicRoutes: { "/join": Join },
    messages: { es: async () => ({ title: "Tablero" }) },
  });

  test("groups pages by area", () => {
    expect(Object.keys(runtime.routes.event)).toEqual([""]);
    expect(Object.keys(runtime.routes.manage)).toEqual(["/review"]);
    expect(Object.keys(runtime.routes.org)).toEqual(["/billing"]);
    expect(Object.keys(runtime.routes.account)).toEqual(["/linked"]);
    expect(Object.keys(runtime.routes.admin)).toEqual(["/runners"]);
    expect(Object.keys(runtime.publicRoutes)).toEqual(["/join"]);
  });

  test("each page is typed with its area's context", () => {
    definePluginRuntime(manifest, {
      routes: {
        "": Event,
        "/review": Event,
        // @ts-expect-error an org page gets `orgId`, not `eventId`
        "/billing": Event,
        "/linked": Plain,
        "/runners": Plain,
      },
      publicRoutes: { "/join": Join },
      messages: { es: async () => ({}) },
    });
    expectTypeOf(runtime.routes.org).toEqualTypeOf<PluginAreaRoutes<"org">>();
  });

  test("a declared page or translation can't be left out", () => {
    expect(() =>
      definePluginRuntime(manifest, {
        // @ts-expect-error "/runners" is declared
        routes: { "": Event, "/review": Event, "/billing": Org, "/linked": Plain },
        publicRoutes: { "/join": Join },
        messages: { es: async () => ({}) },
      }),
    ).toThrow(/\/runners/);
    expect(() =>
      // @ts-expect-error `messages.es` is declared in `translations`
      definePluginRuntime(manifest, {
        routes: {
          "": Event,
          "/review": Event,
          "/billing": Org,
          "/linked": Plain,
          "/runners": Plain,
        },
        publicRoutes: { "/join": Join },
      }),
    ).toThrow(/translation "es"/);
  });

  test("a plugin's own messages merge under its key", () => {
    expect(prefixMessages("areas", { title: "Tablero" })).toEqual({ "areas.title": "Tablero" });
  });
});
