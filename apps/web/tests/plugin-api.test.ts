import { describe, expect, test } from "vite-plus/test";
import {
  BodyTooLarge,
  bodyLimit,
  crossSiteProblem,
  declaredRoute,
  MAX_BODY_BYTES,
  readLimited,
  sanitize,
} from "../src/lib/server/plugin-api.server.ts";

const request = (method: string, headers: Record<string, string> = {}) =>
  new Request("https://hacks.example.org/api/x/duel/vote", { method, headers });

describe("crossSiteProblem", () => {
  test("reads are never refused", () => {
    expect(crossSiteProblem(request("GET", { origin: "https://evil.example" }))).toBeNull();
  });

  test("a write from another site is refused, from the same one is not", () => {
    const host = { host: "hacks.example.org" };
    expect(crossSiteProblem(request("POST", { ...host, origin: "https://evil.example" }))).toMatch(
      /cross-site/,
    );
    expect(
      crossSiteProblem(request("POST", { ...host, origin: "https://hacks.example.org" })),
    ).toBeNull();
    expect(
      crossSiteProblem(request("DELETE", { ...host, "sec-fetch-site": "cross-site" })),
    ).toMatch(/cross-site/);
    expect(
      crossSiteProblem(request("PUT", { ...host, "sec-fetch-site": "same-origin" })),
    ).toBeNull();
    expect(crossSiteProblem(request("POST", { ...host, origin: "not a url" }))).toMatch(
      /cross-site/,
    );
  });

  test("behind a proxy the forwarded host is the one that counts", () => {
    expect(
      crossSiteProblem(
        request("POST", {
          host: "web:3000",
          "x-forwarded-host": "hacks.example.org",
          origin: "https://hacks.example.org",
        }),
      ),
    ).toBeNull();
  });

  test("a request with neither header carries no browser cookie to abuse", () => {
    expect(crossSiteProblem(request("POST"))).toBeNull();
  });
});

describe("declaredRoute", () => {
  const routes = [
    { method: "GET", path: "/" },
    { method: "GET", path: "/ping" },
    { method: "POST", path: "/votes/count" },
    { method: "GET", path: "/contests/:slug/scoreboard" },
    { method: "GET", path: "/contests/all/scoreboard" },
  ] as const;

  test("matches the method and the exact path", () => {
    expect(declaredRoute(routes, "GET", "")?.id).toBe("GET /");
    expect(declaredRoute(routes, "GET", "ping")?.id).toBe("GET /ping");
    expect(declaredRoute(routes, "GET", "ping/")?.id).toBe("GET /ping");
    expect(declaredRoute(routes, "POST", "votes/count")?.id).toBe("POST /votes/count");
    expect(declaredRoute(routes, "HEAD", "ping")?.id).toBe("GET /ping");
  });

  test("a :name segment takes one word, and a fixed route wins", () => {
    expect(declaredRoute(routes, "GET", "contests/cup-1/scoreboard")).toEqual({
      id: "GET /contests/:slug/scoreboard",
      params: { slug: "cup-1" },
    });
    expect(declaredRoute(routes, "GET", "contests/all/scoreboard")?.id).toBe(
      "GET /contests/all/scoreboard",
    );
    expect(declaredRoute(routes, "GET", "contests/a b/scoreboard")).toBeNull();
    expect(declaredRoute(routes, "GET", "contests/cup-1")).toBeNull();
  });

  test("anything else isn't a route", () => {
    expect(declaredRoute(routes, "POST", "ping")).toBeNull();
    expect(declaredRoute(routes, "GET", "ping/extra")).toBeNull();
    expect(declaredRoute(routes, "GET", "../secret")).toBeNull();
    expect(declaredRoute(undefined, "GET", "ping")).toBeNull();
  });
});

describe("sanitize", () => {
  test("a plugin can't set cookies, and its answers aren't cached by default", async () => {
    const out = sanitize(
      new Response("hi", { status: 201, headers: { "set-cookie": "a=b", "x-own": "1" } }),
    );
    expect(out.status).toBe(201);
    expect(out.headers.get("set-cookie")).toBeNull();
    expect(out.headers.get("x-own")).toBe("1");
    expect(out.headers.get("cache-control")).toBe("private, no-store");
    expect(out.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await out.text()).toBe("hi");
  });

  test("a plugin's own cache-control stays", () => {
    const out = sanitize(new Response("x", { headers: { "cache-control": "public, max-age=60" } }));
    expect(out.headers.get("cache-control")).toBe("public, max-age=60");
  });
});

describe("request bodies", () => {
  test("a body within the limit is read whole", async () => {
    const body = new Request("https://x.example/", { method: "POST", body: "hello" });
    expect(new TextDecoder().decode(await readLimited(body, 10))).toBe("hello");
    expect(await readLimited(new Request("https://x.example/"), 10)).toEqual(new Uint8Array());
  });

  test("one past it stops the read, however it was sent", async () => {
    const body = new Request("https://x.example/", { method: "POST", body: "x".repeat(50) });
    await expect(readLimited(body, 10)).rejects.toBeInstanceOf(BodyTooLarge);
  });

  test("a route can ask for more than the default, in whole megabytes", () => {
    const routes = [
      { method: "POST", path: "/import", maxBodyMb: 32 },
      { method: "GET", path: "/ping" },
    ];
    expect(bodyLimit(routes, "POST /import")).toBe(32_000_000);
    expect(bodyLimit(routes, "GET /ping")).toBe(MAX_BODY_BYTES);
    expect(bodyLimit(undefined, "GET /ping")).toBe(MAX_BODY_BYTES);
  });
});
