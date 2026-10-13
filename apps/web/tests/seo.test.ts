import { expect, test } from "vite-plus/test";
import { seoMeta } from "../src/lib/seo.ts";

const base = { title: "Sign in", siteName: "Bogey" };

test("signed-in pages are never indexed and describe nothing", () => {
  expect(
    seoMeta({ ...base, seo: { indexing: true, description: "Hacks" }, signedIn: true }),
  ).toEqual([{ name: "robots", content: "noindex, nofollow" }]);
});

test("public pages follow the setting", () => {
  const meta = seoMeta({ ...base, seo: { indexing: false }, signedIn: false });
  expect(meta).toContainEqual({ name: "robots", content: "noindex, nofollow" });
  expect(meta.some((tag) => "name" in tag && tag.name === "description")).toBe(false);
});

test("a description fills search results and link previews", () => {
  const meta = seoMeta({ ...base, seo: { indexing: true, description: "Hacks" }, signedIn: false });
  expect(meta).toContainEqual({ name: "robots", content: "index, follow" });
  expect(meta).toContainEqual({ name: "description", content: "Hacks" });
  expect(meta).toContainEqual({ property: "og:description", content: "Hacks" });
  expect(meta).toContainEqual({ property: "og:title", content: "Sign in" });
});
