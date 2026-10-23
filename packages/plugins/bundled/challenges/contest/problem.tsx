import { useRef, useState, type ChangeEvent } from "react";
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
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@bogey/ui/components/code-block";
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
import { ExactTime } from "@bogey/ui/components/relative-time";
import { Screen } from "@bogey/ui/components/screen";
import { Textarea } from "@bogey/ui/components/textarea";
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
import { isJudging, LatestTry, untilJudged, useVerdictSignals } from "./tries.tsx";
import {
  allowedLanguages,
  attemptLength,
  DifficultyBadge,
  editorLanguage,
  golfLength,
  Link,
  MEASURE_NOUN,
  OutputBlock,
  points,
  PROBLEM_KIND,
  signals,
  topics,
  useContest,
  useGoTo,
  useLiveContest,
  type Settings,
} from "../shared.tsx";
import { Separator } from "@bogey/ui/components/separator";
import { Spinner } from "@bogey/ui/components/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@bogey/ui/components/tabs";

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
  useLiveContest(eventId);
  return (
    <Screen
      title={`${problem.label}. ${problem.title}`}
      width="wide"
      description={
        <span className="inline-flex flex-wrap items-center gap-2">
          <span title={PROBLEM_KIND[problem.kind].description}>
            {PROBLEM_KIND[problem.kind].label}
          </span>
          <span aria-hidden>·</span>
          {points(problem.points)}
          <DifficultyBadge eventId={eventId} difficulty={problem.difficulty} />
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="About this problem"
            tooltip="About this problem"
            onClick={() => setInfo(true)}
          >
            <IconInfoCircle />
          </Button>
        </span>
      }
      leading={
        <Button
          size="icon-sm"
          variant="ghost"
          tooltip="Back to problems"
          aria-label="Back to problems"
          nativeButton={false}
          render={<Link to="/problems" />}
        >
          <IconArrowLeft />
        </Button>
      }
      actions={
        <div className="flex gap-2">
          {jury ? (
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link to="/jury" splat={problem.slug} />}
            >
              Edit
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
      return `Each test or group of tests that passes adds to the problem's points; your ${settings.scoreFrom === "last" ? "last judged" : "best"} solution counts.${board}`;
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
              <div key={sample.ordinal} className="grid gap-3 sm:grid-cols-2">
                <OutputBlock
                  title={`Input ${sample.ordinal}`}
                  text={sample.input}
                  className="bg-muted/10"
                  contentClassName="scroll-fade-100"
                  emptyText="(no input)"
                />
                <OutputBlock
                  title="Expected output"
                  text={sample.answer}
                  contentClassName="scroll-fade-100"
                  emptyText="(no output)"
                />
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
  const goTo = useGoTo();
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
  const [panel, setPanel] = useState<"input" | "output">("input");
  const stopper = useRef<AbortController | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const typing = settings.allowEditor || !settings.allowUpload;
  const uploading = settings.allowUpload;

  const tries = useQuery({
    ...myAttemptsQueryOptions(eventId, problem.id),
    enabled: competing,
    refetchInterval: (query) => untilJudged(query.state.data),
  });
  useVerdictSignals(eventId, tries.data);
  const used = tries.data?.length ?? 0;
  const outOfTries = settings.attemptLimit > 0 && used >= settings.attemptLimit;
  const waiting = settings.waitForJudging && (tries.data ?? []).some(isJudging);
  const blocked = !competing
    ? jury
      ? "You're on the jury. Run code here, and test solutions on the Jury page."
      : "Only participants' solutions are judged."
    : !contest.running
      ? "The contest isn't running, so solutions can't be submitted."
      : outOfTries
        ? "You've used every try for this problem."
        : waiting
          ? "Your last solution is still being judged. You can send another once it has a verdict."
          : null;

  const submit = useMutation({
    mutationFn: () =>
      submitSolution({ problemId: problem.id, language: language?.key ?? "", source }),
    onSuccess: async (solution) => {
      signals.emit("submitted", eventId);
      await queryClient.invalidateQueries({ queryKey: ["challenges", "attempts", eventId] });
      await goTo("/submissions", { splat: solution });
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
    setPanel("output");
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
    setPanel("output");
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
              tooltip={previewable ? undefined : "This language can't run in the browser"}
              onClick={() => void runOne()}
            >
              <IconPlayerPlay />
              Run
            </Button>
          )}
          <Button
            disabled={!!blocked || !source.trim() || !language || submit.isPending}
            tooltip={blocked}
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

      <Tabs
        value={panel}
        onValueChange={(next: "input" | "output") => setPanel(next)}
        className="gap-3 rounded-2xl border border-border p-4"
      >
        <div className="flex flex-wrap items-center gap-2">
          <TabsList variant="default">
            <TabsTrigger value="input">Input</TabsTrigger>
            <TabsTrigger value="output">
              Output
              {running && <Spinner className="size-3.5" />}
            </TabsTrigger>
          </TabsList>
          <div className="ml-auto flex items-center gap-2">
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
              onChange={(next) => {
                setChoice(next);
                setPanel("input");
              }}
            />
            {sampleList.length > 1 && (
              <Button
                size="sm"
                variant="ghost"
                disabled={!previewable || running || !source.trim()}
                tooltip={previewable ? undefined : "This language can't run in the browser"}
                onClick={() => void runAll()}
              >
                <IconPlayerPlayFilled />
                Run all samples
              </Button>
            )}
          </div>
        </div>
        <TabsContent value="input" className="flex flex-col gap-3">
          <Textarea
            aria-label="Standard input"
            rows={4}
            className="font-mono text-xs"
            value={stdin}
            readOnly={choice !== "custom"}
            placeholder={
              choice === "custom" ? "Type the input your program should read." : "(no input)"
            }
            onChange={(event) => setCustom(event.target.value)}
          />
          {!previewable && (
            <p className="text-sm text-muted-fg">
              {language?.name ?? "This language"} can't run in the browser. Submit it to be judged.
            </p>
          )}
        </TabsContent>
        <TabsContent value="output" className="flex min-h-24 flex-col gap-3">
          {running && !all && (
            <p className="flex items-center gap-2 text-sm text-muted-fg" aria-live="polite">
              <Spinner className="size-4" />
              Running...
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
          {run && !running && <RunOutput outcome={run} separate={settings.separateErrors} />}
          {!run && !all && !running && (
            <p className="text-sm text-muted-fg">Run your code to see its output.</p>
          )}
        </TabsContent>
      </Tabs>

      {competing && (
        <LatestTry
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
          <OutputBlock title="Output" text={result.stdout} className="max-h-60" />
          <div className="flex min-w-0 flex-col gap-2">
            <OutputBlock
              title="Errors"
              text={stderr}
              variant={stderr ? "destructive" : "default"}
              className="max-h-60"
            />
            {fullToggle}
          </div>
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-2">
          <CodeBlock size="sm">
            <CodeBlockHeader>
              <CodeBlockTitle>Output</CodeBlockTitle>
              <CodeBlockActions>
                {(result.stdout || stderr) && (
                  <CodeBlockCopyButton value={result.stdout + stderr} />
                )}
              </CodeBlockActions>
            </CodeBlockHeader>
            <CodeBlockContent wrap aria-label="Output" className="max-h-60 min-h-24">
              {result.stdout}
              {stderr && <span className="text-destructive">{stderr}</span>}
              {!result.stdout && !result.stderr && (
                <span className="text-muted-fg">Nothing was printed.</span>
              )}
            </CodeBlockContent>
          </CodeBlock>
          {fullToggle}
        </div>
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
