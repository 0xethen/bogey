import { useRef, useState, type ComponentType, type ReactNode, type SVGProps } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCode,
  IconCopy,
  IconEye,
  IconFileText,
  IconGauge,
  IconId,
  IconListCheck,
  IconPackage,
  IconPaperclip,
  IconPlayerPlay,
  IconPlus,
  IconTerminal2,
  IconTrash,
} from "@tabler/icons-react";
import { toSlug } from "@bogey/utils/keys";
import { Button } from "@bogey/ui/components/button";
import { CodeEditor, DEFAULT_EDITOR_SETTINGS } from "@bogey/ui/components/code-editor";
import { FileDrop } from "@bogey/ui/components/file-drop";
import { Screen } from "@bogey/ui/components/screen";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from "@bogey/ui/components/sidebar";
import { Switch } from "@bogey/ui/components/switch";
import {
  appFormOptions,
  errorVisibility,
  FieldSelect,
  fieldHelp,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { cn } from "@bogey/ui/lib/utils";
import {
  languagesQueryOptions,
  problemsQueryOptions,
  saveProblem,
  scriptsQueryOptions,
  setStatementPdf,
  uploadStatementPdf,
  PROBLEM_KINDS,
  type Checker,
  type Problem,
  type Scripts,
} from "../db.ts";
import { Files, RemoveProblem, Tests, TrySolution } from "./jury.tsx";
import { JurySolutions } from "./jury-tools.tsx";
import { ProblemPackage } from "./package-tools.tsx";
import { ReuseProblem } from "./reuse.tsx";
import {
  editorLanguage,
  idProblem,
  ID_KINDS,
  KIND_FOR_SCORING,
  Link,
  MEASURE_NOUN,
  nextId,
  PROBLEM_KIND,
  useDifficulties,
  useGoTo,
  useProblems,
  type Settings,
} from "../shared.tsx";

// ── tabs ───────────────────────────────────────────────────────────────

type Tab =
  | "details"
  | "statement"
  | "limits"
  | "checking"
  | "tests"
  | "solutions"
  | "try"
  | "files"
  | "reuse"
  | "package"
  | "remove";

interface TabDef {
  key: Tab;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Saved with the problem's form; the others need the problem to exist first. */
  form?: boolean;
}

const GROUPS: Tuple<{ label: string; tabs: Tuple<TabDef> }> = [
  {
    label: "Problem",
    tabs: [
      { key: "details", label: "Details", icon: IconId, form: true },
      { key: "statement", label: "Statement", icon: IconFileText, form: true },
      { key: "limits", label: "Limits", icon: IconGauge, form: true },
    ],
  },
  {
    label: "Judging",
    tabs: [
      { key: "tests", label: "Tests", icon: IconListCheck },
      { key: "checking", label: "Checking", icon: IconTerminal2, form: true },
      { key: "solutions", label: "Jury solutions", icon: IconCode },
      { key: "try", label: "Try a solution", icon: IconPlayerPlay },
    ],
  },
  {
    label: "More",
    tabs: [
      { key: "files", label: "Files", icon: IconPaperclip },
      { key: "reuse", label: "Reuse", icon: IconCopy },
      { key: "package", label: "Package", icon: IconPackage },
      { key: "remove", label: "Remove", icon: IconTrash },
    ],
  },
];

const TABS = GROUPS.flatMap((group) => group.tabs);
const isTab = (value: string): value is Tab => TABS.some((tab) => tab.key === value);

/** The open tab is the address's hash (`/jury/two-sum#tests`), so a tab can be linked to. */
function useTab(): [Tab, (tab: Tab) => void] {
  const hash = useLocation({ select: (location) => location.hash });
  const navigate = useNavigate();
  const tab = isTab(hash) ? hash : "details";
  return [
    tab,
    (next) => {
      void navigate({ to: ".", hash: next, replace: true, resetScroll: false });
      window.scrollTo({ top: 0 });
    },
  ];
}

// ── the form ───────────────────────────────────────────────────────────

const STATEMENT_KINDS = [
  { value: "text", label: "Write it" },
  { value: "pdf", label: "Upload a PDF" },
] as const;

const CHECKERS: Tuple<{ value: Checker; label: string; description: string }> = [
  {
    value: "tokens",
    label: "Same words",
    description: "Output and answer match word by word; spacing and blank lines don't matter.",
  },
  {
    value: "exact",
    label: "Exactly the same",
    description: "Output and answer match character by character, trailing whitespace aside.",
  },
  {
    value: "float",
    label: "Numbers within a tolerance",
    description: "Like same words, but numbers count as equal within the tolerance.",
  },
  {
    value: "custom",
    label: "A compare script",
    description: "Your program decides, the way DOMjudge's output validators do.",
  },
];

const RUN_SCRIPT_EXAMPLE = `#!/bin/sh
# run <input> <output> <program...>
# Runs the solution. Write what counts as its output to "$2".
input="$1"; output="$2"; shift 2
exec "$@" < "$input" > "$output"
`;

const COMPARE_SCRIPT_EXAMPLE = `import sys

# compare <input> <answer> <feedback dir> < program output
# Exit 42 to accept, 43 to reject. Write a score to <feedback dir>/score.txt for partial credit.
answer = open(sys.argv[2]).read().split()
output = sys.stdin.read().split()
sys.exit(42 if output == answer else 43)
`;

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
          (slug) => `Its page is /problems/${slug || "(slug)"}. Uses the title by default.`,
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
      checker: z
        .enum(["exact", "tokens", "float", "custom"])
        .meta({ label: "How output is checked" }),
      checkerTolerance: z
        .number("A number")
        .gt(0, "More than 0")
        .max(1)
        .meta({ label: "Tolerance" })
        .describe("Absolute or relative, whichever is looser. 0.000001 suits most problems."),
      checkerLanguage: z.string().meta({ label: "Compare script language" }),
      checkerSource: z.string().max(65_536, "Up to 64 KB").meta({ label: "Compare script" }),
      runScript: z.string().max(65_536, "Up to 64 KB").nullable().meta({ label: "Run script" }),
    })
    .superRefine((value, ctx) => {
      if (value.statementKind === "pdf" && !value.statementPdf && !pdfPath) {
        ctx.addIssue({ code: "custom", path: ["statementPdf"], message: "Choose the PDF" });
      }
      if (value.checker === "custom") {
        if (!value.checkerLanguage) {
          ctx.addIssue({ code: "custom", path: ["checkerLanguage"], message: "Pick its language" });
        }
        if (!value.checkerSource.trim()) {
          ctx.addIssue({ code: "custom", path: ["checkerSource"], message: "Write the script" });
        }
      }
      if (value.runScript !== null && !value.runScript.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["runScript"],
          message: "Write the script, or turn it off",
        });
      }
    });
}

type ProblemValues = z.infer<ReturnType<typeof problemSchema>>;

function valuesOf(
  problem: Problem | undefined,
  scripts: Scripts | null,
  next: string,
  settings: Settings,
): ProblemValues {
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
    checker: problem?.checker ?? "tokens",
    checkerTolerance: problem?.checker_tolerance ?? 0.000001,
    checkerLanguage: scripts?.checker_language ?? problem?.checker_language ?? "python",
    checkerSource: scripts?.checker_source ?? "",
    runScript: scripts?.run_script ?? null,
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

// ── the editor ─────────────────────────────────────────────────────────

/** The jury's page for one problem: a sidebar of tabs, like Manage's settings pages. */
export function ProblemEditor({
  eventId,
  orgId,
  settings,
  problem,
}: {
  eventId: string;
  orgId: string | null;
  settings: Settings;
  problem: Problem | undefined;
}) {
  const problems = useProblems(eventId, settings.problemOrder);
  // the scripts aren't selectable, so the form waits for them before it starts its draft
  const scripts = useQuery({ ...scriptsQueryOptions(problem?.id ?? ""), enabled: !!problem });
  if (problem && scripts.isPending) return <Screen.Skeleton width="wide" />;
  return (
    <EditorBody
      key={problem?.id ?? "new"}
      eventId={eventId}
      orgId={orgId}
      settings={settings}
      problem={problem}
      scripts={scripts.data ?? null}
      next={nextId(settings.idKind, problems.data ?? [])}
    />
  );
}

function EditorBody({
  eventId,
  orgId,
  settings,
  problem,
  scripts,
  next,
}: {
  eventId: string;
  orgId: string | null;
  settings: Settings;
  problem: Problem | undefined;
  scripts: Scripts | null;
  next: string;
}) {
  const [tab, setTab] = useTab();
  const [invalid, setInvalid] = useState<ReadonlySet<Tab>>(new Set());
  const panes = useRef<HTMLFormElement>(null);
  const queryClient = useQueryClient();
  const difficulties = useDifficulties(eventId);
  const languages = useQuery(languagesQueryOptions());
  const enabled = languages.data ?? [];
  const editorSettings = { ...DEFAULT_EDITOR_SETTINGS, tabSize: settings.editorTabSize };
  const goTo = useGoTo();
  const pdfPath = problem?.statement_pdf_path ?? null;
  const schema = problemSchema(settings, pdfPath);
  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: valuesOf(problem, scripts, next, settings),
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    // the panes stay mounted, so the invalid fields say which tabs they're on
    onSubmitInvalid: () => {
      const tabs = [...(panes.current?.querySelectorAll<HTMLElement>("[data-tab]") ?? [])]
        .filter((pane) => pane.querySelector('[aria-invalid="true"], [data-invalid="true"]'))
        .map((pane) => pane.dataset.tab)
        .filter((key): key is Tab => key !== undefined && isTab(key));
      setInvalid(new Set(tabs));
      if (tabs[0] && !tabs.includes(tab)) setTab(tabs[0]);
    },
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const slug = value.slug.trim() || toSlug(value.title, 64) || toSlug(value.label, 64);
      const custom = value.checker === "custom";
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
          checker: value.checker,
          checker_tolerance: value.checker === "float" ? value.checkerTolerance : null,
          checker_language: custom ? value.checkerLanguage : null,
          checker_source: custom ? value.checkerSource : null,
          run_script: value.runScript?.trim() ? value.runScript : null,
        });
        const nextPdf =
          value.statementKind === "text"
            ? null
            : value.statementPdf
              ? await uploadStatementPdf(eventId, id, value.statementPdf)
              : pdfPath;
        if (nextPdf !== pdfPath) await setStatementPdf(id, nextPdf, pdfPath);
        formApi.setFieldValue("statementPdf", null);
        setInvalid(new Set());
        await queryClient.invalidateQueries({ queryKey: scriptsQueryOptions(id).queryKey });
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

  const detailsFields = () => {
    return (
      <Screen.Section
        title="Details"
        description="What it's called, what it's worth and who sees it."
      >
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)]">
            <form.Field name="label">{(field) => <field.TextField required />}</form.Field>
            <form.Field name="title">{(field) => <field.TextField required />}</form.Field>
            <form.Field name="slug">{(field) => <field.TextField />}</form.Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
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
          </div>
          <form.Subscribe selector={(state) => state.values.kind}>
            {(kind) =>
              kind === "shortest" && settings.golfPoints === "brackets" ? (
                golfBrackets()
              ) : (
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
          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="visible">{(field) => <field.SwitchField />}</form.Field>
            {settings.problemOrder === "custom" && (
              <form.Field name="sort">
                {(field) => <field.NumberField min={-1000} max={1000} />}
              </form.Field>
            )}
          </div>
        </div>
      </Screen.Section>
    );
  };

  const golfBrackets = () => {
    return (
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
    );
  };

  const statementFields = () => {
    return (
      <Screen.Section
        title="Statement"
        description="What participants read: write it here, or upload a PDF."
      >
        <div className="flex flex-col gap-4">
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
                      rows={16}
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
        </div>
      </Screen.Section>
    );
  };

  const limitsFields = () => {
    return (
      <Screen.Section
        title="Limits"
        description="Per test. A problem asking for more than the organization allows won't save, and one saved before the cap runs at the cap."
      >
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
      </Screen.Section>
    );
  };

  const checkingFields = () => {
    return (
      <>
        <Screen.Section
          title="Compare script"
          description="How a solution's output is checked against each test's answer."
        >
          <div className="flex flex-col gap-4">
            <form.Field name="checker">
              {(field) => (
                <field.Field>
                  <field.Label />
                  <FieldSelect field={field} options={CHECKERS} />
                </field.Field>
              )}
            </form.Field>
            <form.Subscribe selector={(state) => state.values.checker}>
              {(checker) => (
                <>
                  {checker === "float" && (
                    <form.Field name="checkerTolerance">
                      {(field) => <field.NumberField min={0} max={1} step={0.000001} />}
                    </form.Field>
                  )}
                  {checker === "custom" && (
                    <>
                      <p className="text-sm text-muted-fg">
                        Called as{" "}
                        <code className="font-mono text-xs">
                          compare input answer feedback_dir &lt; output
                        </code>
                        , as DOMjudge calls an output validator. Exit 42 to accept and 43 to reject;
                        any other exit is a judge error. For partial credit, write a score to{" "}
                        <code className="font-mono text-xs">feedback_dir/score.txt</code>.
                      </p>
                      <form.Field name="checkerLanguage">
                        {(field) => (
                          <field.Field className="sm:w-64">
                            <field.Label />
                            <FieldSelect
                              field={field}
                              options={enabled.map((language) => ({
                                value: language.key,
                                label: `${language.name} ${language.version}`.trim(),
                              }))}
                            />
                            <field.Error />
                          </field.Field>
                        )}
                      </form.Field>
                      <form.Subscribe selector={(state) => state.values.checkerLanguage}>
                        {(key) => (
                          <form.Field name="checkerSource">
                            {(field) => (
                              <field.Field>
                                <field.Label />
                                <CodeEditor
                                  id={field.name}
                                  label="Compare script"
                                  value={field.value}
                                  onChange={field.handleChange}
                                  onBlur={field.handleBlur}
                                  invalid={field.meta.isInvalid}
                                  language={editorLanguage(
                                    enabled.find((each) => each.key === key),
                                  )}
                                  placeholder={COMPARE_SCRIPT_EXAMPLE}
                                  minHeight="16rem"
                                  settings={editorSettings}
                                />
                                <field.Error />
                              </field.Field>
                            )}
                          </form.Field>
                        )}
                      </form.Subscribe>
                    </>
                  )}
                </>
              )}
            </form.Subscribe>
          </div>
        </Screen.Section>
        <Screen.Section
          title="Run script"
          description="Runs each solution instead of the runner, for interactive problems or ones that call the program more than once."
        >
          <form.Field name="runScript">
            {(field) => (
              <div className="flex flex-col gap-4">
                <label className="flex items-center gap-3 text-sm">
                  <Switch
                    checked={field.value !== null}
                    onCheckedChange={(on) => field.handleChange(on ? RUN_SCRIPT_EXAMPLE : null)}
                  />
                  Use a run script
                </label>
                {field.value !== null && (
                  <>
                    <p className="text-sm text-muted-fg">
                      A POSIX shell script, called as DOMjudge calls its run script:{" "}
                      <code className="font-mono text-xs">run input output program...</code>, in the
                      solution's image. It reads the test from{" "}
                      <code className="font-mono text-xs">$1</code> and writes what counts as the
                      output to <code className="font-mono text-xs">$2</code>; the rest of its
                      arguments run the solution. The time and memory limits cover the whole script.
                      Try a solution here runs without it.
                    </p>
                    <field.Field>
                      <CodeEditor
                        id={field.name}
                        label="Run script"
                        value={field.value}
                        onChange={field.handleChange}
                        onBlur={field.handleBlur}
                        invalid={field.meta.isInvalid}
                        language="plain"
                        minHeight="12rem"
                        settings={editorSettings}
                      />
                      <field.Error />
                    </field.Field>
                  </>
                )}
              </div>
            )}
          </form.Field>
        </Screen.Section>
      </>
    );
  };

  const current = TABS.find((each) => each.key === tab) ?? TABS[0];
  // a new problem has only its form until it's added
  const shown = !problem && !current?.form ? "details" : tab;
  const title = problem ? `${problem.label}. ${problem.title}` : "New problem";

  return (
    <SidebarProvider className="mx-auto max-w-6xl px-4 sm:px-6 lg:gap-8">
      <Sidebar
        label="Problem"
        variant="plain"
        collapsible="none"
        className="hidden lg:flex lg:py-6"
      >
        <EditorNav tab={shown} onTab={setTab} slug={problem?.slug} invalid={invalid} />
      </Sidebar>
      <SidebarInset>
        <MobileNav tab={shown} onTab={setTab} saved={!!problem} />
        <Screen
          title={title}
          width="embedded"
          description={TABS.find((each) => each.key === shown)?.label}
          actions={
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" render={<Link to="/jury" />} nativeButton={false}>
                <IconArrowLeft />
                Jury
              </Button>
            </div>
          }
        >
          <form.AppForm>
            {problem ? <form.SaveBarEntry /> : <form.DraftGuard />}
            <form.Form
              ref={panes}
              className={cn(
                "flex flex-col gap-6",
                !TABS.find((each) => each.key === shown)?.form && "hidden",
              )}
            >
              <Pane tab="details" shown={shown}>
                {detailsFields()}
              </Pane>
              <Pane tab="statement" shown={shown}>
                {statementFields()}
              </Pane>
              <Pane tab="limits" shown={shown}>
                {limitsFields()}
              </Pane>
              <Pane tab="checking" shown={shown}>
                {checkingFields()}
              </Pane>
              <form.FormAlert title="Couldn't save the problem" />
              {!problem && (
                <div className="flex flex-wrap items-center gap-3">
                  <form.Submit pending="Adding...">Add the problem</form.Submit>
                  <span className="text-sm text-muted-fg">
                    Tests, jury solutions and files come once it's added.
                  </span>
                </div>
              )}
            </form.Form>
          </form.AppForm>
          {problem && shown === "tests" && <Tests eventId={eventId} problem={problem} />}
          {problem && shown === "solutions" && (
            <JurySolutions eventId={eventId} problem={problem} />
          )}
          {problem && shown === "try" && <TrySolution problem={problem} settings={settings} />}
          {problem && shown === "files" && <Files eventId={eventId} problem={problem} />}
          {problem && shown === "reuse" && (
            <ReuseProblem eventId={eventId} orgId={orgId} settings={settings} problem={problem} />
          )}
          {problem && shown === "package" && <ProblemPackage eventId={eventId} problem={problem} />}
          {problem && shown === "remove" && <RemoveProblem eventId={eventId} problem={problem} />}
        </Screen>
      </SidebarInset>
    </SidebarProvider>
  );
}

// kept mounted so the form keeps every field's value and validation while another tab is open
function Pane({ tab, shown, children }: { tab: Tab; shown: Tab; children: ReactNode }) {
  return (
    <div data-tab={tab} className={cn("flex flex-col gap-6", tab !== shown && "hidden")}>
      {children}
    </div>
  );
}

function EditorNav({
  tab,
  onTab,
  slug,
  invalid,
}: {
  tab: Tab;
  onTab: (tab: Tab) => void;
  slug: string | undefined;
  invalid: ReadonlySet<Tab>;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  const saved = slug !== undefined;
  return (
    <SidebarContent>
      {slug && (
        <SidebarGroup className="lg:px-0">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton render={<Link to="/problems" splat={slug} />}>
                <IconEye />
                <span>Participant view</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      )}
      {GROUPS.map((group) => (
        <SidebarGroup key={group.label} className="lg:px-0">
          <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
          <SidebarMenu>
            {group.tabs.map((each) => {
              const Icon = each.icon;
              const locked = !saved && !each.form;
              return (
                <SidebarMenuItem key={each.key}>
                  <SidebarMenuButton
                    isActive={tab === each.key}
                    disabled={locked}
                    title={locked ? "Add the problem first" : undefined}
                    onClick={() => {
                      onTab(each.key);
                      if (isMobile) setOpenMobile(false);
                    }}
                  >
                    <Icon />
                    <span>{each.label}</span>
                    {invalid.has(each.key) && (
                      <IconAlertTriangle
                        aria-label="Has a problem to fix"
                        className="ml-auto text-destructive"
                      />
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      ))}
    </SidebarContent>
  );
}

// below lg the tabs are a row of buttons over the page instead of a sidebar
function MobileNav({ tab, onTab, saved }: { tab: Tab; onTab: (tab: Tab) => void; saved: boolean }) {
  return (
    <nav aria-label="Problem" className="-mx-4 overflow-x-auto px-4 pt-4 lg:hidden">
      <ul className="flex w-max gap-1">
        {TABS.map((each) => (
          <li key={each.key}>
            <Button
              type="button"
              size="sm"
              variant={tab === each.key ? "secondary" : "ghost"}
              disabled={!saved && !each.form}
              onClick={() => onTab(each.key)}
            >
              {each.label}
            </Button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
