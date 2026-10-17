import { useState } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useCan } from "@bogey/db/permissions";
import { useNow } from "@bogey/ui/hooks/now";
import type { PluginContext } from "@bogey/plugins/runtime";
import { Button } from "@bogey/ui/components/button";
import { LockedNotice } from "@bogey/ui/components/panel";
import { RelativeTime } from "@bogey/ui/components/relative-time";
import { Screen } from "@bogey/ui/components/screen";
import { Skeleton } from "@bogey/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@bogey/ui/components/table";
import { cn } from "@bogey/ui/lib/utils";
import { scoreboardQueryOptions, type Scoreboard as ScoreboardData } from "../db.ts";
import { Link, MEASURE_NOUN, useContest, type Settings } from "../shared.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@bogey/ui/components/tabs";
import type { View } from "./view-tabs.tsx";

export function Scoreboard({ eventId, settings }: PluginContext<Settings>) {
  const jury = useCan("challenges.jury");
  const [view, setView] = useState<View>("public");
  const board = useQuery({
    ...scoreboardQueryOptions(eventId, jury && view === "jury"),
    refetchInterval: 30_000,
  });
  const standings = <Standings board={board} />;

  return (
    <Screen
      title="Scoreboard"
      description={describe(settings, board.data)}
      actions={
        <Button size="sm" variant="outline" nativeButton={false} render={<Link to="/problems" />}>
          Problems
        </Button>
      }
    >
      {jury ? (
        <Tabs value={view} onValueChange={(next: View) => setView(next)}>
          <TabsList aria-label="Which scoreboard">
            <TabsTrigger value="public">Public view</TabsTrigger>
            <TabsTrigger value="jury">Jury view</TabsTrigger>
          </TabsList>
          <TabsContent value={view}>{standings}</TabsContent>
        </Tabs>
      ) : (
        standings
      )}
    </Screen>
  );
}

function describe(settings: Settings, board: ScoreboardData | undefined): string {
  if (board?.frozen) {
    return "Scoreboard is frozen. Tries show as pending until the final standings are revealed.";
  }
  if (settings.scoring === "icpc") {
    return "Problems solved, then penalty minutes. Number on green show how many tries it took.";
  }
  if (settings.scoring === "golf") {
    const noun = MEASURE_NOUN[settings.golfMeasure];
    return settings.golfPoints === "length"
      ? `Problems solved, then the fewest ${noun} in total across accepted solutions. Each cell shows its length; ★ is the shortest.`
      : `Shortest accepted solution wins, counted in ${noun}. Each cell shows its length and the points it earned.`;
  }
  return "Points from each problem's best solution.";
}

function Standings({ board }: { board: UseQueryResult<ScoreboardData, unknown> }) {
  if (board.isPending) return <Skeleton className="h-64 w-full" />;
  if (board.isError) {
    return (
      <LockedNotice>
        {board.error instanceof Error ? board.error.message : "The scoreboard isn't open."}
      </LockedNotice>
    );
  }
  if (board.data.rows.length === 0)
    return <p className="py-4 text-sm text-muted-fg">No teams yet.</p>;
  return <ScoreTable board={board.data} />;
}

function ScoreTable({ board }: { board: ScoreboardData }) {
  const icpc = board.scoring === "icpc";
  const golf = board.scoring === "golf";
  const byLength = golf && board.golfPoints === "length";
  // a length column whenever a problem is scored on length
  const lengths = board.problems.some((problem) => problem.kind === "shortest");
  const solvedFirst = icpc || byLength;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">#</TableHead>
            <TableHead>Team</TableHead>
            <TableHead className="text-right">{solvedFirst ? "Solved" : "Score"}</TableHead>
            {icpc && <TableHead className="text-right">Penalty</TableHead>}
            {lengths && <TableHead className="text-right">Length</TableHead>}
            {board.problems.map((problem) => (
              <TableHead key={problem.id} className="text-center font-mono" title={problem.title}>
                {problem.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {board.rows.map((row) => (
            <TableRow key={row.team_id}>
              <TableCell className="font-mono text-muted-fg tabular-nums">{row.rank}</TableCell>
              <TableCell className="font-medium">{row.team_name}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {solvedFirst ? row.solved : row.score}
              </TableCell>
              {icpc && (
                <TableCell className="text-right font-mono text-muted-fg tabular-nums">
                  {row.solved > 0 ? row.penalty : "–"}
                </TableCell>
              )}
              {lengths && (
                <TableCell className="text-right font-mono text-muted-fg tabular-nums">
                  {row.solved > 0 ? row.total_length : "–"}
                </TableCell>
              )}
              {board.problems.map((problem) => {
                const cell = row.cells.find((each) => each.problem_id === problem.id);
                return (
                  <TableCell key={problem.id} className="p-1 text-center">
                    {cell && (cell.attempts > 0 || cell.pending > 0) ? (
                      <span
                        className={cn(
                          "inline-flex min-w-12 flex-col items-center rounded-lg px-2 py-1 font-mono text-xs tabular-nums",
                          cell.solved
                            ? cell.first
                              ? "bg-green-600/30 text-green-700 dark:text-green-300"
                              : "bg-green-500/15 text-green-700 dark:text-green-300"
                            : cell.pending > 0
                              ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                              : "bg-red-500/12 text-red-700 dark:text-red-300",
                        )}
                        title={cell.first ? "First to solve it" : undefined}
                      >
                        {icpc ? (
                          <>
                            <span>
                              {cell.attempts}
                              {cell.pending > 0 && `+${cell.pending}`}
                            </span>
                            {cell.solved && cell.minutes !== null && (
                              <span className="opacity-70">{cell.minutes}m</span>
                            )}
                          </>
                        ) : problem.kind === "shortest" ? (
                          <>
                            <span>
                              {cell.solved ? (cell.length ?? "–") : "–"}
                              {byLength && cell.place === 1 ? " ★" : ""}
                            </span>
                            {cell.solved && !byLength && (
                              <span className="opacity-70">
                                {cell.score ?? 0}
                                {cell.place === 1 ? " ★" : ""}
                              </span>
                            )}
                          </>
                        ) : (
                          (cell.score ?? 0)
                        )}
                      </span>
                    ) : null}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function ContestPanel({ eventId, settings }: PluginContext<Settings>) {
  const { window: contest, running } = useContest(eventId);
  const now = useNow(60_000);
  if (!contest) return null;
  const ctf = settings.format === "ctf";
  return (
    <Screen.Section
      title={ctf ? "Capture the flag" : "Contest"}
      actions={
        <Button
          size="sm"
          variant={running ? "default" : "outline"}
          nativeButton={false}
          render={<Link to="/problems" />}
        >
          {running ? `Go to ${ctf ? "Challenges" : "Problems"}` : ctf ? "Challenges" : "Problems"}
        </Button>
      }
    >
      <p className="text-sm text-muted-fg">
        {running ? (
          contest.closes_at ? (
            <>
              Running. It ends <RelativeTime value={contest.closes_at} />.
            </>
          ) : (
            "Running now."
          )
        ) : contest.opens_at && now !== null && new Date(contest.opens_at).getTime() > now ? (
          <>
            Starts <RelativeTime value={contest.opens_at} />.
          </>
        ) : (
          "The contest is over. The scoreboard has the results."
        )}
      </p>
    </Screen.Section>
  );
}
