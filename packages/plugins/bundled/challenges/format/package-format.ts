import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import type { Verdict } from "../db.ts";

export type PackageChecker = "exact" | "tokens" | "float" | "custom";
export type GroupRule = { aggregation: "sum" | "min"; stopOnFail: boolean };
export type PackageFile = { name: string; bytes: Uint8Array };

export type PackageTest = {
  isSample: boolean;
  groupKey: string | null;
  points: number | null;
  input: string;
  answer: string;
};

export type PackageSolution = {
  label: string;
  language: string;
  source: string;
  expected: Verdict;
};

export type ProblemPackage = {
  name: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  outputLimitKb: number;
  checker: PackageChecker;
  tolerance: number | null;
  validator: { language: string; filename: string; source: string } | null;
  statementMd: string;
  tests: Tuple<PackageTest>;
  groups: Readonly<Record<string, GroupRule>>;
  attachments: Tuple<PackageFile>;
  solutions: Tuple<PackageSolution>;
  /** Kattis `type: scoring`: points per test group; otherwise pass/fail. */
  scoring?: boolean;
};

export type ParsedPackage = ProblemPackage & {
  points: number | null;
  warnings: Tuple<string>;
};

export class PackageError extends Error {}

export const PACKAGE_LIMITS = {
  entries: 5000,
  fileBytes: 16 * 1024 * 1024,
  totalBytes: 128 * 1024 * 1024,
  solutions: 30,
  solutionBytes: 256 * 1024,
} as const;

type YamlValue = string | number | boolean | null | YamlMap | YamlList;
interface YamlMap {
  [key: string]: YamlValue;
}
interface YamlList extends Tuple<YamlValue> {}

type YamlLine = { indent: number; text: string };

function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      if (i === 0 || /[\s:[{,-]/.test(line[i - 1] ?? "")) quote = c;
    } else if (c === "#" && (i === 0 || /\s/.test(line[i - 1] ?? ""))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function scalar(raw: string): YamlValue {
  const text = raw.trim();
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === "string") return parsed;
    } catch {}
    return text.slice(1, -1);
  }
  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) {
    return text.slice(1, -1).replaceAll("''", "'");
  }
  if (text === "" || text === "~" || text === "null") return null;
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(text)) return Number(text);
  return text;
}

function splitFlow(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.filter((part) => part.trim() !== "");
}

function keyEnd(text: string): number {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) quote = null;
    } else if ((c === '"' || c === "'") && i === 0) quote = c;
    else if (c === ":" && (i === text.length - 1 || text[i + 1] === " ")) return i;
  }
  return -1;
}

function flow(text: string): YamlValue {
  const trimmed = text.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return splitFlow(trimmed.slice(1, -1)).map(flow);
  }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const map: YamlMap = {};
    for (const part of splitFlow(trimmed.slice(1, -1))) {
      const end = keyEnd(part.trim());
      if (end < 0) throw new PackageError(`Can't read "${part.trim()}" in a YAML file.`);
      const entry = part.trim();
      map[String(scalar(entry.slice(0, end)))] = flow(entry.slice(end + 1));
    }
    return map;
  }
  return scalar(trimmed);
}

export function parseYaml(source: string): YamlValue {
  const lines: YamlLine[] = [];
  for (const rawLine of source.replace(/^﻿/, "").split(/\r?\n/)) {
    if (rawLine.trim() === "" || rawLine.trim() === "---") continue;
    const stripped = stripComment(rawLine);
    if (stripped.trim() === "") continue;
    if (/^\s*\t/.test(stripped)) throw new PackageError("A YAML file is indented with tabs.");
    lines.push({ indent: stripped.length - stripped.trimStart().length, text: stripped.trim() });
  }
  if (lines.length === 0) return null;

  let at = 0;

  function blockScalar(parentIndent: number, folded: boolean): string {
    const taken: string[] = [];
    while (at < lines.length && (lines[at]?.indent ?? 0) > parentIndent) {
      taken.push(lines[at]?.text ?? "");
      at++;
    }
    return taken.join(folded ? " " : "\n");
  }

  function block(indent: number): YamlValue {
    const first = lines[at];
    if (!first) return null;
    if (first.text === "-" || first.text.startsWith("- ")) {
      const list: YamlValue[] = [];
      while (at < lines.length && lines[at]?.indent === indent) {
        const item = lines[at];
        if (!item || !(item.text === "-" || item.text.startsWith("- "))) break;
        const rest = item.text.slice(1).trim();
        at++;
        if (rest === "") {
          const next = lines[at];
          list.push(next && next.indent > indent ? block(next.indent) : null);
        } else {
          list.push(flow(rest));
        }
      }
      return list;
    }
    const map: YamlMap = {};
    while (at < lines.length && lines[at]?.indent === indent) {
      const line = lines[at];
      if (!line) break;
      const end = keyEnd(line.text);
      if (end < 0) throw new PackageError(`Can't read "${line.text}" in a YAML file.`);
      const key = String(scalar(line.text.slice(0, end)));
      const rest = line.text.slice(end + 1).trim();
      at++;
      if (rest === "|" || rest === ">") map[key] = blockScalar(indent, rest === ">");
      else if (rest !== "") map[key] = flow(rest);
      else {
        const next = lines[at];
        map[key] = next && next.indent > indent ? block(next.indent) : null;
      }
    }
    return map;
  }

  const first = lines[0];
  return block(first?.indent ?? 0);
}

function isMap(value: YamlValue | undefined): value is YamlMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: YamlValue | undefined): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

function asNumber(value: YamlValue | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function yamlText(value: string): string {
  return /^[A-Za-z][\w .-]*$/.test(value) && !/^(true|false|null|~)$/.test(value)
    ? value
    : JSON.stringify(value);
}

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  java: "java",
  kt: "kotlin",
  py: "python",
  js: "javascript",
  rs: "rust",
  go: "go",
};

const EXTENSION_BY_LANGUAGE: Readonly<Record<string, string>> = {
  c: "c",
  cpp: "cpp",
  java: "java",
  kotlin: "kt",
  python: "py",
  javascript: "js",
  rust: "rs",
  go: "go",
};

export function languageForFile(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  return LANGUAGE_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null;
}

export function extensionFor(language: string): string {
  return EXTENSION_BY_LANGUAGE[language] ?? "txt";
}

const SUBMISSION_DIRS: Readonly<Record<string, Verdict>> = {
  accepted: "AC",
  wrong_answer: "WA",
  time_limit_exceeded: "TLE",
  run_time_error: "RE",
};

const DIR_BY_VERDICT: Readonly<Partial<Record<Verdict, string>>> = {
  AC: "accepted",
  WA: "wrong_answer",
  TLE: "time_limit_exceeded",
  RE: "run_time_error",
};

const NAME_OK = /^[\w][\w .()-]{0,99}$/;

export function safeFileName(name: string, taken: ReadonlySet<string>): string {
  const base = name.split("/").pop() ?? name;
  let clean = base.replace(/[^\w .()-]/g, "_").replace(/^[^\w]+/, "_");
  clean = clean.slice(-100) || "file";
  if (!NAME_OK.test(clean)) clean = "file";
  if (!taken.has(clean)) return clean;
  const dot = clean.lastIndexOf(".");
  const stem = dot > 0 ? clean.slice(0, dot) : clean;
  const ext = dot > 0 ? clean.slice(dot) : "";
  for (let n = 2; ; n++) {
    const candidate = `${stem.slice(0, 95 - String(n).length)}-${n}${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}

const natural = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  let entries = 0;
  let total = 0;
  try {
    return unzipSync(bytes, {
      filter(file) {
        if (file.name.endsWith("/")) return false;
        entries++;
        if (entries > PACKAGE_LIMITS.entries) {
          throw new PackageError(`The package has more than ${PACKAGE_LIMITS.entries} files.`);
        }
        if (file.originalSize > PACKAGE_LIMITS.fileBytes) {
          throw new PackageError(`"${file.name}" is larger than 16 MB.`);
        }
        total += file.originalSize;
        if (total > PACKAGE_LIMITS.totalBytes) {
          throw new PackageError("The package is larger than 128 MB unpacked.");
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof PackageError) throw error;
    throw new PackageError("That isn't a readable ZIP file.");
  }
}

function groupRule(map: YamlMap | null, inherited: GroupRule): GroupRule {
  if (!map) return inherited;
  const scoring = isMap(map.scoring) ? map.scoring : null;
  const aggregation = asString(scoring?.aggregation);
  const onReject = asString(map.on_reject);
  return {
    aggregation:
      aggregation === "min" ? "min" : aggregation === "sum" ? "sum" : inherited.aggregation,
    stopOnFail:
      onReject === "break" ? true : onReject === "continue" ? false : inherited.stopOnFail,
  };
}

function groupScore(map: YamlMap | null): number | null {
  const scoring = map && isMap(map.scoring) ? map.scoring : null;
  return asNumber(scoring?.score);
}

export function readPackage(bytes: Uint8Array): ParsedPackage {
  const warnings: string[] = [];
  const all = unzip(bytes);
  const names = Object.keys(all).filter(
    (name) =>
      !name.startsWith("__MACOSX/") && !name.split("/").some((part) => part.startsWith(".")),
  );
  const yamlName = names
    .filter((name) => name === "problem.yaml" || name.endsWith("/problem.yaml"))
    .sort((a, b) => a.split("/").length - b.split("/").length)[0];
  if (!yamlName) throw new PackageError("There is no problem.yaml in that ZIP file.");
  const root = yamlName.slice(0, yamlName.length - "problem.yaml".length);
  const files = new Map<string, Uint8Array>();
  for (const name of names) {
    const bytesOf = all[name];
    if (name.startsWith(root) && bytesOf) files.set(name.slice(root.length), bytesOf);
  }
  const text = (path: string): string | null => {
    const found = files.get(path);
    return found ? strFromU8(found) : null;
  };
  const yamlAt = (path: string): YamlMap | null => {
    const source = text(path);
    if (source === null) return null;
    const value = parseYaml(source);
    return isMap(value) ? value : null;
  };

  const meta = yamlAt("problem.yaml") ?? {};
  // `type: scoring` (or a list naming it) marks a problem scored by test groups
  const typeValue = meta.type;
  const types = (Array.isArray(typeValue) ? typeValue : [typeValue]).flatMap((each) => {
    const text = asString(each);
    return text ? text.split(/\s+/) : [];
  });
  const scoring = types.length === 0 ? undefined : types.includes("scoring");

  const nameValue = meta.name;
  const name =
    asString(nameValue) ??
    (isMap(nameValue) ? (asString(nameValue.en) ?? asString(Object.values(nameValue)[0])) : null) ??
    root.replace(/\/$/, "").split("/").pop() ??
    "";
  const title = name.trim() === "" ? "Imported problem" : name.trim().slice(0, 120);

  const limits = isMap(meta.limits) ? meta.limits : {};
  const clamp = (value: number, low: number, high: number, what: string): number => {
    const rounded = Math.round(value);
    if (rounded < low || rounded > high) {
      warnings.push(`The ${what} was changed to fit ${low} to ${high}.`);
    }
    return Math.min(high, Math.max(low, rounded));
  };
  const seconds = asNumber(limits.time_limit) ?? asNumber(limits.time);
  const memory = asNumber(limits.memory);
  const output = asNumber(limits.output);
  const timeLimitMs = seconds === null ? 2000 : clamp(seconds * 1000, 100, 60000, "time limit");
  const memoryLimitMb = memory === null ? 256 : clamp(memory, 16, 4096, "memory limit");
  const outputLimitKb = output === null ? 8192 : clamp(output * 1024, 1, 65536, "output limit");

  const validationWords = (asString(meta.validation) ?? "default").split(/\s+/).filter(Boolean);
  const flagWords = [
    validationWords.join(" "),
    asString(meta.validator_flags),
    asString(meta.output_validator_flags),
    asString(yamlAt("data/testdata.yaml")?.output_validator_flags),
  ]
    .flatMap((flags) => (flags ?? "").split(/\s+/))
    .filter(Boolean);
  if (validationWords.includes("interactive")) {
    throw new PackageError("Interactive problems can't be judged here.");
  }
  let checker: PackageChecker = "tokens";
  let tolerance: number | null = null;
  let validator: ProblemPackage["validator"] = null;
  if (validationWords.includes("custom")) {
    const sources = [...files.keys()].filter(
      (path) => path.startsWith("output_validators/") && path.split("/").length >= 3,
    );
    const validatorDirs = new Set(sources.map((path) => path.split("/")[1]));
    if (sources.length !== 1) {
      throw new PackageError(
        validatorDirs.size > 1 || sources.length > 1
          ? "The custom checker has more than one file. Only a single-file checker can be used."
          : "The package asks for a custom checker but has no output_validators.",
      );
    }
    const path = sources[0] ?? "";
    const language = languageForFile(path);
    if (!language)
      throw new PackageError(`The checker "${path}" is in a language that isn't supported.`);
    const source = text(path) ?? "";
    if (/#include\s+"/.test(source)) {
      warnings.push(
        "The checker includes a local header the package can't supply; it may not compile.",
      );
    }
    checker = "custom";
    validator = { language, filename: path.split("/").pop() ?? path, source };
  } else {
    const flagIndex = flagWords.findIndex((word) =>
      /^float_(absolute_|relative_)?tolerance$/.test(word),
    );
    if (flagIndex >= 0) {
      const value = Number(flagWords[flagIndex + 1]);
      if (Number.isFinite(value) && value > 0) {
        checker = "float";
        tolerance = value;
      }
    } else if (flagWords.includes("space_change_sensitive")) {
      checker = "exact";
    }
  }

  const topData = yamlAt("data/secret/testdata.yaml") ?? yamlAt("data/testdata.yaml");
  const defaultRule: GroupRule = { aggregation: "sum", stopOnFail: false };
  const baseRule = groupRule(topData, defaultRule);
  const stems = new Map<
    string,
    { input?: string; answer?: string; sample: boolean; group: string | null }
  >();
  for (const [path] of files) {
    const sample = path.startsWith("data/sample/");
    if (!sample && !path.startsWith("data/secret/")) continue;
    const match = /\.(in|ans)$/.exec(path);
    if (!match) continue;
    const stem = path.slice(0, path.length - match[0].length);
    const below = path.slice(sample ? "data/sample/".length : "data/secret/".length).split("/");
    const group = !sample && below.length > 1 ? (below[0] ?? null) : null;
    const entry = stems.get(stem) ?? { sample, group };
    const content = text(path) ?? "";
    if (match[1] === "in") entry.input = content;
    else entry.answer = content;
    stems.set(stem, entry);
  }
  const ordered = [...stems.entries()].sort(([a, one], [b, two]) =>
    one.sample === two.sample ? natural(a, b) : one.sample ? -1 : 1,
  );
  const rawTests: Array<{
    isSample: boolean;
    groupKey: string | null;
    input: string;
    answer: string;
  }> = [];
  for (const [stem, entry] of ordered) {
    if (entry.input === undefined || entry.answer === undefined) {
      warnings.push(
        `"${stem}" has no ${entry.input === undefined ? ".in" : ".ans"} file and was skipped.`,
      );
      continue;
    }
    rawTests.push({
      isSample: entry.sample,
      groupKey: entry.group,
      input: entry.input,
      answer: entry.answer,
    });
  }
  if (rawTests.length === 0) throw new PackageError("The package has no test data.");

  const groups: Record<string, GroupRule> = {};
  const scores = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const test of rawTests) {
    if (test.groupKey) counts.set(test.groupKey, (counts.get(test.groupKey) ?? 0) + 1);
  }
  for (const key of counts.keys()) {
    const own = yamlAt(`data/secret/${key}/testdata.yaml`);
    groups[key] = groupRule(own, baseRule);
    const score = groupScore(own);
    if (score !== null) scores.set(key, score);
  }
  const tests: PackageTest[] = rawTests.map((test) => {
    const key = test.groupKey;
    const score = key ? scores.get(key) : undefined;
    const rule = key ? groups[key] : undefined;
    let points: number | null = null;
    if (key && score !== undefined && rule) {
      points =
        rule.aggregation === "min"
          ? score
          : Math.round((score / (counts.get(key) ?? 1)) * 100) / 100;
    }
    return { ...test, points };
  });
  const total = [...scores.values()].reduce((sum, value) => sum + value, 0);
  const points = scores.size > 0 && total > 0 && total <= 999999 ? total : null;

  const attachments: PackageFile[] = [];
  const taken = new Set<string>();
  const attach = (path: string): string | null => {
    const content = files.get(path);
    if (!content) return null;
    const fileName = safeFileName(path, taken);
    taken.add(fileName);
    attachments.push({ name: fileName, bytes: content });
    return fileName;
  };
  const statementDirs = ["statement/", "problem_statement/"];
  const inStatement = [...files.keys()].filter((path) =>
    statementDirs.some((dir) => path.startsWith(dir)),
  );
  const markdown =
    inStatement.find((path) => /\/problem\.en\.md$/.test(path)) ??
    inStatement.find((path) => /\/problem(\.[a-z-]+)?\.md$/.test(path));
  let statementMd = "";
  if (markdown) {
    statementMd = text(markdown) ?? "";
  } else {
    const pdf =
      inStatement.find((path) => /\/problem\.en\.pdf$/.test(path)) ??
      inStatement.find((path) => /\/problem(\.[a-z-]+)?\.pdf$/.test(path));
    const tex = inStatement.find((path) => /\/problem(\.[a-z-]+)?\.tex$/.test(path));
    const source = pdf ?? tex;
    if (source) {
      const attached = attach(source);
      statementMd = `The statement is in the attached file${attached ? ` "${attached}"` : ""}.`;
      warnings.push(
        pdf
          ? "The statement is only a PDF, so it is attached and the statement text is a placeholder."
          : "The statement is only LaTeX, so it is attached and the statement text is a placeholder.",
      );
    } else {
      warnings.push("The package has no statement.");
    }
  }
  for (const path of inStatement) {
    if (/\/problem(\.[a-z-]+)?\.(md|pdf|tex)$/.test(path)) continue;
    attach(path);
  }
  for (const path of [...files.keys()].sort(natural)) {
    if (path.startsWith("attachments/")) attach(path);
  }

  const solutions: PackageSolution[] = [];
  let skippedSolutions = 0;
  for (const path of [...files.keys()].sort(natural)) {
    const parts = path.split("/");
    if (parts[0] !== "submissions" || parts.length < 3) continue;
    const expected = SUBMISSION_DIRS[parts[1] ?? ""];
    if (!expected) continue;
    if (parts.length > 3) {
      skippedSolutions++;
      continue;
    }
    const language = languageForFile(path);
    const content = files.get(path);
    if (!language || !content || content.length > PACKAGE_LIMITS.solutionBytes) {
      skippedSolutions++;
      continue;
    }
    if (solutions.length >= PACKAGE_LIMITS.solutions) {
      skippedSolutions++;
      continue;
    }
    solutions.push({
      label: (parts[2] ?? "").slice(0, 60),
      language,
      source: strFromU8(content),
      expected,
    });
  }
  if (skippedSolutions > 0) {
    warnings.push(
      `${skippedSolutions} jury solution${skippedSolutions === 1 ? " was" : "s were"} skipped (unknown language, several files, too large or over ${PACKAGE_LIMITS.solutions}).`,
    );
  }

  return {
    name: title,
    timeLimitMs,
    memoryLimitMb,
    outputLimitKb,
    checker,
    tolerance,
    validator,
    statementMd,
    tests,
    groups,
    attachments,
    solutions,
    ...(scoring === undefined ? {} : { scoring }),
    points,
    warnings,
  };
}

function yamlGroup(tests: Tuple<PackageTest>, rule: GroupRule): string {
  const given = tests.map((test) => test.points).filter((value): value is number => value !== null);
  const lines: string[] = [];
  if (given.length > 0) {
    const score =
      rule.aggregation === "min"
        ? Math.max(...given)
        : Math.round(given.reduce((sum, value) => sum + value, 0) * 100) / 100;
    lines.push("scoring:", `  score: ${score}`, `  aggregation: ${rule.aggregation}`);
  } else {
    lines.push(`scoring:`, `  aggregation: ${rule.aggregation}`);
  }
  lines.push(`on_reject: ${rule.stopOnFail ? "break" : "continue"}`);
  return `${lines.join("\n")}\n`;
}

export function writePackage(problem: ProblemPackage): Uint8Array {
  const out: Zippable = {};
  const put = (path: string, content: string | Uint8Array) => {
    out[path] = typeof content === "string" ? strToU8(content) : content;
  };

  const validation: string[] = [];
  if (problem.checker === "custom") validation.push("custom");
  else if (problem.checker === "exact") validation.push("default", "space_change_sensitive");
  else validation.push("default");
  const yaml = [
    `name: ${yamlText(problem.name)}`,
    ...(problem.scoring ? ["type: scoring"] : []),
    `validation: ${validation.join(" ")}`,
    "limits:",
    `  time_limit: ${problem.timeLimitMs / 1000}`,
    `  memory: ${problem.memoryLimitMb}`,
    `  output: ${Math.max(1, Math.round(problem.outputLimitKb / 1024))}`,
  ];
  if (problem.checker === "float" && problem.tolerance !== null) {
    yaml.push(`validator_flags: ${JSON.stringify(`float_tolerance ${problem.tolerance}`)}`);
  }
  put("problem.yaml", `${yaml.join("\n")}\n`);

  const samples = problem.tests.filter((test) => test.isSample);
  samples.forEach((test, index) => {
    const stem = String(index + 1).padStart(2, "0");
    put(`data/sample/${stem}.in`, test.input);
    put(`data/sample/${stem}.ans`, test.answer);
  });

  const secret = problem.tests.filter((test) => !test.isSample);
  const byGroup = new Map<string | null, PackageTest[]>();
  for (const test of secret) {
    byGroup.set(test.groupKey, [...(byGroup.get(test.groupKey) ?? []), test]);
  }
  let number = 0;
  for (const [key, group] of byGroup) {
    for (const test of group) {
      number++;
      const stem = String(number).padStart(3, "0");
      const dir = key ? `data/secret/${key}/` : "data/secret/";
      put(`${dir}${stem}.in`, test.input);
      put(`${dir}${stem}.ans`, test.answer);
    }
    const rule = key ? problem.groups[key] : undefined;
    if (key && rule) put(`data/secret/${key}/testdata.yaml`, yamlGroup(group, rule));
  }

  if (problem.statementMd !== "") put("statement/problem.en.md", problem.statementMd);
  for (const file of problem.attachments) put(`attachments/${file.name}`, file.bytes);
  if (problem.validator) {
    put(`output_validators/checker/${problem.validator.filename}`, problem.validator.source);
  }

  const used = new Set<string>();
  for (const solution of problem.solutions) {
    const dir = DIR_BY_VERDICT[solution.expected];
    const ext = EXTENSION_BY_LANGUAGE[solution.language];
    if (!dir || !ext) continue;
    const stem = solution.label.replace(/[^\w-]/g, "_").slice(0, 40) || "solution";
    let path = `submissions/${dir}/${stem}.${ext}`;
    for (let n = 2; used.has(path); n++) path = `submissions/${dir}/${stem}-${n}.${ext}`;
    used.add(path);
    put(path, solution.source);
  }

  return zipSync(out);
}
