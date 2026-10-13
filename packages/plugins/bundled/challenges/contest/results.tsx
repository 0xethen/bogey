import { useQuery } from "@tanstack/react-query";
import { IconChevronDown } from "@tabler/icons-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@bogey/ui/components/collapsible";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Skeleton } from "@bogey/ui/components/skeleton";
import { attemptTestsQueryOptions, type TestResult } from "../db.ts";
import { TestVerdict } from "../shared.tsx";

function Block({ label, text }: { label: string; text: string | null }) {
  if (text === null) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-muted-fg">{label}</span>
      <pre className="max-h-48 overflow-auto rounded-xl bg-muted/50 p-2 font-mono text-xs whitespace-pre-wrap">
        {text || "(empty)"}
      </pre>
    </div>
  );
}

function TestRow({ test }: { test: TestResult }) {
  const name = test.is_sample ? `Sample ${test.ordinal}` : `Test ${test.ordinal}`;
  const details = [test.input, test.answer, test.output, test.stderr].some((text) => text !== null);
  const summary = (
    <>
      <span className="w-24 shrink-0 font-medium">{name}</span>
      <TestVerdict verdict={test.verdict} />
      <span className="ml-auto text-muted-fg tabular-nums">
        {test.time_ms !== null && `${test.time_ms} ms`}
        {test.memory_kb !== null && ` · ${Math.round(test.memory_kb / 1024)} MB`}
      </span>
    </>
  );
  if (!details) return <li className="flex items-center gap-3 py-2 text-sm">{summary}</li>;
  return (
    <li>
      <Collapsible>
        <CollapsibleTrigger className="group flex w-full items-center gap-3 py-2 text-left text-sm">
          {summary}
          <IconChevronDown className="size-4 text-muted-fg transition-transform group-data-[panel-open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="grid gap-3 pb-3 sm:grid-cols-2">
            <Block label="Input" text={test.input} />
            <Block label="Expected" text={test.answer} />
            <Block label="Output" text={test.output} />
            <Block label="Errors" text={test.stderr} />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </li>
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
  const failed = tests.data.filter((test) => test.verdict !== "AC").length;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm text-muted-fg">
        {failed === 0
          ? `Passed all ${tests.data.length} tests.`
          : `Failed ${failed} of ${tests.data.length} tests.`}
      </p>
      <ul className="flex flex-col divide-y divide-border">
        {tests.data.map((test) => (
          <TestRow key={`${test.is_sample}-${test.ordinal}`} test={test} />
        ))}
      </ul>
    </div>
  );
}
