import { useQuery } from "@tanstack/react-query";
import { IconCircleCheck, IconCircleDashed } from "@tabler/icons-react";
import { useCan, useEventAccess } from "@bogey/db/permissions";
import type { PluginRouteContext } from "@bogey/plugins/runtime";
import { Button } from "@bogey/ui/components/button";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { LockedNotice } from "@bogey/ui/components/panel";
import { RelativeTime } from "@bogey/ui/components/relative-time";
import { Screen } from "@bogey/ui/components/screen";
import { Skeleton } from "@bogey/ui/components/skeleton";
import { useNow } from "@bogey/ui/hooks/now";
import { recentAttemptsQueryOptions } from "../db.ts";
import {
  DifficultyBadge,
  Link,
  MEASURE_NOUN,
  points,
  useContest,
  useLiveContest,
  useProblems,
  type Settings,
} from "../shared.tsx";

export function Problems({ eventId, settings }: PluginRouteContext<Settings>) {
  const access = useEventAccess();
  const jury = useCan("challenges.jury");
  const competing = access?.role === "participant";
  const problems = useProblems(eventId, settings.problemOrder);
  const tries = useQuery({ ...recentAttemptsQueryOptions(eventId), enabled: competing });
  const contest = useContest(eventId);
  useLiveContest(eventId);
  const now = useNow();
  const closes = contest.window?.closes_at;
  const over = !contest.running && !!closes && now !== null && new Date(closes).getTime() <= now;

  const solved = new Set(
    (tries.data ?? []).filter((each) => each.verdict === "AC").map((each) => each.problemId),
  );
  const tried = new Set((tries.data ?? []).map((each) => each.problemId));

  return (
    <Screen
      title="Problems"
      width="wide"
      description={
        <>
          {contest.running && contest.window?.closes_at && (
            <>
              The contest ends <RelativeTime value={contest.window.closes_at} />.{" "}
            </>
          )}
          {settings.scoring === "icpc"
            ? `Ranked by problems solved, then time (minutes to solve${settings.penaltyMinutes && ` plus ${settings.penaltyMinutes} for each incorrect attempt`}).`
            : settings.scoring === "golf"
              ? `Code golf: the shortest accepted solution wins, counted in ${MEASURE_NOUN[settings.golfMeasure]}.`
              : "Ranked by points: each problem's type says what a solution to it is worth."}
        </>
      }
      actions={
        <div className="flex gap-2">
          {jury && (
            <Button size="sm" variant="ghost" nativeButton={false} render={<Link to="/jury" />}>
              Jury
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link to="/scoreboard" />}
          >
            Scoreboard
          </Button>
        </div>
      }
    >
      {contest.loaded && !contest.window && (
        <LockedNotice>
          There's no contest window yet. Organizers add one on the agenda.
        </LockedNotice>
      )}
      <ErrorAlert
        error={problems.error instanceof Error ? problems.error : null}
        title="Couldn't load the problems"
      />
      {problems.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-36 w-full rounded-2xl" />
          ))}
        </div>
      ) : problems.data?.length ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {problems.data.map((problem) => (
            <li key={problem.id}>
              <Link
                to="/problems"
                splat={problem.slug}
                className="group flex h-full flex-col gap-3 rounded-2xl p-5 no-underline transition-colors border border-border hocus:bg-accent"
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-muted font-mono text-lg font-semibold">
                    {problem.label}
                  </span>
                  {solved.has(problem.id) ? (
                    <span className="flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-300">
                      <IconCircleCheck className="size-4" />
                      Solved
                    </span>
                  ) : tried.has(problem.id) ? (
                    <span className="flex items-center gap-1 text-xs text-muted-fg">
                      <IconCircleDashed className="size-4" />
                      Attempted
                    </span>
                  ) : null}
                </span>
                <span className="font-heading text-lg font-semibold text-fg">{problem.title}</span>
                <span className="mt-auto flex flex-wrap items-center gap-2 text-sm text-muted-fg">
                  <DifficultyBadge difficulty={problem.difficulty} />
                  {points(problem.points)}
                  {jury && !problem.visible && <span>· Hidden</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-fg">
          {jury
            ? "No problems yet. Add some on the Jury page."
            : over && !settings.problemsAfterContest
              ? "The contest is over, and its problems are no longer shown."
              : "No problems to show. They appear here when the contest opens."}
        </p>
      )}
    </Screen>
  );
}
