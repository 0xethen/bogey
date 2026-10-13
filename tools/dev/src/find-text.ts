import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { en } from "@bogey/config/messages";

export const USAGE = `vp run find <text or key> [--in <path part>] [--exact]

Finds where a piece of UI text is rendered: looks the English up in
packages/config/src/messages.ts, then lists every file:line that uses each
matching key, with the URL of the route it belongs to.

  <text>     visible English, matched case-insensitively; {params} in a
             message match anything ("Sign in to Hack GT" finds auth.signInTitle)
  <key>      a message key (adminTab.overview) skips the text lookup
  --in       keep only usages whose path contains this ("manage", "admin/")
  --exact    the whole message must equal <text>, not just contain it

Keys built at runtime (\`webhookKind.\${kind}\`) are listed as "dynamic".`;

export interface Usage {
  file: string;
  line: number;
  dynamic: boolean;
}

export interface Hit {
  key: string;
  text: string;
  usages: Usage[];
}

export interface SourceFile {
  path: string;
  text: string;
}

const CATALOG = "packages/config/src/messages.ts";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

// "{min} to {max}" would match nearly anything, so a template needs some real words.
const TEMPLATE_MIN_LETTERS = 5;

function templateMatches(message: string, query: string): boolean {
  if (!message.includes("{")) return false;
  const parts = message.split(/\{[^}]*\}/);
  if (parts.join("").replace(/[^\p{L}]/gu, "").length < TEMPLATE_MIN_LETTERS) return false;
  const pattern = parts
    .map((part) => escapeRegExp(part.replace(/\s+/g, " ").toLowerCase()))
    .join(".+");
  return new RegExp(`^${pattern.trim()}$`).test(query);
}

export function findKeys(catalog: Readonly<Record<string, string>>, query: string, exact: boolean) {
  const wanted = normalize(query);
  if (query in catalog) return [query];
  const scored: Array<{ key: string; score: number }> = [];
  for (const [key, message] of Object.entries(catalog)) {
    const text = normalize(message);
    if (text === wanted) scored.push({ key, score: 0 });
    else if (templateMatches(message, wanted)) scored.push({ key, score: 1 });
    else if (!exact && text.includes(wanted)) scored.push({ key, score: 2 });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.key.localeCompare(b.key))
    .map((entry) => entry.key);
}

export function findUsages(key: string, files: Tuple<SourceFile>): Usage[] {
  const literal = new RegExp(`["'\`]${escapeRegExp(key)}["'\`]`);
  const namespace = key.slice(0, key.indexOf(".") + 1);
  const dynamic = namespace ? new RegExp(`\`${escapeRegExp(namespace)}[A-Za-z0-9_.]*\\$\\{`) : null;
  const usages: Usage[] = [];
  for (const file of files) {
    if (!file.text.includes(namespace || key)) continue;
    file.text.split("\n").forEach((line, index) => {
      if (literal.test(line)) usages.push({ file: file.path, line: index + 1, dynamic: false });
      else if (dynamic?.test(line))
        usages.push({ file: file.path, line: index + 1, dynamic: true });
    });
  }
  return usages;
}

const ROUTES = /^apps\/(web|console)\/src\/routes\/(.*)\.tsx?$/;

export function routeOf(path: string): string | null {
  const match = ROUTES.exec(path);
  if (!match?.[2]) return null;
  const segments = match[2].split("/");
  const inComponents = segments.findIndex((segment) => segment.startsWith("-"));
  const kept = inComponents === -1 ? segments : segments.slice(0, inComponents);
  const url = kept
    .flatMap((segment) => segment.split("."))
    .filter((segment) => !segment.startsWith("_") && segment !== "index" && segment !== "route")
    .join("/");
  return `/${url}`;
}

function sourceFiles(root: string): SourceFile[] {
  const listed = execFileSync(
    "git",
    ["ls-files", "-co", "--exclude-standard", "--", "apps", "packages", "tools"],
    { cwd: root, encoding: "utf8" },
  );
  return listed
    .split("\n")
    .filter(
      (path) =>
        /\.(ts|tsx)$/.test(path) &&
        path !== CATALOG &&
        !path.endsWith(".gen.ts") &&
        !path.includes("/tests/"),
    )
    .flatMap((path) => {
      try {
        return [{ path, text: readFileSync(join(root, path), "utf8") }];
      } catch {
        return [];
      }
    });
}

export function findText(
  query: string,
  options: { within?: string; exact?: boolean },
  files: Tuple<SourceFile>,
  catalog: Readonly<Record<string, string>> = en,
): Hit[] {
  return findKeys(catalog, query, options.exact ?? false).map((key) => ({
    key,
    text: catalog[key] ?? "",
    usages: findUsages(key, files).filter(
      (usage) => !options.within || usage.file.includes(options.within),
    ),
  }));
}

export function formatHits(hits: Tuple<Hit>, within: string | undefined): string {
  if (hits.length === 0) return `No message in ${CATALOG} matches. The text may be hard-coded.`;
  const shown = within ? hits.filter((hit) => hit.usages.length > 0) : hits;
  if (shown.length === 0) return `${hits.length} key(s) match, but none is used under "${within}".`;
  return shown
    .map((hit) => {
      const lines = hit.usages.map((usage) => {
        const route = routeOf(usage.file);
        return `  ${usage.file}:${usage.line}${usage.dynamic ? "  (dynamic)" : ""}${route ? `  → ${route}` : ""}`;
      });
      return [
        `${hit.key}  ${JSON.stringify(hit.text)}`,
        ...(lines.length ? lines : ["  (unused)"]),
      ].join("\n");
    })
    .join("\n\n");
}

function main(args: string[]): number {
  const words: string[] = [];
  let within: string | undefined;
  let exact = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--in") within = args[++index];
    else if (arg === "--exact") exact = true;
    else if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      return 0;
    } else if (arg !== undefined) words.push(arg);
  }
  const query = words.join(" ");
  if (!query) {
    console.error(USAGE);
    return 1;
  }
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  console.log(formatHits(findText(query, { within, exact }, sourceFiles(root)), within));
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv.slice(2));
