import { Fragment, useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  IconArrowLeft,
  IconCircleCheck,
  IconCircleDashed,
  IconCircleX,
  IconEdit,
  IconEyeOff,
  IconFileText,
  IconLoader2,
  IconPlayerPlay,
  IconPlayerStopFilled,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react";
import { toSlug } from "@bogey/utils/keys";
import { cn } from "@bogey/ui/lib/utils";
import { Badge } from "@bogey/ui/components/badge";
import { Button } from "@bogey/ui/components/button";
import { CodeEditor, DEFAULT_EDITOR_SETTINGS } from "@bogey/ui/components/code-editor";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@bogey/ui/components/collapsible";
import { EditableList, EditableListItem } from "@bogey/ui/components/editable-list";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { RelativeTime } from "@bogey/ui/components/relative-time";
import { Screen } from "@bogey/ui/components/screen";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@bogey/ui/components/table";
import {
  appFormOptions,
  errorVisibility,
  FieldSelect,
  fieldHelp,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { FileDrop } from "@bogey/ui/components/file-drop";
import {
  addAttachment,
  attachmentsQueryOptions,
  deleteProblem,
  DIFFICULTY_TONES,
  difficultiesQueryOptions,
  languagesQueryOptions,
  problemsQueryOptions,
  recentAttemptsQueryOptions,
  rejudge,
  removeAttachment,
  setIgnored,
  saveDifficulties,
  saveProblem,
  saveProblemOrder,
  setStatementPdf,
  uploadStatementPdf,
  saveTestcases,
  teamNamesQueryOptions,
  testcasesQueryOptions,
  type DifficultyDef,
  type Problem,
  type Testcase,
} from "../db.ts";
import { JurySolutions, Rejudgings, Verification } from "./jury-tools.tsx";
import { ContestExport, ImportPackage, ProblemPackage } from "./package-tools.tsx";
import { isPreviewSupported, runClientPreview, sameOutput } from "../preview-runner.ts";
import { TestResults } from "../contest/results.tsx";
import { PROBLEM_KINDS } from "../db.ts";
import {
  allowedLanguages,
  DifficultyBadge,
  editorLanguage,
  idProblem,
  ID_KINDS,
  Link,
  KIND_FOR_SCORING,
  MEASURE_NOUN,
  nextId,
  OutputBlock,
  PROBLEM_KIND,
  points,
  TONE_CLASS,
  useDifficulties,
  useGoTo,
  useProblems,
  VerdictBadge,
  type Settings,
} from "../shared.tsx";

export function JuryHome({ eventId, settings }: { eventId: string; settings: Settings }) {
  const queryClient = useQueryClient();
  const problems = useProblems(eventId, settings.problemOrder);
  const recent = useQuery({
    ...recentAttemptsQueryOptions(eventId),
    refetchInterval: (query) =>
      query.state.data?.some((attempt) => !attempt.verdict) ? 5_000 : 30_000,
  });
  const teams = useQuery(teamNamesQueryOptions(eventId));
  const labels = new Map((problems.data ?? []).map((problem) => [problem.id, problem.label]));
  const again = useMutation({
    mutationFn: rejudge,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["challenges", "rejudgings", eventId] }),
  });
  const ignore = useMutation({
    mutationFn: setIgnored,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: recentAttemptsQueryOptions(eventId).queryKey }),
  });

  return (
    <Screen
      title="Jury"
      width="wide"
      description="Write the problems and their tests, try your own solutions against them, and watch what teams submit."
      actions={
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link to="/scoreboard" />}
          >
            Scoreboard
          </Button>
          <Button size="sm" nativeButton={false} render={<Link to="/jury" splat="new" />}>
            <IconPlus />
            Add a problem
          </Button>
        </div>
      }
    >
      <ErrorAlert error={again.error ?? ignore.error} title="Couldn't do that" />
      <Screen.Section title="Problems">
        {problems.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : (problems.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-fg">No problems yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">ID</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Difficulty</TableHead>
                  <TableHead>Worth</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {problems.data?.map((problem) => (
                  <TableRow key={problem.id}>
                    <TableCell className="font-mono">{problem.label}</TableCell>
                    <TableCell className="font-medium">
                      <Link to="/jury" splat={problem.slug}>
                        {problem.title}
                      </Link>
                      {!problem.visible && (
                        <Badge variant="outline" className="ml-2">
                          Hidden
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <DifficultyBadge eventId={eventId} difficulty={problem.difficulty} />
                    </TableCell>
                    <TableCell className="text-muted-fg">{points(problem.points)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        render={<Link to="/problems" splat={problem.slug} />}
                      >
                        <IconEdit />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={again.isPending}
                        confirm={{
                          title: `Rejudge every solution to ${problem.label}?`,
                          description:
                            "Each goes back in the runner's queue. The new verdicts wait under Rejudging until you apply them.",
                          label: "Rejudge",
                          variant: "default",
                        }}
                        onClick={() =>
                          again.mutate({
                            eventId,
                            problemId: problem.id,
                            reason: `Every solution to ${problem.label}`,
                          })
                        }
                      >
                        <IconRefresh />
                        Rejudge...
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Screen.Section>

      {settings.problemOrder === "custom" && (problems.data?.length ?? 0) > 1 && (
        <ProblemOrder eventId={eventId} problems={problems.data ?? []} />
      )}

      <ImportPackage eventId={eventId} next={nextId(settings.idKind, problems.data ?? [])} />

      <ContestExport eventId={eventId} />

      <Difficulties eventId={eventId} />

      <Rejudgings eventId={eventId} problems={problems.data ?? []} />

      {settings.verificationRequired && <Verification eventId={eventId} />}

      <Screen.Section
        title="Solutions"
        description="Newest first. Open one for each test's input, output and verdict."
      >
        {recent.isPending ? (
          <Skeleton className="h-48 w-full" />
        ) : (recent.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-fg">Nothing submitted yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border border-y border-border">
            {recent.data?.map((attempt) => (
              <li key={attempt.id}>
                <Collapsible>
                  <div className="flex items-center gap-3 py-2 text-sm">
                    <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      <span className={cn("w-8 font-mono", attempt.ignored && "line-through")}>
                        {labels.get(attempt.problemId) ?? "?"}
                      </span>
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate font-medium",
                          attempt.ignored && "text-muted-fg line-through",
                        )}
                      >
                        {teams.data?.get(attempt.teamId) ?? "A team"}
                      </span>
                      <span className="text-muted-fg">
                        {attempt.language} · <RelativeTime value={attempt.submittedAt} />
                      </span>
                      <VerdictBadge attempt={attempt} />
                      {attempt.ignored && <Badge variant="outline">Ignored</Badge>}
                      {settings.verificationRequired && attempt.verdict && !attempt.verified && (
                        <Badge variant="secondary">Unverified</Badge>
                      )}
                    </CollapsibleTrigger>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Rejudge this solution..."
                      title="Rejudge..."
                      disabled={again.isPending}
                      onClick={() =>
                        again.mutate({
                          eventId,
                          solutionId: attempt.id,
                          reason: "One solution rejudged",
                        })
                      }
                    >
                      <IconRefresh />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={
                        attempt.ignored
                          ? "Stop ignoring this solution..."
                          : "Ignore this solution..."
                      }
                      title={attempt.ignored ? "Stop ignoring..." : "Ignore..."}
                      disabled={ignore.isPending}
                      confirm={{
                        title: attempt.ignored
                          ? "Count this solution again?"
                          : "Ignore this solution?",
                        description: attempt.ignored
                          ? "It scores on the scoreboard again."
                          : "It stops counting on the scoreboard and shows struck through here. Nothing is deleted.",
                        label: attempt.ignored ? "Count it" : "Ignore",
                        variant: "default",
                      }}
                      onClick={() =>
                        ignore.mutate({ solutionId: attempt.id, ignored: !attempt.ignored })
                      }
                    >
                      <IconEyeOff />
                    </Button>
                  </div>
                  <CollapsibleContent className="pb-4">
                    <TestResults solutionId={attempt.id} judged={attempt.verdict !== null} />
                  </CollapsibleContent>
                </Collapsible>
              </li>
            ))}
          </ul>
        )}
      </Screen.Section>
    </Screen>
  );
}

function ProblemOrder({ eventId, problems }: { eventId: string; problems: Tuple<Problem> }) {
  const queryClient = useQueryClient();
  const order = useMutation({
    mutationFn: (ids: Tuple<string>) => saveProblemOrder(ids),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: problemsQueryOptions(eventId).queryKey }),
  });
  return (
    <Screen.Section
      title="Order"
      description="Drag problems into the order teams see them in. This event orders them manually; switch it back to ID order in Manage → Plugins."
    >
      <ErrorAlert error={order.error} title="Couldn't save the order" />
      <EditableList
        onMove={(from, to) => {
          const ids = problems.map((problem) => problem.id);
          const [moved] = ids.splice(from, 1);
          if (moved) ids.splice(to, 0, moved);
          order.mutate(ids);
        }}
      >
        {problems.map((problem, index) => (
          <EditableListItem
            key={problem.id}
            id={problem.id}
            index={index}
            noun={`${problem.label}. ${problem.title}`}
            numbered={false}
            preview={
              <span className="flex items-center gap-3 text-sm">
                <span className="w-10 font-mono font-medium">{problem.label}</span>
                <span className="truncate">{problem.title}</span>
              </span>
            }
            editing={false}
          >
            {null}
          </EditableListItem>
        ))}
      </EditableList>
    </Screen.Section>
  );
}

const difficultiesSchema = z.object({
  difficulties: z
    .array(
      z.object({
        uid: z.string(),
        key: z.string(),
        label: z.string().trim().min(1, "Name it").max(40, "Keep it under 40 characters"),
        tone: z.enum(DIFFICULTY_TONES),
      }),
    )
    .max(12, "Up to 12 difficulties"),
});

const STARTER: Tuple<Omit<DifficultyDef, "sort">> = [
  { key: "easy", label: "Easy", tone: "green" },
  { key: "medium", label: "Medium", tone: "amber" },
  { key: "hard", label: "Hard", tone: "red" },
];

function Difficulties({ eventId }: { eventId: string }) {
  const difficulties = useQuery(difficultiesQueryOptions(eventId));
  if (difficulties.isPending) return <Skeleton className="h-24 w-full" />;
  return (
    <DifficultiesForm
      key={difficulties.dataUpdatedAt}
      eventId={eventId}
      current={difficulties.data ?? []}
    />
  );
}

function DifficultiesForm({
  eventId,
  current,
}: {
  eventId: string;
  current: Tuple<DifficultyDef>;
}) {
  const queryClient = useQueryClient();
  const [active, setActive] = useState<string | null>(null);
  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: {
        difficulties: current.map((each) => ({
          uid: each.key,
          key: each.key,
          label: each.label,
          tone: each.tone, // TODO: add color picker
        })),
      },
      errorVisibility,
      validators: [rewardEarlyPunishLate(difficultiesSchema)],
    }),
    onSubmit: async ({ value, createValidationError }) => {
      const used = new Set(value.difficulties.map((each) => each.key).filter(Boolean));
      const next = value.difficulties.map((each) => {
        if (each.key) return each;
        const base = toSlug(each.label, 32) || "level";
        let key = base;
        for (let n = 2; used.has(key); n++) key = `${base}-${n}`;
        used.add(key);
        return { ...each, key };
      });
      try {
        await saveDifficulties(eventId, next);
      } catch (error) {
        return createValidationError(
          error instanceof Error ? error.message : "Couldn't save them.",
        );
      }
      setActive(null);
      await queryClient.invalidateQueries({
        queryKey: difficultiesQueryOptions(eventId).queryKey,
      });
      await queryClient.invalidateQueries({ queryKey: problemsQueryOptions(eventId).queryKey });
      return undefined;
    },
  });

  return (
    <Screen.Section
      title="Difficulties"
      description="What problems can be marked as, for this event. Removing one clears it from the problems that had it."
    >
      <form.AppForm>
        <form.SaveBarEntry />
        <form.Form className="flex flex-col gap-3">
          <form.Field name="difficulties">
            {(list) => (
              <>
                <EditableList
                  onMove={(from, to) => list.moveValue(from, to)}
                  empty="No difficulties yet, so problems show none."
                >
                  {list.value.map((item, index) => (
                    <EditableListItem
                      key={item.uid}
                      id={item.uid}
                      index={index}
                      noun="difficulty"
                      numbered={false}
                      onRemove={() => list.removeValue(index)}
                      confirmRemove={
                        item.key
                          ? "Problems marked with it will have none until you pick another. Applies when you save."
                          : undefined
                      }
                      preview={
                        <span
                          className={cn(
                            "inline-flex rounded-md px-2 py-0.5 text-xs font-medium",
                            TONE_CLASS[item.tone],
                          )}
                        >
                          {item.label || "Untitled"}
                        </span>
                      }
                      editing={active === item.uid || !item.label.trim()}
                      onEdit={() => setActive(item.uid)}
                      onDone={() => setActive(null)}
                    >
                      <div className="grid gap-4 sm:grid-cols-2">
                        <form.Field name={`difficulties[${index}].label`}>
                          {(field) => <field.TextField label="Name" placeholder="Easy" />}
                        </form.Field>
                        <form.Field name={`difficulties[${index}].tone`}>
                          {(field) => (
                            <field.Field>
                              <field.Label>Color</field.Label>
                              <FieldSelect
                                field={field}
                                options={DIFFICULTY_TONES.map((tone) => ({
                                  value: tone,
                                  label: tone.charAt(0).toUpperCase() + tone.slice(1),
                                }))}
                              />
                            </field.Field>
                          )}
                        </form.Field>
                      </div>
                    </EditableListItem>
                  ))}
                </EditableList>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={list.value.length >= 12}
                    onClick={() => {
                      const uid = crypto.randomUUID();
                      list.pushValue({ uid, key: "", label: "", tone: "gray" });
                      setActive(uid);
                    }}
                  >
                    <IconPlus />
                    Add a difficulty
                  </Button>
                  {list.value.length === 0 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        STARTER.forEach((each) =>
                          list.pushValue({
                            uid: each.key,
                            key: "",
                            label: each.label,
                            tone: each.tone,
                          }),
                        )
                      }
                    >
                      Use defaults
                    </Button>
                  )}
                </div>
              </>
            )}
          </form.Field>
          <form.FormAlert title="Couldn't save the difficulties" />
        </form.Form>
      </form.AppForm>
    </Screen.Section>
  );
}

const STATEMENT_KINDS = [
  { value: "text", label: "Write it" },
  { value: "pdf", label: "Upload a PDF" },
] as const;

function problemSchema(settings: Settings, pdfPath: string | null) {
  const kind = ID_KINDS[settings.idKind];
  return z
    .object({
      label: z
        .string()
        .trim()
        .superRefine((value, ctx) => {
          const problem = idProblem(settings.idKind, value);
          if (problem) ctx.addIssue({ code: "custom", message: problem });
        })
        .meta({ label: "ID", placeholder: kind.placeholder })
        .describe(kind.label),
      slug: z
        .string()
        .trim()
        .regex(/^([a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?)?$/, "Lowercase letters, digits and dashes")
        .meta({ label: "URL name", placeholder: "two-sum" })
        .register(
          fieldHelp,
          (slug) => `Its page is /problem/${slug || "(slug)"}. Uses the title by default.`,
        ),
      title: z
        .string()
        .trim()
        .min(1, "Give it a title")
        .max(120, "Keep it under 120 characters")
        .meta({ label: "Title", placeholder: "Two Sum" }),
      difficulty: z.string().meta({ label: "Difficulty" }),
      kind: z.enum(["pass_fail", "partial", "shortest"]).meta({ label: "Type" }),
      points: z.number().min(0, "0 or more").max(100_000).meta({ label: "Points" }),
      timeLimitMs: z
        .int()
        .min(100, "At least 100 ms")
        .max(60_000, "At most 60 seconds")
        .meta({ label: "Time (ms)" }),
      memoryLimitMb: z
        .int()
        .min(16, "At least 16 MB")
        .max(4096, "At most 4096 MB")
        .meta({ label: "Memory (MB)" }),
      outputLimitKb: z
        .int()
        .min(1, "At least 1 KB")
        .max(65_536, "At most 64 MB")
        .meta({ label: "Output (KB)" }),
      visible: z
        .boolean()
        .meta({ label: "Visible to participants" })
        .describe("While the contest runs. The jury can see all problems."),
      sort: z
        .int()
        .min(-1000)
        .max(1000)
        .meta({ label: "Position" })
        .describe("Lower comes first. Easier to drag them into place on the Jury page."),
      golfBrackets: z
        .array(
          z.object({
            max: z
              .int("A whole number")
              .min(1, "At least 1")
              .max(1_000_000)
              .meta({ label: "Up to" }),
            points: z.number("A number").min(0, "0 or more").max(100_000).meta({ label: "Points" }),
          }),
        )
        .max(20, "At most 20 ranges")
        .superRefine((ranges, ctx) => {
          const seen = new Set<number>();
          ranges.forEach((range, index) => {
            if (seen.has(range.max)) {
              ctx.addIssue({
                code: "custom",
                path: [index, "max"],
                message: "Two ranges end here",
              });
            }
            seen.add(range.max);
          });
        }),
      statementKind: z.enum(["text", "pdf"]).meta({ label: "Statement" }),
      statement: z.string().max(100_000).meta({
        label: "Statement",
        placeholder: "What to read (stdin), what to print (stdout), and the limits on the input.",
      }),
      statementPdf: z
        .instanceof(File)
        .nullable()
        .meta({ label: "Statement PDF" })
        .describe("Up to 20 MB. Participants see it in the page and can download it."),
    })
    .superRefine((value, ctx) => {
      if (value.statementKind === "pdf" && !value.statementPdf && !pdfPath) {
        ctx.addIssue({ code: "custom", path: ["statementPdf"], message: "Choose the PDF" });
      }
    });
}

type ProblemValues = z.infer<ReturnType<typeof problemSchema>>;

function valuesOf(problem: Problem | undefined, next: string, settings: Settings): ProblemValues {
  return {
    label: problem?.label ?? next,
    slug: problem?.slug ?? "",
    title: problem?.title ?? "",
    difficulty: problem?.difficulty ?? "none",
    points: problem?.points ?? 100,
    golfBrackets: problem?.golf_brackets ?? [],
    kind: problem?.kind ?? KIND_FOR_SCORING[settings.scoring],
    timeLimitMs: problem?.time_limit_ms ?? 2000,
    memoryLimitMb: problem?.memory_limit_mb ?? 256,
    outputLimitKb: problem?.output_limit_kb ?? 8192,
    visible: problem?.visible ?? true,
    sort: problem?.sort ?? 0,
    statementKind: problem?.statement_pdf_path ? "pdf" : "text",
    statement: problem?.statement_md ?? "",
    statementPdf: null,
  };
}

function seconds(ms: number): string {
  return ms % 1000 === 0 ? `${ms / 1000} second${ms === 1000 ? "" : "s"}` : `${ms} ms`;
}

// The limits as they are when the button is pressed, for the statement to quote.
function limitsMarkdown(
  values: Pick<ProblemValues, "timeLimitMs" | "memoryLimitMb" | "outputLimitKb">,
) {
  const output =
    values.outputLimitKb % 1024 === 0
      ? `${values.outputLimitKb / 1024} MB`
      : `${values.outputLimitKb} KB`;
  return [
    "## Limits",
    "",
    `- Time: ${seconds(values.timeLimitMs)} per test`,
    `- Memory: ${values.memoryLimitMb} MB`,
    `- Output: ${output}`,
  ].join("\n");
}

export function ProblemEditor({
  eventId,
  settings,
  problem,
}: {
  eventId: string;
  settings: Settings;
  problem: Problem | undefined;
}) {
  const problems = useProblems(eventId, settings.problemOrder);
  return (
    <Screen
      title={problem ? `${problem.label}. ${problem.title}` : "New problem"}
      width="wide"
      actions={
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" nativeButton={false} render={<Link to="/jury" />}>
            <IconArrowLeft />
            Jury
          </Button>
          {problem && (
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link to="/problems" splat={problem.slug} />}
            >
              Participant view
            </Button>
          )}
        </div>
      }
    >
      <ProblemForm
        key={problem?.id ?? "new"}
        eventId={eventId}
        settings={settings}
        problem={problem}
        next={nextId(settings.idKind, problems.data ?? [])}
      />
      {problem && (
        <>
          <Tests eventId={eventId} problem={problem} />
          <TrySolution problem={problem} settings={settings} />
          <JurySolutions eventId={eventId} problem={problem} />
          <Files eventId={eventId} problem={problem} />
          <ProblemPackage eventId={eventId} problem={problem} />
          <RemoveProblem eventId={eventId} problem={problem} />
        </>
      )}
    </Screen>
  );
}

function ProblemForm({
  eventId,
  settings,
  problem,
  next,
}: {
  eventId: string;
  settings: Settings;
  problem: Problem | undefined;
  next: string;
}) {
  const queryClient = useQueryClient();
  const goTo = useGoTo();
  const difficulties = useDifficulties(eventId);
  const pdfPath = problem?.statement_pdf_path ?? null;
  const schema = problemSchema(settings, pdfPath);
  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: valuesOf(problem, next, settings),
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const slug = value.slug.trim() || toSlug(value.title, 64) || toSlug(value.label, 64);
      try {
        const id = await saveProblem(eventId, problem?.id ?? null, {
          label: value.label.trim(),
          slug,
          title: value.title.trim(),
          difficulty: value.difficulty === "none" ? null : value.difficulty,
          points: value.points,
          golf_brackets: [...value.golfBrackets].sort((a, b) => a.max - b.max),
          kind: value.kind,
          time_limit_ms: value.timeLimitMs,
          memory_limit_mb: value.memoryLimitMb,
          output_limit_kb: value.outputLimitKb,
          visible: value.visible,
          sort: value.sort,
          statement_md: value.statement,
        });
        const nextPdf =
          value.statementKind === "text"
            ? null
            : value.statementPdf
              ? await uploadStatementPdf(eventId, id, value.statementPdf)
              : pdfPath;
        if (nextPdf !== pdfPath) await setStatementPdf(id, nextPdf, pdfPath);
        formApi.setFieldValue("statementPdf", null);
      } catch (error) {
        return createValidationError(error instanceof Error ? error.message : "Couldn't save it.");
      }
      await queryClient.invalidateQueries({ queryKey: problemsQueryOptions(eventId).queryKey });
      if (!problem || problem.slug !== slug) {
        await goTo("/jury", { splat: slug, replace: true });
      }
      return undefined;
    },
  });

  return (
    <Screen.Section title="Problem">
      <form.AppForm>
        {problem ? <form.SaveBarEntry /> : <form.DraftGuard />}
        <form.Form className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)]">
            <form.Field name="label">{(field) => <field.TextField required />}</form.Field>
            <form.Field name="title">{(field) => <field.TextField required />}</form.Field>
            <form.Field name="slug">{(field) => <field.TextField />}</form.Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="difficulty">
              {(field) => (
                <field.Field>
                  <field.Label />
                  <FieldSelect
                    field={field}
                    options={[
                      { value: "none", label: "Not shown" },
                      ...difficulties.map((each) => ({ value: each.key, label: each.label })),
                    ]}
                  />
                  {difficulties.length === 0 && (
                    <field.Description>
                      Add difficulties on the Jury page to choose from.
                    </field.Description>
                  )}
                </field.Field>
              )}
            </form.Field>
            <form.Field name="kind">
              {(field) => (
                <field.Field>
                  <field.Label />
                  <FieldSelect
                    field={field}
                    options={PROBLEM_KINDS.map((kind) => ({
                      value: kind,
                      label: PROBLEM_KIND[kind].label,
                      description: PROBLEM_KIND[kind].description,
                    }))}
                  />
                </field.Field>
              )}
            </form.Field>
          </div>
          <form.Subscribe selector={(state) => state.values.kind}>
            {(kind) =>
              !(kind === "shortest" && settings.golfPoints === "brackets") && (
                <form.Field name="points">
                  {(field) => (
                    <field.NumberField
                      min={0}
                      max={100_000}
                      label={kind === "shortest" ? "Points for the shortest" : undefined}
                    />
                  )}
                </form.Field>
              )
            }
          </form.Subscribe>
          <form.Subscribe selector={(state) => state.values.kind}>
            {(kind) =>
              kind === "shortest" &&
              settings.golfPoints === "brackets" && (
                <form.Field name="golfBrackets">
                  {(list) => (
                    <fieldset className="flex flex-col gap-3 rounded-2xl border border-border p-4">
                      <legend className="px-1 text-sm font-medium">Points by length</legend>
                      <p className="text-xs text-muted-fg">
                        A solution earns the points of the smallest range it fits, counted in{" "}
                        {MEASURE_NOUN[settings.golfMeasure]}. Longer than every range earns 0.
                      </p>
                      {list.value.map((_range, index) => (
                        <div key={index} className="flex items-end gap-2">
                          <form.Field name={`golfBrackets[${index}].max`}>
                            {(field) => <field.NumberField min={1} max={1_000_000} />}
                          </form.Field>
                          <form.Field name={`golfBrackets[${index}].points`}>
                            {(field) => <field.NumberField min={0} max={100_000} />}
                          </form.Field>
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            className="mb-1 text-destructive"
                            aria-label="Remove this range"
                            title="Remove this range"
                            onClick={() => list.removeValue(index)}
                          >
                            <IconTrash />
                          </Button>
                        </div>
                      ))}
                      <div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const last = list.value.at(-1);
                            list.pushValue({
                              max: last ? last.max * 2 : 100,
                              points: last ? Math.max(0, Math.round(last.points / 2)) : 100,
                            });
                          }}
                        >
                          <IconPlus />
                          Add a range
                        </Button>
                      </div>
                    </fieldset>
                  )}
                </form.Field>
              )
            }
          </form.Subscribe>
          <fieldset className="flex flex-col gap-3 rounded-2xl border border-border p-4">
            <legend className="px-1 text-sm font-medium">Limits for this problem</legend>
            <div className="grid gap-4 sm:grid-cols-3">
              <form.Field name="timeLimitMs">
                {(field) => <field.NumberField min={100} max={60_000} step={100} />}
              </form.Field>
              <form.Field name="memoryLimitMb">
                {(field) => <field.NumberField min={16} max={4096} />}
              </form.Field>
              <form.Field name="outputLimitKb">
                {(field) => <field.NumberField min={1} max={65_536} />}
              </form.Field>
            </div>
            <p className="text-xs text-muted-fg">
              Limits per test. A problem attempting to use more won't save, and one saved before the
              cap runs at the cap.
            </p>
          </fieldset>
          <form.Field name="statementKind">
            {(field) => (
              <field.Field>
                <field.Label />
                <FieldSelect field={field} options={STATEMENT_KINDS} />
              </field.Field>
            )}
          </form.Field>
          <form.Subscribe selector={(state) => state.values.statementKind}>
            {(statementKind) =>
              statementKind === "pdf" ? (
                <form.Field name="statementPdf">
                  {(field) => (
                    <field.Field>
                      <field.Label />
                      <FileDrop
                        id={field.name}
                        accept="application/pdf,.pdf"
                        maxMb={20}
                        multiple={false}
                        invalid={field.meta.isInvalid}
                        files={
                          field.value
                            ? [{ id: "new", name: field.value.name, sizeBytes: field.value.size }]
                            : []
                        }
                        onAdd={([file]) => field.handleChange(file ?? null)}
                        onRemove={() => field.handleChange(null)}
                      />
                      {pdfPath && !field.value ? (
                        <field.Description>
                          A PDF is saved. Drop another to replace it.
                        </field.Description>
                      ) : (
                        <field.Description />
                      )}
                      <field.Error />
                    </field.Field>
                  )}
                </form.Field>
              ) : (
                <form.Field name="statement">
                  {(field) => (
                    <field.MarkdownField
                      rows={12}
                      actions={
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            const current = field.value.trimEnd();
                            const limits = limitsMarkdown({
                              timeLimitMs: form.getFieldValue("timeLimitMs"),
                              memoryLimitMb: form.getFieldValue("memoryLimitMb"),
                              outputLimitKb: form.getFieldValue("outputLimitKb"),
                            });
                            field.handleChange(
                              current ? `${current}\n\n${limits}\n` : `${limits}\n`,
                            );
                          }}
                        >
                          <IconPlus />
                          Add limits
                        </Button>
                      }
                    />
                  )}
                </form.Field>
              )
            }
          </form.Subscribe>
          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="visible">{(field) => <field.SwitchField />}</form.Field>
            {settings.problemOrder === "custom" && (
              <form.Field name="sort">
                {(field) => <field.NumberField min={-1000} max={1000} />}
              </form.Field>
            )}
          </div>
          <form.FormAlert title="Couldn't save the problem" />
          {!problem && (
            <div>
              <form.Submit pending="Adding...">Add the problem</form.Submit>
            </div>
          )}
        </form.Form>
      </form.AppForm>
    </Screen.Section>
  );
}

const testSchema = z.object({
  uid: z.string(),
  isSample: z.boolean(),
  input: z.string().max(16 * 1024 * 1024),
  answer: z.string().max(16 * 1024 * 1024),
  points: z.string().regex(/^\s*(\d+(\.\d+)?)?\s*$/, "A number, or empty"),
});

const testsSchema = z.object({ tests: z.array(testSchema).max(200, "Up to 200 tests") });

function testValues(cases: Tuple<Testcase>) {
  return {
    tests: cases.map((each) => ({
      uid: each.id,
      isSample: each.is_sample,
      input: each.input,
      answer: each.answer,
      points: each.points === null ? "" : String(each.points),
    })),
  };
}

function Tests({ eventId, problem }: { eventId: string; problem: Problem }) {
  const cases = useQuery(testcasesQueryOptions(problem.id));
  if (cases.isPending) return <Skeleton className="h-32 w-full" />;
  if (cases.isError) {
    return (
      <ErrorAlert
        error={cases.error instanceof Error ? cases.error : null}
        title="Couldn't load the tests"
      />
    );
  }
  return (
    <TestsForm key={cases.dataUpdatedAt} eventId={eventId} problem={problem} cases={cases.data} />
  );
}

function TestsForm({
  problem,
  cases,
}: {
  eventId: string;
  problem: Problem;
  cases: Tuple<Testcase>;
}) {
  const queryClient = useQueryClient();
  const [active, setActive] = useState<string | null>(null);
  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: testValues(cases),
      errorVisibility,
      validators: [rewardEarlyPunishLate(testsSchema)],
    }),
    onSubmit: async ({ value, createValidationError }) => {
      try {
        await saveTestcases(
          problem.id,
          value.tests.map((each) => ({
            is_sample: each.isSample,
            input: each.input,
            answer: each.answer,
            points: each.points.trim() ? Number(each.points) : null,
          })),
        );
      } catch (error) {
        return createValidationError(
          error instanceof Error ? error.message : "Couldn't save them.",
        );
      }
      setActive(null);
      await queryClient.invalidateQueries({ queryKey: testcasesQueryOptions(problem.id).queryKey });
      return undefined;
    },
  });

  return (
    <Screen.Section
      title="Tests"
      description="Every solution runs against all of them. Samples are shown to participants with their answers; the rest stay hidden."
    >
      <form.AppForm>
        <form.SaveBarEntry />
        <form.Form className="flex flex-col gap-3">
          <form.Field name="tests">
            {(list) => (
              <>
                <EditableList onMove={(from, to) => list.moveValue(from, to)} empty="No tests yet.">
                  {list.value.map((test, index) => (
                    <EditableListItem
                      key={test.uid}
                      id={test.uid}
                      index={index}
                      noun="test"
                      onRemove={() => list.removeValue(index)}
                      onDuplicate={() =>
                        list.insertValue(index + 1, { ...test, uid: crypto.randomUUID() })
                      }
                      preview={
                        <div className="flex min-w-0 flex-col gap-1.5 text-sm">
                          <span className="flex items-center gap-2 font-medium">
                            {test.isSample ? "Sample" : "Hidden"}
                            {test.points.trim() && (
                              <span className="font-normal text-muted-fg">
                                · {points(Number(test.points))}
                              </span>
                            )}
                          </span>
                          <span className="truncate font-mono text-xs text-muted-fg">
                            {test.input.replace(/\s+/g, " ").slice(0, 80) || "(empty input)"} →{" "}
                            {test.answer.replace(/\s+/g, " ").slice(0, 40) || "(empty)"}
                          </span>
                        </div>
                      }
                      editing={active === test.uid}
                      onEdit={() => setActive(test.uid)}
                      onDone={() => setActive(null)}
                    >
                      <div className="flex flex-col gap-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                          <form.Field name={`tests[${index}].input`}>
                            {(field) => <field.TextAreaField label="Input" rows={6} />}
                          </form.Field>
                          <form.Field name={`tests[${index}].answer`}>
                            {(field) => <field.TextAreaField label="Expected output" rows={6} />}
                          </form.Field>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <form.Field name={`tests[${index}].isSample`}>
                            {(field) => (
                              <field.SwitchField
                                label="Sample"
                                description="Shown to participants, input and answer."
                              />
                            )}
                          </form.Field>
                          <form.Field name={`tests[${index}].points`}>
                            {(field) => (
                              <field.TextField
                                label="Points"
                                placeholder="Shared evenly"
                                description="For points scoring; empty splits the problem's."
                              />
                            )}
                          </form.Field>
                        </div>
                      </div>
                    </EditableListItem>
                  ))}
                </EditableList>
                <div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const uid = crypto.randomUUID();
                      list.pushValue({
                        uid,
                        isSample: list.value.length === 0,
                        input: "",
                        answer: "",
                        points: "",
                      });
                      setActive(uid);
                    }}
                  >
                    <IconPlus />
                    Add a test
                  </Button>
                </div>
              </>
            )}
          </form.Field>
          <form.FormAlert title="Couldn't save the tests" />
        </form.Form>
      </form.AppForm>
    </Screen.Section>
  );
}

const RUN_VERDICTS = {
  passed: "Passed",
  wrong: "Wrong answer",
  timeout: "Too slow",
  error: "Error",
} as const;

function TrySolution({ problem, settings }: { problem: Problem; settings: Settings }) {
  const cases = useQuery(testcasesQueryOptions(problem.id));
  const languages = useQuery(languagesQueryOptions());
  const allowed = allowedLanguages(languages.data ?? [], settings.languages);
  const [picked, setPicked] = useState<string | null>(null);
  const language = allowed.find((each) => each.key === picked) ?? allowed[0];
  const editor = editorLanguage(language);
  const [source, setSource] = useState("");
  const [running, setRunning] = useState(false);
  const stopper = useRef<AbortController | null>(null);
  const [results, setResults] = useState<Array<{
    test: Testcase;
    verdict: keyof typeof RUN_VERDICTS;
    ms: number | null;
    detail: string;
  }> | null>(null);

  const runAll = async () => {
    const controller = new AbortController();
    stopper.current = controller;
    setRunning(true);
    setResults(null);
    const out: NonNullable<typeof results> = [];
    for (const test of cases.data ?? []) {
      const result = await runClientPreview(
        editor,
        source,
        test.input,
        Math.max(5_000, problem.time_limit_ms * 3),
        controller.signal,
      );
      if (result.status === "stopped") break;
      if (result.status === "timeout") out.push({ test, verdict: "timeout", ms: null, detail: "" });
      else if (result.status === "error")
        out.push({ test, verdict: "error", ms: null, detail: result.message });
      else if (result.exitCode !== 0) {
        out.push({ test, verdict: "error", ms: result.ms, detail: result.stderr });
      } else {
        const passed = sameOutput(result.stdout, test.answer);
        out.push({
          test,
          verdict: passed ? "passed" : "wrong",
          ms: result.ms,
          detail: passed ? "" : result.stdout,
        });
      }
      setResults([...out]);
    }
    stopper.current = null;
    setRunning(false);
  };

  const previewable = isPreviewSupported(editor);
  const passed = results?.filter((each) => each.verdict === "passed").length ?? 0;
  const firstFailure = results?.find((each) => each.verdict !== "passed");

  return (
    <Screen.Section
      title="Try a solution"
      description="Runs your own solution against every test, hidden ones included, in a sandbox in this browser. Nothing is submitted or scored."
    >
      <div className="flex flex-wrap items-end gap-2">
        <OptSelect
          ariaLabel="Language"
          value={language?.key ?? null}
          placeholder="Pick a language"
          options={allowed.map((each) => ({
            value: each.key,
            label: `${each.name} ${each.version}`.trim(),
          }))}
          onChange={setPicked}
        />
        {running ? (
          <Button className="ml-auto" variant="outline" onClick={() => stopper.current?.abort()}>
            <IconPlayerStopFilled />
            Stop
          </Button>
        ) : (
          <Button
            className="ml-auto"
            disabled={!previewable || !source.trim() || (cases.data?.length ?? 0) === 0}
            onClick={() => void runAll()}
          >
            <IconPlayerPlay />
            Run against every test
          </Button>
        )}
      </div>
      {!previewable && (
        <p className="text-sm text-muted-fg">
          {language?.name ?? "This language"} can't run in the browser; submit through a test team
          instead.
        </p>
      )}
      <CodeEditor
        value={source}
        onChange={setSource}
        language={editor}
        placeholder="Your reference solution."
        minHeight="14rem"
        settings={{ ...DEFAULT_EDITOR_SETTINGS, tabSize: settings.editorTabSize }}
      />
      {results && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-fg">
            {passed} of {cases.data?.length ?? 0} passed{running ? " so far" : ""}.
          </p>
          <Trace>
            {(cases.data ?? []).map((test, index) => {
              const name = `${test.is_sample ? "Sample" : "Test"} ${test.ordinal}`;
              const result = results[index];
              if (!result) {
                if (!running) return null;
                const current = index === results.length;
                return (
                  <TraceLine key={test.id} status={current ? "running" : "pending"}>
                    <TraceIcon>
                      {current ? <IconLoader2 className="animate-spin" /> : <IconCircleDashed />}
                    </TraceIcon>
                    <TraceTitle>{current ? `Running ${name}` : `Run ${name}`}</TraceTitle>
                  </TraceLine>
                );
              }
              const passed = result.verdict === "passed";
              const line = (
                <TraceLine status={passed ? undefined : "error"}>
                  <TraceIcon>{passed ? <IconCircleCheck /> : <IconCircleX />}</TraceIcon>
                  <TraceTitle>
                    {name}: {RUN_VERDICTS[result.verdict]}
                  </TraceTitle>
                  {result.ms !== null && <TraceDescription>{result.ms} ms</TraceDescription>}
                </TraceLine>
              );
              if (!result.detail) return <Fragment key={test.id}>{line}</Fragment>;
              return (
                <TraceCollapsible key={test.id} defaultOpen={result === firstFailure}>
                  <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
                  <TraceCollapsibleContent>
                    <OutputBlock
                      title={result.verdict === "wrong" ? "Output" : "Errors"}
                      text={result.detail}
                      variant={result.verdict === "wrong" ? "default" : "destructive"}
                    />
                  </TraceCollapsibleContent>
                </TraceCollapsible>
              );
            })}
          </Trace>
        </div>
      )}
    </Screen.Section>
  );
}

function Files({ eventId, problem }: { eventId: string; problem: Problem }) {
  const queryClient = useQueryClient();
  const files = useQuery(attachmentsQueryOptions(problem.id));
  const input = useRef<HTMLInputElement>(null);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: attachmentsQueryOptions(problem.id).queryKey });
  const add = useMutation({
    mutationFn: (file: File) => addAttachment(eventId, problem.id, file),
    onSettled: refresh,
  });
  const remove = useMutation({ mutationFn: removeAttachment, onSettled: refresh });
  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) add.mutate(file);
  };

  return (
    <Screen.Section
      title="Files"
      description="A PDF of the statement, data files, images: participants can open them while the problem is visible."
      actions={
        <>
          <input
            ref={input}
            type="file"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={pick}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={add.isPending}
            onClick={() => input.current?.click()}
          >
            <IconUpload />
            {add.isPending ? "Uploading..." : "Upload a file"}
          </Button>
        </>
      }
    >
      <ErrorAlert error={add.error ?? remove.error} title="Couldn't change the files" />
      {(files.data?.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-fg">No files.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border border-y border-border">
          {files.data?.map((file) => (
            <li key={file.id} className="flex items-center gap-3 py-2 text-sm">
              <IconFileText className="size-4 text-muted-fg" />
              <span className="flex-1 truncate">{file.name}</span>
              <Button
                size="icon-sm"
                variant="ghost"
                className="text-destructive"
                aria-label={`Remove ${file.name}...`}
                title={`Remove ${file.name}...`}
                disabled={remove.isPending}
                confirm={{
                  title: `Remove ${file.name}?`,
                  description: "Participants can't open it any more.",
                  label: "Remove",
                }}
                onClick={() => remove.mutate(file)}
              >
                <IconTrash />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Screen.Section>
  );
}

function RemoveProblem({ eventId, problem }: { eventId: string; problem: Problem }) {
  const queryClient = useQueryClient();
  const goTo = useGoTo();
  const remove = useMutation({
    mutationFn: () => deleteProblem(problem.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: problemsQueryOptions(eventId).queryKey });
      await goTo("/jury", { replace: true });
    },
  });
  return (
    <Screen.Section title="Remove">
      <ErrorAlert error={remove.error} title="Couldn't remove the problem" />
      <div>
        <Button
          variant="destructive"
          disabled={remove.isPending}
          confirm={{
            title: `Remove ${problem.label}. ${problem.title}?`,
            description:
              "Its tests, files and every team's solutions to it go too, and the scoreboard drops it. To keep them, hide it instead.",
            label: "Remove",
          }}
          onClick={() => remove.mutate()}
        >
          <IconTrash />
          Remove this problem...
        </Button>
      </div>
    </Screen.Section>
  );
}
