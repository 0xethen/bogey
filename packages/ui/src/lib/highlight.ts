import { createHighlighter } from "@tanstack/highlight/core";
import { createTanStackMarkdownHighlighter } from "@tanstack/highlight/markdown";
import { createThemeCss } from "@tanstack/highlight/theme";
import { githubDarkTheme } from "@tanstack/highlight/themes/github-dark";
import { githubLightTheme } from "@tanstack/highlight/themes/github-light";
import { cpp } from "@tanstack/highlight/languages/cpp";
import { css } from "@tanstack/highlight/languages/css";
import { diff } from "@tanstack/highlight/languages/diff";
import { go } from "@tanstack/highlight/languages/go";
import { html } from "@tanstack/highlight/languages/html";
import { java } from "@tanstack/highlight/languages/java";
import { js } from "@tanstack/highlight/languages/js";
import { json } from "@tanstack/highlight/languages/json";
import { plaintext } from "@tanstack/highlight/languages/plaintext";
import { python } from "@tanstack/highlight/languages/python";
import { rust } from "@tanstack/highlight/languages/rust";
import { shell } from "@tanstack/highlight/languages/shell";
import { sql } from "@tanstack/highlight/languages/sql";
import { ts } from "@tanstack/highlight/languages/ts";
import { tsx } from "@tanstack/highlight/languages/tsx";
import { yaml } from "@tanstack/highlight/languages/yaml";
import type { CodeHighlighter } from "@tanstack/markdown";

/** The one highlighter: Markdown fences and `CodeBlock` both use it. */
export const highlighter = createHighlighter({
  languages: [
    plaintext,
    python,
    js,
    ts,
    tsx,
    json,
    html,
    css,
    shell,
    sql,
    yaml,
    diff,
    cpp,
    java,
    go,
    rust,
  ],
});

export const highlightMarkdownCode: CodeHighlighter =
  createTanStackMarkdownHighlighter(highlighter);

export const markdownHighlightCss = createThemeCss({
  light: githubLightTheme,
  dark: githubDarkTheme,
  lightSelector: ".typeset",
  darkSelector: ".dark .typeset",
  codeBlockSelector: ".typeset pre.tm-code",
  lineNumbersSelector: ".typeset .tm-code--line-numbers",
});

/** Token colors inside a `CodeBlock`; the block draws its own surface. */
export const codeBlockHighlightCss = createThemeCss({
  light: githubLightTheme,
  dark: githubDarkTheme,
  lightSelector: "[data-slot=code-block]",
  darkSelector: ".dark [data-slot=code-block]",
  includeBaseStyles: false,
});
