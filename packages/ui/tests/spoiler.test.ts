import { expect, test } from "vite-plus/test";
import { renderHtml } from "@tanstack/markdown/html";
import { spoilerExtension } from "../src/lib/spoiler.ts";

const html = (source: string) => renderHtml(source, { extensions: [spoilerExtension()] });

test("||text|| becomes a spoiler element", () => {
  expect(html("The answer is ||42||.")).toContain("<bogey-spoiler>42</bogey-spoiler>");
});

test("a spoiler can hold other formatting", () => {
  expect(html("||**big** news||")).toContain(
    "<bogey-spoiler><strong>big</strong> news</bogey-spoiler>",
  );
});

test("spoilers inside emphasis and links work too", () => {
  expect(html("_see ||this||_")).toContain("<em>see <bogey-spoiler>this</bogey-spoiler></em>");
});

test("unmatched or empty markers stay as typed", () => {
  expect(html("a || b")).toContain("a || b");
  expect(html("a |||| b")).toContain("a |||| b");
  expect(html("`||code||`")).toContain("<code>||code||</code>");
});
