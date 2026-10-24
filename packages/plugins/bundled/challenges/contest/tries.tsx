import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useEventAccess } from "@bogey/db/permissions";
import type { PluginRouteContext } from "@bogey/plugins/runtime";
import { Button } from "@bogey/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@bogey/ui/components/collapsible";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { RelativeTime } from "@bogey/ui/components/relative-time";
import { Screen } from "@bogey/ui/components/screen";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { Skeleton } from "@bogey/ui/components/skeleton";
import { cn } from "@bogey/ui/lib/utils";
import { AskAbout } from "./ask.tsx";
import { useChallenges } from "../context.tsx";
import { TestResults } from "./results.tsx";
import { recentAttemptsQueryOptions, type Attempt, type Problem } from "../db.ts";
import {
  attemptLength,
  CELL_LABEL,
  CellLegend,
  cellTone,
  Link,
  MEASURE_NOUN,
  OutputBlock,
  problemSlug,
  signals,
  topics,
  useLiveContest,
  useProblems,
  VerdictBadge,
  type CellState,
  type Settings,
} from "../shared.tsx";

type TryProblem = Pick<Problem, "label" | "title" | "kind">;

export function isJudging(attempt: Pick<Attempt, "status">): boolean {
  return attempt.status === "queued" || attempt.status === "running";
}

// polls while one is unjudged, and stops once caught up
export const untilJudged = (data: Tuple<Attempt> | undefined) =>
  data?.some((attempt) => !attempt.verdict) ? 5_000 : false;

export function useVerdictSignals(
  eventId: string,
  attempts: Tuple<{ id: string; verdict: string | null }> | undefined,
) {
  const judged = useRef<Map<string, boolean> | null>(null);
  useEffect(() => {
    if (!attempts) return;
    const before = judged.current;
    judged.current = new Map(attempts.map((attempt) => [attempt.id, attempt.verdict !== null]));
    if (!before) return;
    for (const attempt of attempts) {
      if (attempt.verdict === null || before.get(attempt.id) === true) continue;
      if (attempt.verdict === "JE") continue;
      signals.emit(attempt.verdict === "AC" ? "accepted" : "rejected", eventId);
    }
  }, [attempts, eventId]);
}

function TrySummary({ attempt, problem }: { attempt: Attempt; problem: TryProblem | undefined }) {
  const { settings } = useChallenges();
  return (
    <>
      <span className="text-muted-fg">
        <RelativeTime value={attempt.submittedAt} /> · {attempt.language}
        {attempt.timeMs !== null && ` · ${attempt.timeMs} ms`}
        {problem?.kind === "shortest" &&
          ` · ${attemptLength(attempt, settings.golfMeasure)} ${MEASURE_NOUN[settings.golfMeasure]}`}
      </span>
      <span className="ml-auto">
        <VerdictBadge attempt={attempt} />
      </span>
    </>
  );
}

function TryDetail({ attempt, problem }: { attempt: Attempt; problem: TryProblem | undefined }) {
  const { settings } = useChallenges();
  return (
    <div className="flex flex-col gap-3">
      {attempt.verdict === "CE" &&
        attempt.compileOutput &&
        (settings.showErrors ? (
          <OutputBlock title="Compiler output" text={attempt.compileOutput} variant="destructive" />
        ) : (
          <p className="text-sm text-muted-fg">
            It didn't compile. This contest doesn't show error messages.
          </p>
        ))}
      <TestResults solutionId={attempt.id} judged={attempt.verdict !== null} />
      <div>
        <AskAbout
          topic={topics.solution(attempt.id)}
          subject={problem ? `${problem.label}. ${problem.title}: a try` : "A try"}
          label="Ask about this try..."
        />
      </div>
    </div>
  );
}

/** A problem's newest try; every try is on the Submissions page. */
export function LatestTry({
  problem,
  attempts,
  loading,
}: {
  problem: Problem;
  attempts: Tuple<Attempt>;
  loading: boolean;
}) {
  if (loading) return <Skeleton className="h-16 w-full" />;
  const latest = attempts[0];
  if (!latest) return null;
  return (
    <Screen.Section
      title="Your latest try"
      actions={
        <Button
          size="sm"
          variant="ghost"
          render={<Link to="/submissions" splat={latest.id} />}
          nativeButton={false}
        >
          {attempts.length > 1 ? `View all ${attempts.length}` : "Submissions"}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 border-y border-border py-3">
        <p className="flex items-center gap-3 text-sm">
          <TrySummary attempt={latest} problem={problem} />
        </p>
        <TryDetail attempt={latest} problem={problem} />
      </div>
    </Screen.Section>
  );
}

type Sort = "newest" | "oldest" | "problem" | "verdict";
type Shown = "all" | "accepted" | "rejected" | "pending";

const SORTS: Tuple<{ value: Sort; label: string }> = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "problem", label: "By problem" },
  { value: "verdict", label: "By verdict" },
];

const SHOWN: Tuple<{ value: Shown; label: string }> = [
  { value: "all", label: "Every verdict" },
  { value: "accepted", label: "Accepted" },
  { value: "rejected", label: "Rejected" },
  { value: "pending", label: "Being judged" },
];

const ALL = "all";

function shows(attempt: Attempt, shown: Shown): boolean {
  if (shown === "all") return true;
  if (shown === "pending") return attempt.verdict === null;
  if (shown === "accepted") return attempt.verdict === "AC";
  return attempt.verdict !== null && attempt.verdict !== "AC";
}

function problemState(attempts: Tuple<Attempt>): CellState {
  if (attempts.some((attempt) => attempt.verdict === "AC")) return "solved";
  if (attempts.some((attempt) => attempt.verdict === null)) return "pending";
  return attempts.length > 0 ? "tried" : "untried";
}

/** One square per problem, colored by where the team stands on it; picking one shows only its tries. */
function ProblemGrid({
  problems,
  attempts,
  settings,
  picked,
  onPick,
}: {
  problems: Tuple<Problem>;
  attempts: Tuple<Attempt>;
  settings: Settings;
  picked: string;
  onPick: (problemId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-2">
        {problems.map((problem) => {
          const tries = attempts.filter((attempt) => attempt.problemId === problem.id);
          const state = problemState(tries);
          const active = picked === problem.id;
          return (
            <li key={problem.id}>
              <button
                type="button"
                aria-pressed={active}
                title={`${problem.label}. ${problem.title}: ${CELL_LABEL[state].toLowerCase()}`}
                onClick={() => onPick(active ? ALL : problem.id)}
                className={cn(
                  "flex size-14 flex-col items-center justify-center rounded-lg font-mono tabular-nums transition-[box-shadow,opacity] outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  cellTone(settings.verdictColors, state),
                  picked !== ALL && !active && "opacity-50",
                  active && "ring-2 ring-fg ring-offset-2 ring-offset-background",
                )}
              >
                <span className="text-sm font-semibold">{problem.label}</span>
                <span className="text-[0.7rem] opacity-80">
                  {tries.length === 0
                    ? "–"
                    : tries.length === 1
                      ? "1 try"
                      : `${tries.length} tries`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <CellLegend
        colors={settings.verdictColors}
        states={["solved", "tried", "pending", "untried"]}
      />
    </div>
  );
}

/** Every solution the team has sent, opened at the one in the address (or the newest). */
export function Submissions({ eventId, settings, splat }: PluginRouteContext<Settings>) {
  const access = useEventAccess();
  const competing = access?.role === "participant";
  const problems = useProblems(eventId, settings.problemOrder);
  const tries = useQuery({
    ...recentAttemptsQueryOptions(eventId),
    enabled: competing,
    // verdicts arrive live; this is the fallback while one is still out
    refetchInterval: (query) => untilJudged(query.state.data),
  });
  useLiveContest(eventId);
  useVerdictSignals(eventId, tries.data);
  const [problemId, setProblemId] = useState<string>(ALL);
  const [shown, setShown] = useState<Shown>("all");
  const [sort, setSort] = useState<Sort>("newest");
  const problemList = problems.data ?? [];
  const byId = new Map(problemList.map((problem) => [problem.id, problem]));
  const order = new Map(problemList.map((problem, index) => [problem.id, index]));
  const focus = problemSlug(splat) || tries.data?.[0]?.id;
  const focused = useRef<HTMLLIElement>(null);
  const ready = tries.isSuccess;

  useEffect(() => {
    if (ready) focused.current?.scrollIntoView({ block: "center" });
  }, [ready, focus]);

  const all = tries.data ?? [];
  const visible = all
    .filter(
      (attempt) => (problemId === ALL || attempt.problemId === problemId) && shows(attempt, shown),
    )
    .toSorted((a, b) => {
      const newer = b.submittedAt.localeCompare(a.submittedAt);
      if (sort === "oldest") return -newer;
      if (sort === "problem") {
        return (order.get(a.problemId) ?? 0) - (order.get(b.problemId) ?? 0) || newer;
      }
      if (sort === "verdict") {
        return (a.verdict ?? "").localeCompare(b.verdict ?? "") || newer;
      }
      return newer;
    });
  const filtered = problemId !== ALL || shown !== "all";

  return (
    <Screen
      title="Submissions"
      width="wide"
      description="Every solution your team has sent, and how each was judged."
      actions={
        <Button size="sm" variant="outline" render={<Link to="/problems" />} nativeButton={false}>
          Problems
        </Button>
      }
    >
      <ErrorAlert
        error={tries.error instanceof Error ? tries.error : null}
        title="Couldn't load your submissions"
      />
      {!competing ? (
        <p className="text-sm text-muted-fg">Only participants send solutions.</p>
      ) : tries.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <>
          {problemList.length > 0 && (
            <ProblemGrid
              problems={problemList}
              attempts={all}
              settings={settings}
              picked={problemId}
              onPick={setProblemId}
            />
          )}
          {all.length === 0 ? (
            <p className="text-sm text-muted-fg">
              Nothing sent yet. Solutions you submit show here with their verdicts.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <OptSelect
                  size="sm"
                  ariaLabel="Problem"
                  value={problemId}
                  options={[
                    { value: ALL, label: "Every problem" },
                    ...problemList.map((problem) => ({
                      value: problem.id,
                      label: `${problem.label}. ${problem.title}`,
                    })),
                  ]}
                  onChange={setProblemId}
                />
                <OptSelect
                  size="sm"
                  ariaLabel="Verdict"
                  value={shown}
                  options={SHOWN}
                  onChange={setShown}
                />
                <OptSelect
                  size="sm"
                  ariaLabel="Sort"
                  className="ml-auto"
                  value={sort}
                  options={SORTS}
                  onChange={setSort}
                />
              </div>
              {visible.length === 0 ? (
                <p className="text-sm text-muted-fg">
                  None match.{" "}
                  {filtered && (
                    <Button
                      size="sm"
                      variant="link"
                      className="h-auto p-0"
                      onClick={() => {
                        setProblemId(ALL);
                        setShown("all");
                      }}
                    >
                      Show all
                    </Button>
                  )}
                </p>
              ) : (
                <ul
                  key={focus}
                  className="flex flex-col divide-y divide-border border-y border-border"
                >
                  {visible.map((attempt) => {
                    const problem = byId.get(attempt.problemId);
                    const open = attempt.id === focus;
                    return (
                      <li
                        key={attempt.id}
                        ref={open ? focused : undefined}
                        className={cn("scroll-mt-(--layout-offset)", open && "bg-muted/30")}
                      >
                        <Collapsible defaultOpen={open}>
                          <CollapsibleTrigger className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm">
                            <span className="font-mono font-medium">{problem?.label ?? "?"}</span>
                            <span className="truncate">{problem?.title ?? "A problem"}</span>
                            <TrySummary attempt={attempt} problem={problem} />
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="px-4 pb-4">
                              <TryDetail attempt={attempt} problem={problem} />
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </Screen>
  );
}
