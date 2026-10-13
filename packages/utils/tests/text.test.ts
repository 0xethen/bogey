import { expect, test } from "vite-plus/test";
import { excerpt, plural } from "../src/text.ts";

test("plural", () => {
  expect(plural(1, "team")).toBe("1 team");
  expect(plural(0, "team")).toBe("0 teams");
  expect(plural(2, "person", "people")).toBe("2 people");
});

test("excerpt", () => {
  expect(excerpt("# Hi\n\nA **bold** [link](https://x.test) and `code`.")).toBe(
    "Hi A bold link and code.",
  );
  expect(excerpt("- one\n- two")).toBe("one two");
  expect(excerpt("word ".repeat(50), 20)).toBe("word word word word...");
});
