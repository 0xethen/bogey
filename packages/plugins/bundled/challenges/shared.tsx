import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLiveBroadcast, useLiveInvalidate } from "@bogey/db/realtime";
import { IconLoader2 } from "@tabler/icons-react";
import { eventWindowsQueryOptions, isWindowOpen, windowByKey } from "@bogey/db/queries/windows";
import { createPluginNav } from "@bogey/plugins/nav";
import { createPluginSignals } from "@bogey/plugins/signals";
import { pluginWindow } from "@bogey/plugins/api";
import type { SettingsOf } from "@bogey/plugins/types";
import { Badge } from "@bogey/ui/components/badge";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@bogey/ui/components/code-block";
import { EDITOR_LANGUAGES, type EditorLanguage } from "@bogey/ui/components/code-editor";
import { cn } from "@bogey/ui/lib/utils";
import {
  difficultiesQueryOptions,
  problemsQueryOptions,
  type Attempt,
  type Difficulty,
  type DifficultyTone,
  type Language,
  type Problem,
  type ProblemKind,
  type Verdict,
} from "./db.ts";
import { manifest } from "./manifest.ts";
import { useChallenges } from "./context.tsx";

export type Settings = SettingsOf<typeof manifest>;

export const { Link, useGoTo, useHref } = createPluginNav(manifest);

export const signals = createPluginSignals(manifest);

export const CONTEST = pluginWindow(manifest, "contest");

// setTimeout takes at most a 32-bit number of milliseconds
const LONGEST_TIMEOUT = 2 ** 31 - 1;

export function useContest(eventId: string) {
  const windows = useQuery(eventWindowsQueryOptions(eventId));
  const window = windowByKey(windows.data ?? [], CONTEST);
  // an organizer opening or closing it by hand reaches the page at once
  useLiveInvalidate("event_windows", eventWindowsQueryOptions(eventId).queryKey, {
    filter: `event_id=eq.${eventId}`,
  });
  // and so does it opening or closing on time
  const [now, setNow] = useState(() => Date.now());
  const next = [window?.opens_at, window?.closes_at]
    .map((at) => (at ? new Date(at).getTime() : null))
    .filter((at): at is number => at !== null && at > now)
    .sort((a, b) => a - b)[0];
  useEffect(() => {
    if (next === undefined) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(next - Date.now() + 250, LONGEST_TIMEOUT),
    );
    return () => clearTimeout(timer);
  }, [next]);
  return { loaded: windows.isSuccess, window, running: isWindowOpen(window, new Date(now)) };
}

/**
 * Keeps the contest's pages current: any verdict or problem change in the event reads the
 * scoreboard and problems again, and the team's own solutions come through as they're judged.
 */
export function useLiveContest(eventId: string) {
  const topic = `challenges:${eventId}`;
  useLiveBroadcast(topic, ["challenges", "scoreboard", eventId]);
  useLiveBroadcast(topic, problemsQueryOptions(eventId).queryKey);
  useLiveBroadcast(topic, ["challenges", "jury-solutions", eventId]);
  useLiveInvalidate("challenges_judgings", ["challenges", "attempts", eventId], {
    filter: `event_id=eq.${eventId}`,
  });
}

export const VERDICTS: Record<Verdict, string> = {
  AC: "Accepted",
  WA: "Wrong answer",
  TLE: "Time limit",
  MLE: "Memory limit",
  RE: "Runtime error",
  CE: "Compile error",
  OLE: "Too much output",
  JE: "Judge error",
};

export function VerdictBadge({ attempt }: { attempt: Pick<Attempt, "status" | "verdict"> }) {
  if (!attempt.verdict) {
    return (
      <Badge variant="secondary">
        <IconLoader2 className="animate-spin" />
        {attempt.status === "running" ? "Judging" : "Waiting"}
      </Badge>
    );
  }
  return <TestVerdict verdict={attempt.verdict} />;
}

/** Program text: a sample, a test's input or output, compiler errors. */
export function OutputBlock({
  title,
  text,
  variant,
  className,
  contentClassName,
  emptyText,
}: {
  title?: string;
  text: string;
  variant?: "default" | "destructive";
  className?: string;
  contentClassName?: string;
  emptyText?: string;
}) {
  const copy = text && <CodeBlockCopyButton value={text} />;
  return (
    <CodeBlock size="sm" variant={variant} className={cn(className)}>
      {title ? (
        <CodeBlockHeader>
          <CodeBlockTitle>{title}</CodeBlockTitle>
          <CodeBlockActions>{copy}</CodeBlockActions>
        </CodeBlockHeader>
      ) : (
        copy && <CodeBlockActions>{copy}</CodeBlockActions>
      )}
      <CodeBlockContent wrap className={cn("max-h-48", contentClassName)}>
        {text || <span className="text-muted-fg">{emptyText ?? "(empty)"}</span>}
      </CodeBlockContent>
    </CodeBlock>
  );
}

export function TestVerdict({ verdict }: { verdict: Verdict }) {
  return <Badge variant={verdict === "AC" ? "default" : "destructive"}>{VERDICTS[verdict]}</Badge>;
}

export const TONE_CLASS: Record<DifficultyTone, string> = {
  gray: "bg-muted text-muted-fg",
  green: "bg-green-500/12 text-green-700 dark:text-green-300",
  amber: "bg-amber-500/14 text-amber-700 dark:text-amber-300",
  red: "bg-red-500/12 text-red-700 dark:text-red-300",
  blue: "bg-blue-500/12 text-blue-700 dark:text-blue-300",
  violet: "bg-violet-500/12 text-violet-700 dark:text-violet-300",
  pink: "bg-pink-500/12 text-pink-700 dark:text-pink-300",
  teal: "bg-teal-500/12 text-teal-700 dark:text-teal-300",
  orange: "bg-orange-500/12 text-orange-700 dark:text-orange-300",
};

export function useDifficulties(eventId: string) {
  const difficulties = useQuery(difficultiesQueryOptions(eventId));
  return difficulties.data ?? [];
}

export function DifficultyBadge({ difficulty }: { difficulty: Difficulty | null }) {
  const { eventId } = useChallenges();
  const difficulties = useDifficulties(eventId);
  const found = difficulty ? difficulties.find((each) => each.key === difficulty) : undefined;
  if (!found) return null;
  return <Badge className={cn(TONE_CLASS[found.tone])}>{found.label}</Badge>;
}

export type IdKind = Settings["idKind"];

export const ID_KINDS: Record<
  IdKind,
  { label: string; placeholder: string; pattern: RegExp; rule: string }
> = {
  letter: {
    label: "Letter-based",
    placeholder: "A, D1, Z999",
    pattern: /^[A-Z][A-Z0-9]{0,3}$/,
    rule: "A capital letter, then up to 3 more letters or digits",
  },
  number: {
    label: "Number-based",
    placeholder: "1, 42, 999999",
    pattern: /^[0-9]{1,6}$/,
    rule: "A whole number, up to 6 digits",
  },
  custom: {
    label: "Custom",
    placeholder: "Warm-up",
    pattern: /^\S(.{0,14}\S)?$/,
    rule: "1 to 16 characters, without spaces at the ends",
  },
};

export function idProblem(kind: IdKind, value: string): string | undefined {
  const id = value.trim();
  if (!id) return "Give it an ID";
  return ID_KINDS[kind].pattern.test(id) ? undefined : ID_KINDS[kind].rule;
}

export function nextId(kind: IdKind, problems: Tuple<Pick<Problem, "label">>): string {
  const taken = new Set(problems.map((problem) => problem.label));
  if (kind === "letter") {
    for (let code = 65; code <= 90; code++) {
      const letter = String.fromCharCode(code);
      if (!taken.has(letter)) return letter;
    }
    return "";
  }
  if (kind === "number") {
    const biggest = problems.reduce((most, problem) => {
      const value = Number(problem.label);
      return Number.isInteger(value) ? Math.max(most, value) : most;
    }, 0);
    return String(biggest + 1);
  }
  return "";
}

export function compareIds(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export function orderProblems<T extends Pick<Problem, "label" | "sort">>(
  problems: Tuple<T>,
  order: Settings["problemOrder"],
): T[] {
  return problems.toSorted(
    (a, b) => (order === "custom" ? a.sort - b.sort : 0) || compareIds(a.label, b.label),
  );
}

export function useProblems(eventId: string, order: Settings["problemOrder"]) {
  return useQuery({
    ...problemsQueryOptions(eventId),
    select: (rows) => orderProblems(rows, order),
  });
}

export const PROBLEM_KIND: Record<ProblemKind, { label: string; description: string }> = {
  pass_fail: {
    label: "Pass/fail",
    description: "Solved when every test passes.",
  },
  partial: {
    label: "Partial credit",
    description: "Each test or group of tests that passes adds its points.",
  },
  shortest: {
    label: "Shortest code",
    description: "Solved solutions compete with their length: the shorter, the better.",
  },
};

// the type a new problem starts with, from how the contest ranks
export const KIND_FOR_SCORING: Record<Settings["scoring"], ProblemKind> = {
  icpc: "pass_fail",
  ioi: "partial",
  golf: "shortest",
};

// the contest's "Type of new problems" setting, or what its style suggests
export function defaultKind(settings: Pick<Settings, "scoring" | "defaultKind">): ProblemKind {
  return settings.defaultKind === "style"
    ? KIND_FOR_SCORING[settings.scoring]
    : settings.defaultKind;
}

export function ProblemKindBadge({ kind }: { kind: ProblemKind }) {
  return (
    <Badge variant="outline" title={PROBLEM_KIND[kind].description}>
      {PROBLEM_KIND[kind].label}
    </Badge>
  );
}

export const MEASURE_NOUN: Record<Settings["golfMeasure"], string> = {
  characters: "characters",
  bytes: "bytes",
  "characters-no-space": "characters without spaces",
};

export function golfLength(source: string, measure: Settings["golfMeasure"]): number {
  if (measure === "bytes") return new TextEncoder().encode(source).length;
  if (measure === "characters-no-space") return [...source.replace(/\s/g, "")].length;
  return [...source].length;
}

export function attemptLength(
  attempt: Pick<Attempt, "chars" | "bytes" | "charsNoSpace">,
  measure: Settings["golfMeasure"],
): number {
  if (measure === "bytes") return attempt.bytes;
  if (measure === "characters-no-space") return attempt.charsNoSpace;
  return attempt.chars;
}

export function points(value: number): string {
  const whole = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return `${whole} ${value === 1 ? "point" : "points"}`;
}

export function editorLanguage(
  language: Pick<Language, "editor_mode"> | undefined,
): EditorLanguage {
  return EDITOR_LANGUAGES.find((each) => each === language?.editor_mode) ?? "python";
}

export function allowedLanguages(languages: Tuple<Language>, setting: string): Language[] {
  const keys = setting
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  return keys.length ? languages.filter((language) => keys.includes(language.key)) : [...languages];
}

function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

// `/jury/two-sum/tests`: the splat's first segment names the problem
export function problemSlug(splat: string): string {
  return decoded(splat.split("/")[0] ?? "");
}

// and the second one the page's tab
export function splatTab(splat: string): string {
  return decoded(splat.split("/")[1] ?? "");
}

export const topics = {
  problem: (id: string) => `challenges.problem:${id}`,
  solution: (id: string) => `challenges.solution:${id}`,
  parse(topic: string): { kind: "problem" | "solution"; id: string } | null {
    const match = /^challenges\.(problem|solution):([0-9a-f-]{36})$/.exec(topic);
    if (!match?.[1] || !match[2]) return null;
    return { kind: match[1] === "problem" ? "problem" : "solution", id: match[2] };
  },
};

/** Where a team stands on a problem, as the scoreboard and Submissions grid color it. */
export type CellState = "first" | "solved" | "tried" | "pending" | "untried";

const CELL_TONES: Record<Settings["verdictColors"], Record<CellState, string>> = {
  theme: {
    first: "bg-primary text-primary-fg ring-2 ring-primary/35 ring-offset-1 ring-offset-background",
    solved: "bg-primary text-primary-fg",
    tried: "bg-muted text-muted-fg",
    pending: "bg-primary/15 text-primary-text",
    untried: "border border-dashed border-border text-muted-fg",
  },
  traffic: {
    first: "bg-green-700 text-white ring-2 ring-green-600/35 ring-offset-1 ring-offset-background",
    solved: "bg-green-600 text-white",
    tried: "bg-red-500/85 text-white",
    pending: "bg-amber-400/80 text-amber-950",
    untried: "border border-dashed border-border text-muted-fg",
  },
};

export const CELL_LABEL: Record<CellState, string> = {
  first: "Solved first",
  solved: "Solved",
  tried: "Not solved", // Tried
  pending: "Being judged",
  untried: "Not attempted",
};

export function cellTone(colors: Settings["verdictColors"], state: CellState): string {
  return CELL_TONES[colors][state];
}

/** The key under a grid: a small square in each state's color, and what it means. */
export function CellLegend({
  colors,
  states,
}: {
  colors: Settings["verdictColors"];
  states: Tuple<CellState>;
}) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-fg">
      {states.map((state) => (
        <li key={state} className="flex items-center gap-1.5">
          <span aria-hidden className={cn("size-3 rounded-[2px]", cellTone(colors, state))} />
          {CELL_LABEL[state]}
        </li>
      ))}
    </ul>
  );
}
