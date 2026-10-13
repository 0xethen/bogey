import { createHighlighter } from "@tanstack/highlight/core";
import { createTanStackMarkdownHighlighter } from "@tanstack/highlight/markdown";
import { createThemeCss } from "@tanstack/highlight/theme";
import { githubDarkTheme } from "@tanstack/highlight/themes/github-dark";
import { githubLightTheme } from "@tanstack/highlight/themes/github-light";
import { css } from "@tanstack/highlight/languages/css";
import { html } from "@tanstack/highlight/languages/html";
import { js } from "@tanstack/highlight/languages/js";
import { json } from "@tanstack/highlight/languages/json";
import { plaintext } from "@tanstack/highlight/languages/plaintext";
import { python } from "@tanstack/highlight/languages/python";
import { shell } from "@tanstack/highlight/languages/shell";
import { sql } from "@tanstack/highlight/languages/sql";
import { ts } from "@tanstack/highlight/languages/ts";
import { tsx } from "@tanstack/highlight/languages/tsx";
import { yaml } from "@tanstack/highlight/languages/yaml";
import type { CodeHighlighter } from "@tanstack/markdown";

const highlighter = createHighlighter({
  languages: [plaintext, python, js, ts, tsx, json, html, css, shell, sql, yaml],
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
