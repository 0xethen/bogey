import { useQuery } from "@tanstack/react-query";
import { IconCircleCheck, IconCircleX } from "@tabler/icons-react";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Skeleton } from "@bogey/ui/components/skeleton";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@bogey/ui/components/trace";
import { attemptTestsQueryOptions, type TestResult } from "../db.ts";
import { OutputBlock, VERDICTS } from "../shared.tsx";

function TestRow({ test, open }: { test: TestResult; open: boolean }) {
  const name = test.is_sample ? `Sample ${test.ordinal}` : `Test ${test.ordinal}`;
  const passed = test.verdict === "AC";
  const usage = [
    test.time_ms !== null && `${test.time_ms} ms`,
    test.memory_kb !== null && `${Math.round(test.memory_kb / 1024)} MB`,
  ]
    .filter(Boolean)
    .join(" · ");
  const line = (
    <TraceLine status={passed ? undefined : "error"}>
      <TraceIcon>{passed ? <IconCircleCheck /> : <IconCircleX />}</TraceIcon>
      <TraceTitle>
        {name}: {VERDICTS[test.verdict]}
      </TraceTitle>
      {usage && <TraceDescription>{usage}</TraceDescription>}
    </TraceLine>
  );
  const blocks = (
    [
      ["Input", test.input],
      ["Expected", test.answer],
      ["Output", test.output],
      ["Errors", test.stderr],
    ] as const
  ).flatMap(([label, text]) => (text === null ? [] : [{ label, text }]));
  if (blocks.length === 0) return line;
  return (
    <TraceCollapsible defaultOpen={open}>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="grid gap-3 sm:grid-cols-2">
        {blocks.map(({ label, text }) => (
          <OutputBlock
            key={label}
            title={label}
            text={text}
            variant={label === "Errors" && text ? "destructive" : "default"}
          />
        ))}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

export function TestResults({ solutionId, judged }: { solutionId: string; judged: boolean }) {
  const tests = useQuery({ ...attemptTestsQueryOptions(solutionId), enabled: judged });
  if (!judged) return <p className="text-sm text-muted-fg">Tests show here once it's judged.</p>;
  if (tests.isPending) return <Skeleton className="h-16 w-full" />;
  if (tests.isError) {
    return (
      <ErrorAlert
        error={tests.error instanceof Error ? tests.error : null}
        title="Couldn't load the tests"
      />
    );
  }
  if (tests.data.length === 0) {
    return (
      <p className="text-sm text-muted-fg">
        This event shows only the overall verdict, not each test.
      </p>
    );
  }
  const failed = tests.data.filter((test) => test.verdict !== "AC");
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-fg">
        {failed.length === 0
          ? `Passed all ${tests.data.length} tests.`
          : `Failed ${failed.length} of ${tests.data.length} tests.`}
      </p>
      <Trace>
        {tests.data.map((test) => (
          <TestRow
            key={`${test.is_sample}-${test.ordinal}`}
            test={test}
            open={test === failed[0]}
          />
        ))}
      </Trace>
    </div>
  );
}
