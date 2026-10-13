import { describe, expect, test } from "vite-plus/test";
import { activeFormats, applyEdit, formatMarkdown, insertMarkdown } from "../src/markdown.ts";

function run(
  value: string,
  start: number,
  end: number,
  format: "bold" | "italic" | "spoiler" | "link",
) {
  const edit = formatMarkdown(value, start, end, format);
  const next = applyEdit(value, edit);
  return { next, selected: next.slice(edit.start, edit.end) };
}

describe("formatMarkdown", () => {
  test("wraps the selection and keeps it selected", () => {
    expect(run("say hi now", 4, 6, "bold")).toEqual({ next: "say **hi** now", selected: "hi" });
    expect(run("say hi now", 4, 6, "spoiler")).toEqual({ next: "say ||hi|| now", selected: "hi" });
    expect(run("say hi now", 4, 6, "italic")).toEqual({ next: "say _hi_ now", selected: "hi" });
  });

  test("unwraps markers just outside the selection", () => {
    expect(run("say **hi** now", 6, 8, "bold")).toEqual({ next: "say hi now", selected: "hi" });
  });

  test("unwraps markers inside the selection", () => {
    expect(run("say _hi_ now", 4, 8, "italic")).toEqual({ next: "say hi now", selected: "hi" });
  });

  test("an empty selection leaves the caret between markers", () => {
    const edit = formatMarkdown("ab", 1, 1, "bold");
    expect(applyEdit("ab", edit)).toBe("a****b");
    expect([edit.start, edit.end]).toEqual([3, 3]);
  });

  test("links select the url, or the placeholder label", () => {
    expect(run("see docs", 4, 8, "link")).toEqual({
      next: "see [docs](https://)",
      selected: "https://",
    });
    expect(run("", 0, 0, "link")).toEqual({ next: "[link text](https://)", selected: "link text" });
  });
});

test("insertMarkdown replaces the selection", () => {
  const edit = insertMarkdown(1, 3, "X");
  expect(applyEdit("abcd", edit)).toBe("aXd");
  expect([edit.start, edit.end]).toEqual([2, 2]);
});

describe("activeFormats", () => {
  test("reports the formats around the caret", () => {
    const text = "a **bold _both_** c";
    expect([...activeFormats(text, 6, 6)]).toEqual(["bold"]);
    expect([...activeFormats(text, 12, 12)].sort()).toEqual(["bold", "italic"]);
    expect([...activeFormats(text, 1, 1)]).toEqual([]);
    expect([...activeFormats("x ||secret|| y", 6, 6)]).toEqual(["spoiler"]);
    expect([...activeFormats("[a](https://b.c)", 2, 2)]).toEqual(["link"]);
  });
});
