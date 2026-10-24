#!/usr/bin/env node
// Moves a trailing "..." from message values into the code next to each t() call.
//
// node scripts/i18n-ellipsis.mjs [--dry-run] [--keys-out <file>]
//   Monorepo run: rewrites messages.ts and the call sites.
// node scripts/i18n-ellipsis.mjs --es <es.json> --keys <file> [--dry-run]
//   Only strips the same keys from a flat es.json. Touches nothing else.
//   <file> is the --keys-out list from the monorepo run.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MESSAGES = path.join(ROOT, "packages/config/src/messages.ts");
const DOTS = "...";
const ES_TRAIL = /\s*(\.\.\.|…)$/;
const KEYWORDS_BEFORE_BLOCK = new Set([
  "else",
  "try",
  "finally",
  "do",
  "return",
  "case",
  "default",
]);
const ENTRY = /^(\s*"([^"\\]+)":\s*")((?:[^"\\]|\\.)*)("\s*,?\s*)$/;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const value = args[i + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
};
const DRY = flag("--dry-run");

function readKeysFile(file) {
  return fs
    .readFileSync(path.resolve(file), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function messageLines() {
  return fs.readFileSync(MESSAGES, "utf8").split("\n");
}

// Keys whose English value ends with "..."
function dottedKeys(lines) {
  const keys = [];
  for (const line of lines) {
    const m = ENTRY.exec(line);
    if (m && m[3].endsWith(DOTS)) keys.push(m[2]);
  }
  return keys;
}

function esMode(esFile) {
  const file = path.resolve(esFile);
  const raw = fs.readFileSync(file, "utf8");
  // messages.ts no longer has the dots after a monorepo run, so the key list is required.
  if (!option("--keys")) throw new Error("--es needs --keys <file> (the list from --keys-out)");
  const keys = readKeysFile(option("--keys"));
  const indent = /^(\s+)"/m.exec(raw)?.[1] ?? "  ";
  const obj = JSON.parse(raw);
  const changed = [];
  const missing = [];
  for (const key of keys) {
    if (!(key in obj)) {
      missing.push(key);
      continue;
    }
    const value = obj[key];
    if (typeof value === "string" && ES_TRAIL.test(value)) {
      obj[key] = value.replace(ES_TRAIL, "");
      changed.push(key);
    }
  }
  if (!DRY && changed.length) {
    fs.writeFileSync(file, JSON.stringify(obj, null, indent.length ? indent : 2) + "\n");
  }
  console.log(`es: ${file}`);
  console.log(
    `keys listed: ${keys.length}, stripped: ${changed.length}, not in file: ${missing.length}`,
  );
  if (missing.length) console.log(`  not in file (first 10): ${missing.slice(0, 10).join(", ")}`);
  if (DRY) console.log("dry run, nothing written");
}

// Index of the ')' matching the '(' at open, or -1.
function matchParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(text, i);
      if (i < 0) return -1;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function skipString(text, i) {
  const q = text[i];
  for (let j = i + 1; j < text.length; j++) {
    if (text[j] === "\\") {
      j++;
      continue;
    }
    if (text[j] === q) return j;
    if (q === "`" && text[j] === "$" && text[j + 1] === "{") {
      let depth = 0;
      for (let k = j + 1; k < text.length; k++) {
        if (text[k] === "{") depth++;
        else if (text[k] === "}" && --depth === 0) {
          j = k;
          break;
        }
      }
    }
  }
  return -1;
}

function prevNonWs(text, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(text[j])) j--;
  return j;
}

function nextNonWs(text, i) {
  let j = i;
  while (j < text.length && /\s/.test(text[j])) j++;
  return j;
}

// True when a '{' before position p starts a JSX child, not a JS block or object.
function isJsxChildBrace(text, p) {
  if (p < 0) return false;
  const c = text[p];
  if ("=(,:;[?&|+!{)*/%-~^\"'`".includes(c)) return false;
  if (c === ">" && text[p - 1] === "=") return false;
  const word = /[A-Za-z]+$/.exec(text.slice(Math.max(0, p - 10), p + 1));
  if (word && KEYWORDS_BEFORE_BLOCK.has(word[0])) return false;
  return true;
}

// Returns the edits for one t("key") call: [pos, text, order].
function editsFor(text, tStart, closeIdx) {
  const open = prevNonWs(text, tStart);
  const after = nextNonWs(text, closeIdx + 1);
  if (text[tStart - 1] === "{" && text[tStart - 2] === "$" && text[closeIdx + 1] === "}") {
    return { kind: "interpolation", edits: [[closeIdx + 2, DOTS]] };
  }
  if (text[open] === "{" && text[after] === "}" && isJsxChildBrace(text, prevNonWs(text, open))) {
    return { kind: "jsx", edits: [[after + 1, DOTS]] };
  }
  return {
    kind: text[open] === "{" && text[prevNonWs(text, open)] === "=" ? "attribute" : "expression",
    edits: [
      [tStart, "`${"],
      [closeIdx + 1, "}...`"],
    ],
  };
}

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name) && !entry.name.endsWith(".d.ts"))
      out.push(full);
  }
  return out;
}

function codeFiles() {
  const roots = [];
  for (const app of fs.readdirSync(path.join(ROOT, "apps"), { withFileTypes: true })) {
    if (app.isDirectory()) roots.push(path.join(ROOT, "apps", app.name, "src"));
  }
  for (const pkg of fs.readdirSync(path.join(ROOT, "packages"), { withFileTypes: true })) {
    if (pkg.isDirectory()) roots.push(path.join(ROOT, "packages", pkg.name, "src"));
  }
  roots.push(path.join(ROOT, "packages/plugins/bundled"));
  const files = roots.flatMap((r) => walk(r, []));
  return files.filter((f) => path.resolve(f) !== MESSAGES);
}

function monorepoMode() {
  const lines = messageLines();
  const keys = dottedKeys(lines);
  const sites = new Map(keys.map((k) => [k, []]));
  const indirect = new Map(keys.map((k) => [k, []]));
  const kinds = { jsx: 0, attribute: 0, expression: 0, interpolation: 0 };
  const edited = [];
  let calls = 0;

  for (const file of codeFiles()) {
    const original = fs.readFileSync(file, "utf8");
    const rel = path.relative(ROOT, file);
    const edits = [];
    const lineOf = (i) => original.slice(0, i).split("\n").length;

    for (const key of keys) {
      for (const q of ['"', "'", "`"]) {
        const needle = q + key + q;
        let at = original.indexOf(needle);
        while (at !== -1) {
          const pre = original.slice(Math.max(0, at - 60), at);
          const m = /(?<![\w$])t\(\s*$/.exec(pre);
          const where = `${rel}:${lineOf(at)}`;
          if (!m) {
            indirect.get(key).push(where);
          } else {
            const tStart = Math.max(0, at - 60) + m.index;
            const tEnd = tStart + 1;
            const closeIdx = matchParen(original, tEnd);
            if (closeIdx < 0) {
              indirect.get(key).push(where + " (unmatched paren)");
            } else {
              const { kind, edits: e } = editsFor(original, tStart, closeIdx);
              for (const [pos, ins] of e) edits.push({ pos, ins, order: edits.length });
              kinds[kind]++;
              calls++;
              sites.get(key).push(where);
            }
          }
          at = original.indexOf(needle, at + 1);
        }
      }
    }
    if (edits.length) {
      edits.sort((a, b) => b.pos - a.pos || b.order - a.order);
      let text = original;
      for (const { pos, ins } of edits) text = text.slice(0, pos) + ins + text.slice(pos);
      if (!DRY) fs.writeFileSync(file, text);
      edited.push(rel);
    }
  }

  const changed = [];
  const skipped = [];
  const unused = [];
  for (const key of keys) {
    if (indirect.get(key).length) {
      skipped.push(`${key}: used outside t() at ${indirect.get(key).join(", ")}`);
    } else {
      changed.push(key);
      if (sites.get(key).length === 0) unused.push(key);
    }
  }

  const changedSet = new Set(changed);
  const outLines = lines.map((line) => {
    const m = ENTRY.exec(line);
    if (!m || !changedSet.has(m[2]) || !m[3].endsWith(DOTS)) return line;
    return m[1] + m[3].slice(0, -DOTS.length) + m[4];
  });
  if (!DRY) fs.writeFileSync(MESSAGES, outLines.join("\n"));

  if (option("--keys-out")) {
    if (!DRY) fs.writeFileSync(path.resolve(option("--keys-out")), changed.join("\n") + "\n");
  }

  console.log(`keys with "..." in English: ${keys.length}`);
  console.log(`keys changed: ${changed.length}`);
  console.log(
    `call sites rewritten: ${calls} (jsx ${kinds.jsx}, attribute ${kinds.attribute}, expression ${kinds.expression}, interpolation ${kinds.interpolation})`,
  );
  console.log(`files edited: ${edited.length}`);
  console.log(`keys skipped: ${skipped.length}`);
  for (const s of skipped) console.log(`  ${s}`);
  console.log(`keys with no call site (value stripped anyway): ${unused.length}`);
  for (const k of unused) console.log(`  ${k}`);
  if (DRY) console.log("dry run, nothing written");
}

if (option("--es")) esMode(option("--es"));
else monorepoMode();
