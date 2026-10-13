import { expect, test } from "vite-plus/test";
import { commandMode, registerAction } from "../src/lib/actions.ts";

test("prefixes pick actions or pages", () => {
  expect(commandMode("/ sign")).toEqual({ mode: "actions", query: "sign" });
  expect(commandMode("#team")).toEqual({ mode: "pages", query: "team" });
  expect(commandMode("team")).toEqual({ mode: "all", query: "team" });
});

test("an action leaves when its component does", () => {
  const remove = registerAction({ id: "x", label: "X", group: "G", run: () => {} });
  remove();
  remove();
});
