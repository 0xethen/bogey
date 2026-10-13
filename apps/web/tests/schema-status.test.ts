import { expect, test } from "vite-plus/test";
import { schemaDrift } from "../src/routes/_authed/admin/-components/schema-status.tsx";

test("schemaDrift", () => {
  expect(schemaDrift(["1", "2"], null)).toEqual({ kind: "untracked" });
  expect(schemaDrift(["1", "2"], ["1", "2"])).toEqual({ kind: "current" });
  expect(schemaDrift(["1", "2"], ["1"])).toEqual({ kind: "behind", count: 1 });
  expect(schemaDrift(["1"], ["1", "2"])).toEqual({ kind: "ahead", count: 1 });
});
