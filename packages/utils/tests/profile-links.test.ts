import { expect, test } from "vite-plus/test";
import {
  kindForUrl,
  linksFromJson,
  profileLinkProblem,
  profileLinksProblem,
} from "../src/profile-links.ts";

test("addresses are checked", () => {
  expect(profileLinkProblem("https://example.com")).toBeNull();
  expect(profileLinkProblem("  ")).toMatch(/Enter an address/);
  expect(profileLinkProblem("example.com")).toMatch(/web address/);
  expect(profileLinkProblem("mailto:me@example.com")).toMatch(/web address/);
  expect(profileLinkProblem("javascript:alert(1)")).toMatch(/web address/);
  expect(profileLinkProblem(`https://x.test/${"a".repeat(300)}`)).toMatch(/300/);
});

test("a list has at most eight links, each an address", () => {
  const link = { kind: "website", url: "https://x.test" } as const;
  expect(profileLinksProblem([link])).toBeNull();
  expect(profileLinksProblem(Array.from({ length: 9 }, () => link))).toMatch(/up to 8/);
  expect(profileLinksProblem([link, { kind: "github", url: "nope" }])).toMatch(/web address/);
});

test("the platform comes from the host", () => {
  expect(kindForUrl("https://github.com/ada")).toBe("github");
  expect(kindForUrl("https://www.youtube.com/@ada")).toBe("youtube");
  expect(kindForUrl("https://youtu.be/abc")).toBe("youtube");
  expect(kindForUrl("https://twitter.com/ada")).toBe("x");
  expect(kindForUrl("https://notgithub.com/ada")).toBeNull();
  expect(kindForUrl("ada.dev")).toBeNull();
});

test("stored links are read defensively", () => {
  expect(
    linksFromJson([
      { kind: "devpost", url: "https://devpost.com/ada" },
      { kind: "myspace", url: "https://a.test" },
      { label: "Code", url: "https://github.com/ada" },
      3,
      { kind: "github" },
      null,
    ]),
  ).toEqual([
    { kind: "devpost", url: "https://devpost.com/ada" },
    { kind: "website", url: "https://a.test" },
    { kind: "github", url: "https://github.com/ada" },
  ]);
  expect(linksFromJson("nope")).toEqual([]);
});
