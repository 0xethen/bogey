import { expect, test } from "vite-plus/test";
import { renderHtml } from "@tanstack/markdown/html";
import { markdownExtensions } from "../src/components/markdown.tsx";
import type { MarkdownFeatureSet } from "@bogey/utils/markdown";

const html = (source: string, features?: MarkdownFeatureSet) =>
  renderHtml(source, { extensions: markdownExtensions(features) });

test("++text++ underlines, C++ stays as typed", () => {
  expect(html("a ++word++ b")).toContain("<u>word</u>");
  expect(html("C++ and C++")).not.toContain("<u>");
});

test("full fields keep headings, links and lists", () => {
  const out = html("# Title\n\n[a](https://x.test)\n\n- one");
  expect(out).toContain("<h1");
  expect(out).toContain('<a href="https://x.test"');
  expect(out).toContain("<li>");
});

test("message fields show headings as plain text", () => {
  const out = html("## Hello **there**", "message");
  expect(out).not.toContain("<h2");
  expect(out).toContain("## Hello <strong>there</strong>");
});

test("fields without links keep the source text", () => {
  const out = html("see [docs](https://x.test) or https://y.test", { links: false });
  expect(out).not.toContain("<a ");
  expect(out).toContain("[docs](https://x.test)");
  expect(out).toContain("https://y.test");
});

test("plain fields flatten lists and code", () => {
  const out = html("- one\n- two\n\n`x`", "plain");
  expect(out).not.toContain("<li>");
  expect(out).toContain("- one");
  expect(out).not.toContain("<code>");
});
