import { useQuery } from "@tanstack/react-query";
import { IconCircleCheck, IconCircleX } from "@tabler/icons-react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@bogey/ui/components/chart";
import { attemptTestsQueryOptions } from "../db.ts";
import { VERDICTS } from "../shared.tsx";

const config = {
  time: { label: "Time (ms)", color: "var(--color-primary)" },
} satisfies ChartConfig;

const PASSED = "var(--color-primary)";
const FAILED = "var(--color-destructive)";

/**
 * How long a solution took on each test, against the problem's time limit, for the jury to see
 * where a solution is slow or which test broke it. One series: failing tests are marked by color
 * and named in the legend and tooltip, so color is never the only cue.
 */
export function SolutionChart({
  solutionId,
  timeLimitMs,
}: {
  solutionId: string;
  timeLimitMs: number;
}) {
  const tests = useQuery(attemptTestsQueryOptions(solutionId));
  const rows = (tests.data ?? [])
    .filter((test) => test.time_ms !== null)
    .map((test) => ({
      name: test.is_sample ? `S${test.ordinal}` : `${test.ordinal}`,
      test: test.is_sample ? `Sample ${test.ordinal}` : `Test ${test.ordinal}`,
      time: test.time_ms ?? 0,
      verdict: VERDICTS[test.verdict],
      passed: test.verdict === "AC",
    }));
  if (rows.length === 0) return null;
  const failed = rows.some((row) => !row.passed);
  const slowest = Math.max(...rows.map((row) => row.time));

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-fg">
        <span className="font-medium text-fg">Time per test</span>
        <span>
          Slowest {slowest} ms of {timeLimitMs} ms
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <IconCircleCheck className="size-3.5" style={{ color: PASSED }} />
          Passed
        </span>
        {failed && (
          <span className="flex items-center gap-1.5">
            <IconCircleX className="size-3.5" style={{ color: FAILED }} />
            Failed
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="w-4 border-t-2 border-dashed border-muted-fg" />
          Time limit
        </span>
      </figcaption>
      <ChartContainer config={config} className="aspect-auto h-44 w-full">
        <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="name" tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={44}
            domain={[0, Math.max(timeLimitMs, slowest)]}
            tickFormatter={(value: number) => `${value}`}
          />
          <ReferenceLine y={timeLimitMs} strokeDasharray="4 4" className="stroke-muted-fg" />
          <ChartTooltip
            cursor={{ fillOpacity: 0.4 }}
            content={
              <ChartTooltipContent
                labelFormatter={(_label, payload) => {
                  const row = payload[0]?.payload;
                  return row && typeof row === "object" && "test" in row && "verdict" in row
                    ? `${String(row.test)}: ${String(row.verdict)}`
                    : "";
                }}
              />
            }
          />
          <Bar dataKey="time" radius={[4, 4, 0, 0]} maxBarSize={28}>
            {rows.map((row) => (
              <Cell key={row.name} fill={row.passed ? PASSED : FAILED} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </figure>
  );
}
