import { describe, expect, test } from "vite-plus/test";
import {
  fetchLibrary,
  findListing,
  LibraryIndexSchema,
  libraryIndexUrl,
  librarySchemas,
  listings,
  parseLibrarySource,
  searchListings,
  type LibraryIndex,
} from "../src/library.ts";
import type { Fetcher } from "../src/updates.ts";

const plugin = (key: string, extra: Partial<LibraryIndex["plugins"][number]> = {}) => ({
  key,
  name: key.toUpperCase(),
  version: "1.2.0",
  description: `Does ${key} things`,
  api: 1,
  tag: `${key}-v1.2.0`,
  directory: `plugins/${key}`,
  ...extra,
});

const index = (plugins = [plugin("alpha"), plugin("beta")]): LibraryIndex => ({
  schema: 1,
  name: "Ada's plugins",
  repository: "github:ada/plugins",
  plugins,
});

const serving =
  (body: unknown, status = 200): Fetcher =>
  async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });

describe("the index format", () => {
  test("accepts a well-formed index", () => {
    expect(LibraryIndexSchema.safeParse(index()).success).toBe(true);
  });

  test("refuses a tag that isn't <key>-v<version>, a repeated key and unknown fields", () => {
    expect(
      LibraryIndexSchema.safeParse(index([plugin("alpha", { tag: "alpha-v9.9.9" })])).success,
    ).toBe(false);
    expect(LibraryIndexSchema.safeParse(index([plugin("alpha"), plugin("alpha")])).success).toBe(
      false,
    );
    expect(LibraryIndexSchema.safeParse({ ...index(), extra: true }).success).toBe(false);
    expect(
      LibraryIndexSchema.safeParse(index([plugin("alpha", { directory: "../escape" })])).success,
    ).toBe(false);
  });

  test("the JSON Schemas describe both files", () => {
    const { index: indexSchema, libraries } = librarySchemas();
    expect(indexSchema.type).toBe("object");
    expect(Object.keys(indexSchema.properties ?? {})).toEqual(
      expect.arrayContaining(["schema", "name", "repository", "plugins"]),
    );
    expect(Object.keys(libraries.properties ?? {})).toContain("libraries");
  });
});

describe("a library's address", () => {
  test("is github:<owner>/<repo>", () => {
    expect(parseLibrarySource("github:ada/plugins")).toEqual({
      owner: "ada",
      repo: "plugins",
      source: "github:ada/plugins",
    });
    expect(parseLibrarySource("ada/plugins")).toMatch(/isn't github/);
    expect(parseLibrarySource("github:ada/plugins/extra")).toMatch(/isn't github/);
  });

  test("its index is read from the default branch", () => {
    const source = parseLibrarySource("github:ada/plugins");
    if (typeof source === "string") throw new Error(source);
    expect(libraryIndexUrl(source)).toBe(
      "https://raw.githubusercontent.com/ada/plugins/HEAD/index.json",
    );
  });
});

describe("fetchLibrary", () => {
  test("returns the checked index", async () => {
    const result = await fetchLibrary("github:ada/plugins", serving(index()));
    expect(result.ok && result.index.plugins.map((each) => each.key)).toEqual(["alpha", "beta"]);
  });

  test("says why it couldn't", async () => {
    const missing = await fetchLibrary("github:ada/plugins", serving({}, 404));
    expect(!missing.ok && missing.error).toMatch(/no index\.json/);
    const wrong = await fetchLibrary("github:ada/plugins", serving({ plugins: 3 }));
    expect(!wrong.ok && wrong.error).toMatch(/isn't a library index/);
    const offline = await fetchLibrary("github:ada/plugins", async () => {
      throw new Error("offline");
    });
    expect(!offline.ok && offline.error).toMatch(/offline/);
    const bad = await fetchLibrary("nonsense", serving(index()));
    expect(!bad.ok && bad.error).toMatch(/isn't github/);
  });
});

describe("finding plugins", () => {
  const ada = { ok: true as const, source: "github:ada/plugins", index: index() };
  const bob = {
    ok: true as const,
    source: "github:bob/more",
    index: { ...index([plugin("alpha"), plugin("gamma")]), repository: "github:bob/more" },
  };
  const all = listings([ada, bob, { ok: false, source: "github:down/x", error: "answered 500" }]);

  test("lists every plugin of the libraries that could be read", () => {
    expect(all.map((each) => `${each.library}:${each.key}`)).toEqual([
      "github:ada/plugins:alpha",
      "github:ada/plugins:beta",
      "github:bob/more:alpha",
      "github:bob/more:gamma",
    ]);
  });

  test("search matches every word against key, name and description", () => {
    expect(searchListings(all, "gamma").map((each) => each.key)).toEqual(["gamma"]);
    expect(searchListings(all, "does THINGS beta").map((each) => each.key)).toEqual(["beta"]);
    expect(searchListings(all, "nothing like this")).toEqual([]);
    expect(searchListings(all, "")).toHaveLength(4);
  });

  test("a key in two libraries must be chosen, one in a single library is found", () => {
    expect(findListing(all, "gamma")).toMatchObject({ library: "github:bob/more" });
    expect(findListing(all, "alpha")).toMatch(/github:ada\/plugins and github:bob\/more/);
    expect(findListing(all, "alpha", "github:bob/more")).toMatchObject({ key: "alpha" });
    expect(findListing(all, "nope")).toMatch(/no library has/);
  });
});
