import { expect, test } from "vite-plus/test";
import { issuesUrlFor } from "../src/lib/actions.ts";

test("opens a new issue on the repository", () => {
  expect(issuesUrlFor("github:acme/hacks")).toBe("https://github.com/acme/hacks/issues/new");
  expect(issuesUrlFor("https://github.com/acme/hacks.git")).toBe(
    "https://github.com/acme/hacks/issues/new",
  );
});

test("has no link without a repository, or with one it can't read", () => {
  expect(issuesUrlFor(null)).toBeNull();
  expect(issuesUrlFor("gitlab:acme/hacks")).toBeNull();
});
