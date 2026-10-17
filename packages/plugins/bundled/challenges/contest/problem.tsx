import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconArrowLeft,
  IconCheck,
  IconFileText,
  IconInfoCircle,
  IconPlayerPlay,
  IconPlayerPlayFilled,
  IconPlayerStopFilled,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import { useCan, useEventAccess } from "@bogey/db/permissions";
import { Badge } from "@bogey/ui/components/badge";
import { Button } from "@bogey/ui/components/button";
import { CodeEditor, DEFAULT_EDITOR_SETTINGS } from "@bogey/ui/components/code-editor";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@bogey/ui/components/drawer";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Facts } from "@bogey/ui/components/facts";
import { Field, FieldLabel } from "@bogey/ui/components/field";
import { Markdown } from "@bogey/ui/components/markdown";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { ExactTime, RelativeTime } from "@bogey/ui/components/relative-time";
import { Screen } from "@bogey/ui/components/screen";
import { Skeleton } from "@bogey/ui/components/skeleton";
import { Textarea } from "@bogey/ui/components/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@bogey/ui/components/collapsible";
import { AskAbout } from "./ask.tsx";
import { StatementPdf } from "./statement-pdf.tsx";
import {
  attachmentsQueryOptions,
  attachmentUrl,
  languagesQueryOptions,
  myAttemptsQueryOptions,
  samplesQueryOptions,
  submitSolution,
  type Attachment,
  type Attempt,
  type Problem,
  type Sample,
} from "../db.ts";
import {
  isPreviewSupported,
  runClientPreview,
  sameOutput,
  userTrace,
  type PreviewResult,
} from "../preview-runner.ts";
import type { EditorLanguage } from "@bogey/ui/components/code-editor";
import { Checkbox } from "@bogey/ui/components/checkbox";
import { TestResults } from "./results.tsx";
import {
  allowedLanguages,
  attemptLength,
  DifficultyBadge,
  editorLanguage,
  golfLength,
  Link,
  MEASURE_NOUN,
  points,
  PROBLEM_KIND,
  ProblemKindBadge,
  signals,
  topics,
  useContest,
  VerdictBadge,
  type Settings,
} from "../shared.tsx";
import { Separator } from "@bogey/ui/components/separator";

const MAX_SOURCE = 256 * 1024;
const UPLOAD_TYPES = ".py,.js,.mjs,.cpp,.cc,.cxx,.c++,.h,.hpp,.java,.txt";

function useDraft(problemId: string) {
  const key = `challenges:draft:${problemId}`;
  const [source, setSource] = useState(() => {
    try {
      return localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  });
  const update = (next: string) => {
    setSource(next);
    try {
      localStorage.setItem(key, next);
    } catch {}
  };
  return [source, update] as const;
}

export function Workspace({
  eventId,
  settings,
  problem,
}: {
  eventId: string;
  settings: Settings;
  problem: Problem;
}) {
  const [info, setInfo] = useState(false);
  const jury = useCan("challenges.jury");
  return (
    <Screen
      title={problem.title}
      width="wide"
      description={
        <span className="inline-flex flex-wrap items-center gap-2">
          <span className="font-mono font-medium text-fg">{problem.label}</span>
          <ProblemKindBadge kind={problem.kind} />
          <DifficultyBadge eventId={eventId} difficulty={problem.difficulty} />
          {points(problem.points)}
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="About this problem"
            title="About this problem"
            onClick={() => setInfo(true)}
          >
            <IconInfoCircle />
          </Button>
        </span>
      }
      actions={
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" nativeButton={false} render={<Link to="/problems" />}>
            <IconArrowLeft />
            Problems
          </Button>
          {jury ? (
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link to="/jury" splat={problem.slug} />}
            >
              Jury view
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link to="/scoreboard" />}
            >
              Scoreboard
            </Button>
          )}
        </div>
      }
    >
      <ProblemInfo
        open={info}
        onOpenChange={setInfo}
        eventId={eventId}
        settings={settings}
        problem={problem}
      />
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Statement eventId={eventId} problem={problem} />
        <Editor eventId={eventId} settings={settings} problem={problem} />
      </div>
    </Screen>
  );
}

function ProblemInfo({
  open,
  onOpenChange,
  eventId,
  settings,
  problem,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  settings: Settings;
  problem: Problem;
}) {
  const languages = useQuery(languagesQueryOptions());
  const allowed = allowedLanguages(languages.data ?? [], settings.languages);
  const contest = useContest(eventId);
  return (
    <Drawer open={open} onOpenChange={onOpenChange} swipeDirection="dynamic">
      <DrawerContent className="md:w-md">
        <DrawerHeader>
          <DrawerTitle>
            {problem.label}. {problem.title}
          </DrawerTitle>
          <DrawerDescription>{points(problem.points)}</DrawerDescription>
        </DrawerHeader>
        <Separator className="my-4" />
        <div className="flex flex-col gap-6 overflow-y-auto px-4 pb-6">
          <Facts
            facts={[
              {
                label: "Type",
                value: (
                  <span className="flex flex-col gap-0.5">
                    <span>{PROBLEM_KIND[problem.kind].label}</span>
                    <span className="text-muted-fg">{PROBLEM_KIND[problem.kind].description}</span>
                  </span>
                ),
              },
              { label: "Time limit", value: `${problem.time_limit_ms / 1000} s per test` },
              { label: "Memory", value: `${problem.memory_limit_mb} MB` },
              { label: "Worth", value: points(problem.points) },
              {
                label: "Max tries",
                value:
                  settings.attemptLimit > 0 ? `${settings.attemptLimit} per problem` : "No limit",
              },
              {
                label: "Languages",
                value:
                  allowed.map((each) => `${each.name} ${each.version}`.trim()).join(", ") || "—",
              },
              ...(contest.window?.opens_at
                ? [{ label: "Starts", value: <ExactTime value={contest.window.opens_at} /> }]
                : []),
              ...(contest.window?.closes_at
                ? [{ label: "Ends", value: <ExactTime value={contest.window.closes_at} /> }]
                : []),
            ]}
          />
          <div className="flex flex-col gap-2 text-sm text-muted-fg">
            <p>{scoringRule(settings, problem)}</p>
            <p>
              Read from standard input and write to standard output. Your solution runs against the
              samples and hidden tests, and its output has to match, give or take trailing spaces.
            </p>
            <p>
              Run tries your code in your browser on one input, for you only. Submit sends it to be
              judged; that verdict is the one that counts.
            </p>
            {settings.freezeMinutes > 0 && (
              <p>
                The scoreboard freezes {settings.freezeMinutes} minutes before the end: results
                after then stay hidden until the final standings.
              </p>
            )}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

// what this problem is worth by its type, and how the contest ranks it
function scoringRule(settings: Settings, problem: Problem): string {
  const board =
    settings.scoring === "icpc"
      ? ` The scoreboard counts problems solved; each rejected try before your first accepted one adds ${settings.penaltyMinutes} minutes to your time${settings.countCompileErrors ? ", compile errors included" : ""}.`
      : "";
  switch (problem.kind) {
    case "shortest":
      return `Your shortest accepted solution counts, measured in ${MEASURE_NOUN[settings.golfMeasure]}. ${golfRule(settings, problem)}${board}`;
    case "partial":
      return `Each test or group of tests that passes adds to the problem's points; your best solution counts.${board}`;
    default:
      return `Solving it, every test passing, earns its points; anything less earns none.${board}`;
  }
}

function golfRule(settings: Settings, problem: Problem): string {
  switch (settings.golfPoints) {
    case "length":
      if (settings.scoring === "golf") {
        return "Teams are ranked by problems solved, then by their total length: the fewer, the better.";
      }
      return "The shortest earns the problem's points; yours earns that times shortest ÷ yours.";
    case "brackets": {
      const ranges = [...problem.golf_brackets].sort((a, b) => a.max - b.max);
      return ranges.length
        ? `Points by length: ${ranges.map((range) => `up to ${range.max} earns ${range.points}`).join(", ")}; longer earns 0.`
        : "This problem's points by length aren't set yet.";
    }
    case "rank":
      return `The shortest earns the problem's points; each place below loses ${settings.golfRankStep}. Equal lengths share a place.`;
    default:
      return "The shortest earns the problem's points; yours earns that times shortest ÷ yours.";
  }
}

function Statement({ eventId, problem }: { eventId: string; problem: Problem }) {
  const samples = useQuery(samplesQueryOptions(problem.id));
  const files = useQuery(attachmentsQueryOptions(problem.id));
  return (
    <div className="flex min-w-0 flex-col gap-8">
      {problem.statement_pdf_path ? (
        <StatementPdf
          path={problem.statement_pdf_path}
          title={`${problem.label}. ${problem.title}`}
        />
      ) : problem.statement_md ? (
        <Markdown>{problem.statement_md}</Markdown>
      ) : (
        <p className="text-sm text-muted-fg">No statement yet.</p>
      )}

      {(files.data?.length ?? 0) > 0 && (
        <Screen.Section title="Files">
          <ul className="flex flex-col gap-2">
            {files.data?.map((file) => (
              <li key={file.id}>
                <FileLink file={file} />
              </li>
            ))}
          </ul>
        </Screen.Section>
      )}

      {(samples.data?.length ?? 0) > 0 && (
        <Screen.Section title="Samples">
          <div className="flex flex-col gap-3">
            {samples.data?.map((sample) => (
              <div
                key={sample.ordinal}
                className="grid gap-3 rounded-2xl bg-muted/40 p-4 sm:grid-cols-2"
              >
                <SampleText label={`Input ${sample.ordinal}`} text={sample.input} />
                <SampleText label="Expected output" text={sample.answer} />
              </div>
            ))}
          </div>
        </Screen.Section>
      )}

      <div>
        <AskAbout
          eventId={eventId}
          topic={topics.problem(problem.id)}
          subject={`${problem.label}. ${problem.title}`}
          label="Ask about this problem..."
        />
      </div>
    </div>
  );
}

function SampleText({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-muted-fg">{label}</span>
      <pre className="overflow-x-auto font-mono text-xs">{text || "(empty)"}</pre>
    </div>
  );
}

function FileLink({ file }: { file: Attachment }) {
  const [error, setError] = useState<string | null>(null);
  const open = async () => {
    const tab = window.open("about:blank", "_blank", "noopener");
    try {
      const url = await attachmentUrl(file.storage_path);
      if (tab) tab.location.href = url;
      else window.location.assign(url);
    } catch (failure) {
      tab?.close();
      setError(failure instanceof Error ? failure.message : "Couldn't open the file.");
    }
  };
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => void open()}>
        <IconFileText />
        {file.name}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </>
  );
}

type InputChoice = "custom" | `sample-${number}`;

interface RunOutcome {
  result: PreviewResult;
  expected: string | null;
  language: EditorLanguage;
}

function useVerdictSignals(
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

function Editor({
  eventId,
  settings,
  problem,
}: {
  eventId: string;
  settings: Settings;
  problem: Problem;
}) {
  const queryClient = useQueryClient();
  const access = useEventAccess();
  const jury = useCan("challenges.jury");
  const competing = access?.role === "participant";
  const contest = useContest(eventId);
  const languages = useQuery(languagesQueryOptions());
  const samples = useQuery(samplesQueryOptions(problem.id));
  const allowed = allowedLanguages(languages.data ?? [], settings.languages);
  const [picked, setPicked] = useState<string | null>(null);
  const language = allowed.find((each) => each.key === picked) ?? allowed[0];
  const editor = editorLanguage(language);
  const [source, setSource] = useDraft(problem.id);
  const [choice, setChoice] = useState<InputChoice>("sample-1");
  const [custom, setCustom] = useState("");
  const [run, setRun] = useState<RunOutcome | null>(null);
  const [all, setAll] = useState<Array<{ sample: Sample; passed: boolean }> | null>(null);
  const [running, setRunning] = useState(false);
  const stopper = useRef<AbortController | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const typing = settings.allowEditor || !settings.allowUpload;
  const uploading = settings.allowUpload;

  const tries = useQuery({
    ...myAttemptsQueryOptions(eventId, problem.id),
    enabled: competing,
    refetchInterval: (query) =>
      query.state.data?.some((attempt) => !attempt.verdict) ? 5_000 : false,
  });
  useVerdictSignals(eventId, tries.data);
  const used = tries.data?.length ?? 0;
  const outOfTries = settings.attemptLimit > 0 && used >= settings.attemptLimit;
  const blocked = !competing
    ? jury
      ? "You're on the jury. Run code here, and test solutions on the Jury page."
      : "Only participants' solutions are judged."
    : !contest.running
      ? "The contest isn't running, so solutions can't be submitted."
      : outOfTries
        ? "You've used every try for this problem."
        : null;

  const submit = useMutation({
    mutationFn: () =>
      submitSolution({ problemId: problem.id, language: language?.key ?? "", source }),
    onSuccess: () => {
      signals.emit("submitted", eventId);
      return queryClient.invalidateQueries({
        queryKey: myAttemptsQueryOptions(eventId, problem.id).queryKey,
      });
    },
  });

  const sampleList = samples.data ?? [];
  const sampleFor = (input: InputChoice) =>
    input === "custom" ? undefined : sampleList.find((each) => `sample-${each.ordinal}` === input);
  const current = sampleFor(choice);
  const stdin = current ? current.input : custom;
  const limit = Math.max(5_000, problem.time_limit_ms * 3);

  const stop = () => stopper.current?.abort();

  const runOne = async () => {
    const controller = new AbortController();
    stopper.current = controller;
    setRunning(true);
    setAll(null);
    const result = await runClientPreview(editor, source, stdin, limit, controller.signal);
    stopper.current = null;
    setRun({ result, expected: current ? current.answer : null, language: editor });
    setRunning(false);
  };

  const runAll = async () => {
    const controller = new AbortController();
    stopper.current = controller;
    setRunning(true);
    setRun(null);
    const outcomes: Array<{ sample: Sample; passed: boolean }> = [];
    for (const sample of sampleList) {
      const result = await runClientPreview(editor, source, sample.input, limit, controller.signal);
      if (result.status === "stopped") break;
      outcomes.push({
        sample,
        passed:
          result.status === "ok" &&
          result.exitCode === 0 &&
          sameOutput(result.stdout, sample.answer),
      });
      setAll([...outcomes]);
    }
    stopper.current = null;
    setAll(outcomes);
    setRunning(false);
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    setUploadError(null);
    if (!file) return;
    if (file.size > MAX_SOURCE) return setUploadError("Solutions can be up to 256 KB.");
    setSource(await file.text());
  };

  const previewable = isPreviewSupported(editor);

  return (
    <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-[calc(var(--layout-offset,0px)+1rem)]">
      <div className="flex flex-wrap items-end gap-2">
        <Field className="w-52">
          <FieldLabel htmlFor={`language-${problem.id}`} className="sr-only">
            Language
          </FieldLabel>
          <OptSelect
            id={`language-${problem.id}`}
            ariaLabel="Language"
            value={language?.key ?? null}
            placeholder="Pick a language"
            options={allowed.map((each) => ({
              value: each.key,
              label: `${each.name} ${each.version}`.trim(),
            }))}
            onChange={setPicked}
          />
        </Field>
        {uploading && (
          <>
            <input
              ref={fileInput}
              type="file"
              accept={UPLOAD_TYPES}
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(event) => void upload(event)}
            />
            <Button variant="outline" onClick={() => fileInput.current?.click()}>
              <IconUpload />
              Upload a file
            </Button>
          </>
        )}
        <div className="ml-auto flex gap-2">
          {running ? (
            <Button variant="outline" onClick={stop}>
              <IconPlayerStopFilled />
              Stop
            </Button>
          ) : (
            <Button
              variant="outline"
              disabled={!previewable || !source.trim()}
              title={previewable ? undefined : "This language can't run in the browser"}
              onClick={() => void runOne()}
            >
              <IconPlayerPlay />
              Run
            </Button>
          )}
          <Button
            disabled={!!blocked || !source.trim() || !language || submit.isPending}
            title={blocked ?? undefined}
            onClick={() => submit.mutate()}
          >
            {submit.isPending ? "Submitting..." : "Submit"}
          </Button>
        </div>
      </div>

      <CodeEditor
        value={source}
        onChange={typing ? (next) => setSource(next.slice(0, MAX_SOURCE)) : undefined}
        language={editor}
        readOnly={!typing}
        placeholder={
          typing
            ? "Read from standard input, write to standard output."
            : "Upload a file to see it here."
        }
        minHeight="28rem"
        settings={{
          ...DEFAULT_EDITOR_SETTINGS,
          tabSize: settings.editorTabSize,
          autocomplete: settings.editorAutocomplete,
          lineWrapping: settings.editorLineWrapping,
        }}
      />
      {problem.kind === "shortest" && (
        <GolfLength settings={settings} source={source} attempts={tries.data ?? []} />
      )}
      {blocked && <p className="text-sm text-muted-fg">{blocked}</p>}
      <ErrorAlert error={uploadError} title="Couldn't load that file" />
      <ErrorAlert error={submit.error} title="Couldn't submit" />

      <div className="flex flex-col gap-3 rounded-2xl border border-border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Input</span>
          <OptSelect
            size="sm"
            ariaLabel="Input to run on"
            value={choice}
            options={[
              ...sampleList.map((sample) => ({
                value: `sample-${sample.ordinal}` as InputChoice,
                label: `Sample ${sample.ordinal}`,
              })),
              { value: "custom" as InputChoice, label: "Your own input" },
            ]}
            onChange={setChoice}
          />
          {sampleList.length > 1 && (
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              disabled={!previewable || running || !source.trim()}
              onClick={() => void runAll()}
            >
              <IconPlayerPlayFilled />
              Run all samples
            </Button>
          )}
        </div>
        <Textarea
          aria-label="Standard input"
          rows={3}
          className="font-mono text-xs"
          value={stdin}
          readOnly={choice !== "custom"}
          placeholder="Type the input your program reads."
          onChange={(event) => setCustom(event.target.value)}
        />
        {!previewable && (
          <p className="text-sm text-muted-fg">
            {language?.name ?? "This language"} can't run in the browser. Submit it to be judged.
          </p>
        )}
        {all && (
          <ul className="flex flex-wrap gap-2">
            {all.map(({ sample, passed }) => (
              <li key={sample.ordinal}>
                <Badge variant={passed ? "default" : "destructive"}>
                  {passed ? <IconCheck /> : <IconX />}
                  Sample {sample.ordinal}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        {run && <RunOutput outcome={run} separate={settings.separateErrors} />}
      </div>

      {competing && (
        <Tries
          eventId={eventId}
          problem={problem}
          settings={settings}
          attempts={tries.data ?? []}
          loading={tries.isPending}
        />
      )}
    </div>
  );
}

function RunOutput({ outcome, separate }: { outcome: RunOutcome; separate: boolean }) {
  const { result, expected, language } = outcome;
  const [full, setFull] = useState(false);
  if (result.status === "error") {
    return <p className="text-sm text-destructive">{result.message}</p>;
  }
  if (result.status === "timeout") {
    return <p className="text-sm text-destructive">It ran too long and was stopped.</p>;
  }
  if (result.status === "stopped") {
    return <p className="text-sm text-muted-fg">Stopped.</p>;
  }
  const matches = expected !== null && result.exitCode === 0 && sameOutput(result.stdout, expected);
  const short = userTrace(result.stderr, language);
  const trimmed = short !== result.stderr;
  const stderr = full ? result.stderr : short;
  const fullToggle = trimmed && (
    <label className="flex items-center gap-2 text-xs text-muted-fg">
      <Checkbox checked={full} onCheckedChange={(checked) => setFull(checked === true)} />
      Show the runner's lines too, in case the problem is the runner
    </label>
  );
  return (
    <div className="flex flex-col gap-3">
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted-fg">
        {expected !== null && (
          <Badge variant={matches ? "default" : "destructive"}>
            {matches ? "Matches the sample" : "Doesn't match the sample"}
          </Badge>
        )}
        Finished in {result.ms} ms{result.exitCode !== 0 && `, exit code ${result.exitCode}`}.
      </p>
      {separate ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel>Output</FieldLabel>
            <Textarea readOnly rows={6} className="font-mono text-xs" value={result.stdout} />
          </Field>
          <Field>
            <FieldLabel>Errors</FieldLabel>
            <Textarea
              readOnly
              rows={6}
              className="font-mono text-xs"
              value={stderr}
              placeholder="Nothing on standard error."
            />
            {fullToggle}
          </Field>
        </div>
      ) : (
        <Field>
          <FieldLabel>Output</FieldLabel>
          <pre
            tabIndex={0}
            aria-label="Output"
            className="max-h-60 min-h-24 overflow-auto rounded-2xl bg-input/50 px-3 py-3 font-mono text-xs whitespace-pre-wrap"
          >
            {result.stdout}
            {stderr && <span className="text-destructive">{stderr}</span>}
            {!result.stdout && !result.stderr && (
              <span className="text-muted-fg">Nothing was printed.</span>
            )}
          </pre>
          {fullToggle}
        </Field>
      )}
    </div>
  );
}

function GolfLength({
  settings,
  source,
  attempts,
}: {
  settings: Settings;
  source: string;
  attempts: Tuple<Attempt>;
}) {
  const noun = MEASURE_NOUN[settings.golfMeasure];
  const accepted = attempts
    .filter((attempt) => attempt.verdict === "AC")
    .map((attempt) => attemptLength(attempt, settings.golfMeasure));
  const best = accepted.length ? Math.min(...accepted) : null;
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" aria-live="polite">
      <span className="font-mono tabular-nums">
        {golfLength(source, settings.golfMeasure)} {noun}
      </span>
      {best !== null && (
        <span className="text-muted-fg">
          Your shortest accepted: <span className="font-mono tabular-nums">{best}</span>
        </span>
      )}
    </p>
  );
}

function Tries({
  eventId,
  problem,
  settings,
  attempts,
  loading,
}: {
  eventId: string;
  problem: Problem;
  settings: Settings;
  attempts: Tuple<Attempt>;
  loading: boolean;
}) {
  if (loading) return <Skeleton className="h-16 w-full" />;
  if (attempts.length === 0) return null;
  return (
    <Screen.Section title="Your tries">
      <ul className="flex flex-col divide-y divide-border border-y border-border">
        {attempts.map((attempt) => (
          <li key={attempt.id}>
            <Collapsible>
              <CollapsibleTrigger className="flex w-full items-center gap-3 py-2.5 text-left text-sm">
                <span className="text-muted-fg">
                  <RelativeTime value={attempt.submittedAt} /> · {attempt.language}
                  {attempt.timeMs !== null && ` · ${attempt.timeMs} ms`}
                  {problem.kind === "shortest" &&
                    ` · ${attemptLength(attempt, settings.golfMeasure)} ${MEASURE_NOUN[settings.golfMeasure]}`}
                </span>
                <span className="ml-auto">
                  <VerdictBadge attempt={attempt} />
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="flex flex-col gap-3 pb-4">
                  {attempt.verdict === "CE" &&
                    attempt.compileOutput &&
                    (settings.showErrors ? (
                      <pre className="max-h-48 overflow-auto rounded-xl bg-muted/50 p-2 font-mono text-xs whitespace-pre-wrap">
                        {attempt.compileOutput}
                      </pre>
                    ) : (
                      <p className="text-sm text-muted-fg">
                        It didn't compile. This contest doesn't show error messages.
                      </p>
                    ))}
                  <TestResults solutionId={attempt.id} judged={attempt.verdict !== null} />
                  <div>
                    <AskAbout
                      eventId={eventId}
                      topic={topics.solution(attempt.id)}
                      subject={`${problem.label}. ${problem.title}: a try`}
                      label="Ask about this try..."
                    />
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </li>
        ))}
      </ul>
    </Screen.Section>
  );
}
