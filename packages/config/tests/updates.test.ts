import { expect, test } from "vite-plus/test";
import { repository, updateChecksEnabled } from "../src/index.ts";

test("update checks are on unless the server turns them off", () => {
  expect(updateChecksEnabled({})).toBe(true);
  expect(updateChecksEnabled({ BOGEY_UPDATE_CHECK: "true" })).toBe(true);
  for (const off of ["false", "FALSE", "0", "off", "no"]) {
    expect(updateChecksEnabled({ BOGEY_UPDATE_CHECK: off })).toBe(false);
  }
});

test("the issue tracker defaults to the upstream repository", () => {
  expect(repository).toMatch(/^github:[\w.-]+\/[\w.-]+$/);
});
