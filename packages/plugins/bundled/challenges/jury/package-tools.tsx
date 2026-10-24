import { useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { IconDownload, IconUpload } from "@tabler/icons-react";
import { Button } from "@bogey/ui/components/button";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Field, FieldLabel } from "@bogey/ui/components/field";
import { Input } from "@bogey/ui/components/input";
import { Screen } from "@bogey/ui/components/screen";
import { plural } from "@bogey/utils/text";
import {
  attachmentsQueryOptions,
  ccsExportUrl,
  importProblemPackage,
  problemPackageUrl,
  problemsQueryOptions,
  testcasesQueryOptions,
  type PackageImport,
  type Problem,
} from "../db.ts";
import { Link } from "../shared.tsx";
import { useChallenges } from "../context.tsx";

function Outcome({ result }: { result: PackageImport }) {
  return (
    <div className="flex flex-col gap-2 text-sm" role="status">
      <p>
        Imported {plural(result.tests, "test")}, {plural(result.attachments, "file")} and{" "}
        {plural(result.solutions, "jury solution")}.{" "}
        <Link to="/jury" splat={result.slug} className="underline">
          Open the problem
        </Link>
      </p>
      {result.warnings.length > 0 && (
        <ul className="list-disc pl-5 text-muted-fg">
          {result.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ImportPackage({ next }: { next: string }) {
  const { eventId } = useChallenges();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState(next);
  const add = useMutation({
    mutationFn: (file: File) => importProblemPackage(eventId, file, { label: label.trim() }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: problemsQueryOptions(eventId).queryKey }),
  });
  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) add.mutate(file);
  };

  return (
    <Screen.Section
      title="Import a problem package"
      description="A Kattis or ICPC problem package (.zip). The problem is added hidden, so you can look it over before participants see it."
    >
      <div className="flex flex-wrap items-end gap-3">
        <Field className="w-28">
          <FieldLabel>ID</FieldLabel>
          <Input value={label} onChange={(event) => setLabel(event.target.value)} />
        </Field>
        <input
          ref={input}
          type="file"
          accept=".zip,application/zip"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={pick}
        />
        <Button
          variant="outline"
          disabled={add.isPending || label.trim() === ""}
          onClick={() => input.current?.click()}
        >
          <IconUpload />
          {add.isPending ? "Importing..." : "Choose a package..."}
        </Button>
      </div>
      <ErrorAlert error={add.error} title="Couldn't import the package" />
      {add.data && <Outcome result={add.data} />}
    </Screen.Section>
  );
}

export function ProblemPackage({ problem }: { problem: Problem }) {
  const { eventId } = useChallenges();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const replace = useMutation({
    mutationFn: (file: File) => importProblemPackage(eventId, file, { replace: problem.id }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: problemsQueryOptions(eventId).queryKey }),
        queryClient.invalidateQueries({ queryKey: testcasesQueryOptions(problem.id).queryKey }),
        queryClient.invalidateQueries({ queryKey: attachmentsQueryOptions(problem.id).queryKey }),
      ]),
  });
  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) replace.mutate(file);
  };

  return (
    <Screen.Section
      title="Problem package"
      description="The problem, its tests, files and jury solutions as a Kattis / ICPC package, to keep or to use in another contest."
      actions={
        <>
          <input
            ref={input}
            type="file"
            accept=".zip,application/zip"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={pick}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={replace.isPending}
            confirm={{
              title: "Replace this problem from a package?",
              description:
                "Its statement, limits, checker and tests are replaced by the package's. Files with the same name are overwritten. Submissions stay.",
              label: "Choose a package",
              variant: "default",
            }}
            onClick={() => input.current?.click()}
          >
            <IconUpload />
            {replace.isPending ? "Importing..." : "Replace from a package..."}
          </Button>
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<a href={problemPackageUrl(eventId, problem.id)} download />}
          >
            <IconDownload />
            Export
          </Button>
        </>
      }
    >
      <ErrorAlert error={replace.error} title="Couldn't import the package" />
      {replace.data && <Outcome result={replace.data} />}
    </Screen.Section>
  );
}

export function ContestExport() {
  const { eventId } = useChallenges();
  return (
    <Screen.Section
      title="Contest data"
      description="Everything about the contest in the ICPC Contest API's shape, for resolvers, scoreboard displays and archives. Teams, submissions and judgements are included."
      actions={
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<a href={ccsExportUrl(eventId)} download />}
        >
          <IconDownload />
          Download
        </Button>
      }
    >
      <p className="text-sm text-muted-fg">
        The scoreboard alone is public while its window is open, at{" "}
        <code>/api/x/challenges/contests/&lt;event URL name&gt;/scoreboard</code>.
      </p>
    </Screen.Section>
  );
}
