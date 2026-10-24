import { useState } from "react";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconCheck, IconPlayerPlay, IconPlus, IconTrash, IconX } from "@tabler/icons-react";
import { Badge } from "@bogey/ui/components/badge";
import { Button } from "@bogey/ui/components/button";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { RelativeTime } from "@bogey/ui/components/relative-time";
import { Screen } from "@bogey/ui/components/screen";
import { Switch } from "@bogey/ui/components/switch";
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
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { plural } from "@bogey/utils/text";
import {
  addJurySolution,
  applyRejudging,
  cancelRejudging,
  jurySolutionsQueryOptions,
  languagesQueryOptions,
  recentAttemptsQueryOptions,
  rejudge,
  rejudgingDiffQueryOptions,
  rejudgingsQueryOptions,
  removeJurySolution,
  teamNamesQueryOptions,
  verifyJudgings,
  verifyProblem,
  type Problem,
  type Rejudging,
  type Verdict,
} from "../db.ts";
import { TestVerdict, VERDICTS } from "../shared.tsx";
import { useChallenges } from "../context.tsx";

const ANY = "__any";

const rejudgeSchema = z.object({
  problem: z.string().meta({ label: "Problem" }),
  language: z.string().meta({ label: "Language" }),
  reason: z
    .string()
    .trim()
    .min(1, "Say why, for the log")
    .max(300, "Keep it under 300 characters")
    .meta({ label: "Why", placeholder: "Test 4 had the wrong answer" }),
});

function verdictOrDash(verdict: Verdict | null) {
  return verdict ? <TestVerdict verdict={verdict} /> : <span className="text-muted-fg">–</span>;
}

export function Rejudgings({ problems }: { problems: Tuple<Problem> }) {
  const { eventId } = useChallenges();
  const queryClient = useQueryClient();
  const sets = useQuery({
    ...rejudgingsQueryOptions(eventId),
    refetchInterval: 10_000,
  });
  const languages = useQuery(languagesQueryOptions());
  const [open, setOpen] = useState<string | null>(null);
  const form = useAppForm({
    ...appFormOptions.strictSchema(rejudgeSchema, {
      defaultValues: { problem: ANY, language: ANY, reason: "" },
      errorVisibility,
      validators: [rewardEarlyPunishLate(rejudgeSchema)],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
      try {
        const made = await rejudge({
          eventId,
          reason: value.reason.trim(),
          ...(value.problem === ANY ? {} : { problemId: value.problem }),
          ...(value.language === ANY ? {} : { language: value.language }),
        });
        formApi.reset();
        setOpen(made.id);
      } catch (error) {
        return createValidationError(
          error instanceof Error ? error.message : "Couldn't queue the rejudging.",
        );
      }
      await queryClient.invalidateQueries({ queryKey: rejudgingsQueryOptions(eventId).queryKey });
      return undefined;
    },
  });

  return (
    <Screen.Section
      title="Rejudging"
      description="Judge solutions again, for a wrong test or a changed limit. The new verdicts wait here until you look at what changes and apply them; the scoreboard keeps the old ones until then."
    >
      <form.AppForm>
        <form.Form className="flex flex-wrap items-center gap-3">
          <div className="w-48">
            <form.Field name="problem">
              {(field) => (
                <field.Field>
                  <field.Label />
                  <FieldSelect
                    field={field}
                    options={[
                      { value: ANY, label: "Every problem" },
                      ...problems.map((problem) => ({
                        value: problem.id,
                        label: `${problem.label}. ${problem.title}`,
                      })),
                    ]}
                  />
                </field.Field>
              )}
            </form.Field>
          </div>
          <div className="w-44">
            <form.Field name="language">
              {(field) => (
                <field.Field>
                  <field.Label />
                  <FieldSelect
                    field={field}
                    options={[
                      { value: ANY, label: "Every language" },
                      ...(languages.data ?? []).map((each) => ({
                        value: each.key,
                        label: each.name,
                      })),
                    ]}
                  />
                </field.Field>
              )}
            </form.Field>
          </div>
          <div className="min-w-56 flex-1">
            <form.Field name="reason">{(field) => <field.TextField required />}</form.Field>
          </div>
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(submitting) => (
              <Button
                type="button"
                size="sm"
                className="mt-8"
                disabled={submitting}
                confirm={{
                  title: "Rejudge these solutions?",
                  description:
                    "They go in the runner's queue behind live submissions. Nothing changes for teams until you apply the result.",
                  label: "Rejudge",
                  variant: "default",
                }}
                onClick={() => void form.handleSubmit()}
              >
                <IconPlayerPlay />
                Rejudge...
              </Button>
            )}
          </form.Subscribe>
        </form.Form>
        <form.FormAlert title="Couldn't queue the rejudging" />
      </form.AppForm>
      {(sets.data?.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-fg">No rejudgings yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border border-y border-border">
          {sets.data?.map((set) => (
            <li key={set.id}>
              <SetRow
                set={set}
                problems={problems}
                open={open === set.id}
                onToggle={() => setOpen(open === set.id ? null : set.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </Screen.Section>
  );
}

const STATUS: Record<Rejudging["status"], string> = {
  pending: "Waiting to apply",
  applied: "Applied",
  cancelled: "Cancelled",
};

function SetRow({
  set,
  problems,
  open,
  onToggle,
}: {
  set: Rejudging;
  problems: Tuple<Problem>;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="py-2 text-sm">
      <button type="button" className="flex w-full items-center gap-3 text-left" onClick={onToggle}>
        <span className="min-w-0 flex-1 truncate font-medium">{set.reason}</span>
        <span className="text-muted-fg">
          <RelativeTime value={set.createdAt} />
        </span>
        <Badge variant={set.status === "pending" ? "secondary" : "outline"}>
          {STATUS[set.status]}
        </Badge>
      </button>
      {open && <SetDiff set={set} problems={problems} />}
    </div>
  );
}

function SetDiff({ set, problems }: { set: Rejudging; problems: Tuple<Problem> }) {
  const { eventId } = useChallenges();
  const queryClient = useQueryClient();
  const diff = useQuery({
    ...rejudgingDiffQueryOptions(set.id),
    refetchInterval: (query) =>
      set.status === "pending" && query.state.data?.some((row) => !row.done) ? 3_000 : false,
  });
  const teams = useQuery(teamNamesQueryOptions(eventId));
  const [changedOnly, setChangedOnly] = useState(true);
  const labels = new Map(problems.map((problem) => [problem.id, problem.label]));
  const rows = diff.data ?? [];
  const waiting = rows.filter((row) => !row.done).length;
  const changed = (row: (typeof rows)[number]) =>
    row.oldVerdict !== row.newVerdict || row.oldScore !== row.newScore;
  const shown = changedOnly ? rows.filter((row) => !row.done || changed(row)) : rows;
  const finish = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: rejudgingsQueryOptions(eventId).queryKey }),
      queryClient.invalidateQueries({ queryKey: ["challenges", "attempts", eventId] }),
      queryClient.invalidateQueries({ queryKey: ["challenges", "scoreboard"] }),
    ]);
  };
  const apply = useMutation({ mutationFn: () => applyRejudging(set.id), onSuccess: finish });
  const cancel = useMutation({ mutationFn: () => cancelRejudging(set.id), onSuccess: finish });

  return (
    <div className="mt-3 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-muted-fg">
          {plural(rows.length, "solution")}, {plural(rows.filter(changed).length, "change")}
          {waiting > 0 && `, ${waiting} still being judged`}
        </span>
        <label className="ml-auto flex items-center gap-2">
          <Switch checked={changedOnly} onCheckedChange={setChangedOnly} />
          Only what changes
        </label>
        {set.status === "pending" && (
          <>
            <Button
              size="sm"
              disabled={apply.isPending || waiting > 0}
              confirm={{
                title: "Apply these verdicts?",
                description:
                  "The new verdicts replace the old ones on the scoreboard and for teams. The old judgings are kept.",
                label: "Apply",
                variant: "default",
              }}
              onClick={() => apply.mutate()}
            >
              <IconCheck />
              Apply...
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={cancel.isPending}
              confirm={{
                title: "Cancel this rejudging?",
                description: "Judgings still waiting are dropped. Nothing changes for teams.",
                label: "Cancel rejudging",
              }}
              onClick={() => cancel.mutate()}
            >
              <IconX />
              Cancel...
            </Button>
          </>
        )}
      </div>
      <ErrorAlert error={apply.error ?? cancel.error} title="Couldn't do that" />
      {shown.length === 0 ? (
        <p className="text-muted-fg">{diff.isPending ? "Loading..." : "Nothing changes."}</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">Problem</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Language</TableHead>
                <TableHead>Was</TableHead>
                <TableHead>Now</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((row) => (
                <TableRow key={row.solutionId}>
                  <TableCell className="font-mono">{labels.get(row.problemId) ?? "?"}</TableCell>
                  <TableCell>{(row.teamId && teams.data?.get(row.teamId)) || "A team"}</TableCell>
                  <TableCell className="text-muted-fg">{row.language}</TableCell>
                  <TableCell>{verdictOrDash(row.oldVerdict)}</TableCell>
                  <TableCell>
                    {row.done ? (
                      verdictOrDash(row.newVerdict)
                    ) : (
                      <Badge variant="secondary">Judging</Badge>
                    )}
                    {row.done && changed(row) && (
                      <span className="ml-2 text-xs text-muted-fg">changed</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

export function Verification() {
  const { eventId } = useChallenges();
  const queryClient = useQueryClient();
  const recent = useQuery(recentAttemptsQueryOptions(eventId));
  const waiting = (recent.data ?? []).filter(
    (attempt) => attempt.verdict && !attempt.verified && !attempt.ignored,
  ).length;
  const verify = useMutation({
    mutationFn: () => verifyJudgings(eventId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["challenges", "attempts", eventId] }),
        queryClient.invalidateQueries({ queryKey: ["challenges", "scoreboard"] }),
      ]);
    },
  });
  return (
    <Screen.Section
      title="Verification"
      description="Teams and the scoreboard see a solution as pending until a jury member verifies its result. Overriding a verdict verifies it."
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-fg">
          {waiting === 0
            ? "Everything judged is verified."
            : `${plural(waiting, "result")} to verify.`}
        </span>
        <Button
          size="sm"
          disabled={verify.isPending || waiting === 0}
          confirm={{
            title: "Verify every result?",
            description: "Teams see their verdicts and the scoreboard counts them.",
            label: "Verify",
            variant: "default",
          }}
          onClick={() => verify.mutate()}
        >
          <IconCheck />
          Verify all...
        </Button>
      </div>
      <ErrorAlert error={verify.error} title="Couldn't verify" />
    </Screen.Section>
  );
}

const EXPECTED = ["AC", "WA", "TLE", "MLE", "RE", "CE", "OLE"] as const satisfies Tuple<Verdict>;

const jurySolutionSchema = z.object({
  language: z.string().meta({ label: "Language" }),
  expected: z.enum(EXPECTED).meta({ label: "Should get" }),
  label: z
    .string()
    .max(80, "Keep it under 80 characters")
    .meta({ label: "Name", placeholder: "Brute force" }),
  source: z.string().min(1, "Paste the solution").max(100_000).meta({ label: "Source" }),
});

const JURY_SOLUTION_DEFAULTS: z.input<typeof jurySolutionSchema> = {
  language: "",
  expected: "AC",
  label: "",
  source: "",
};

export function JurySolutions({ problem }: { problem: Problem }) {
  const { eventId } = useChallenges();
  const queryClient = useQueryClient();
  const options = jurySolutionsQueryOptions(eventId, problem.id);
  const solutions = useQuery({
    ...options,
    refetchInterval: (query) =>
      query.state.data?.some((each) => each.status === "queued" || each.status === "running")
        ? 3_000
        : false,
  });
  const languages = useQuery(languagesQueryOptions());
  const refresh = () => queryClient.invalidateQueries({ queryKey: options.queryKey });
  const form = useAppForm({
    ...appFormOptions.strictSchema(jurySolutionSchema, {
      defaultValues: JURY_SOLUTION_DEFAULTS,
      errorVisibility,
      validators: [rewardEarlyPunishLate(jurySolutionSchema)],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
      try {
        await addJurySolution({
          problemId: problem.id,
          language: value.language || (languages.data?.[0]?.key ?? ""),
          source: value.source,
          expected: value.expected,
          label: value.label.trim(),
        });
      } catch (error) {
        return createValidationError(
          error instanceof Error ? error.message : "Couldn't add the solution.",
        );
      }
      formApi.reset();
      await refresh();
      return undefined;
    },
  });
  const remove = useMutation({ mutationFn: removeJurySolution, onSuccess: refresh });
  const check = useMutation({ mutationFn: () => verifyProblem(problem.id), onSuccess: refresh });
  const list = solutions.data ?? [];
  const wrong = list.filter((each) => each.verdict && each.verdict !== each.expected);

  return (
    <Screen.Section
      title="Jury solutions"
      description="Solutions you write, with the verdict each should get. The runner judges them like a team's, without scoring, so you can check the tests, limits and checker before the contest."
      actions={
        <Button
          size="sm"
          variant="outline"
          disabled={check.isPending || list.length === 0}
          onClick={() => check.mutate()}
        >
          <IconPlayerPlay />
          {check.isPending ? "Queuing..." : "Verify problem"}
        </Button>
      }
    >
      <ErrorAlert error={remove.error ?? check.error} title="Couldn't do that" />
      {list.length === 0 ? (
        <p className="text-sm text-muted-fg">No jury solutions yet.</p>
      ) : (
        <>
          {list.every((each) => each.verdict) && (
            <p role="status" className="text-sm text-muted-fg">
              {wrong.length === 0
                ? "Every solution got the verdict you expected."
                : `${plural(wrong.length, "solution")} got a different verdict than expected.`}
            </p>
          )}
          <ul className="flex flex-col divide-y divide-border border-y border-border">
            {list.map((each) => (
              <li key={each.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium">
                  {each.label || each.language}
                  <span className="ml-2 font-normal text-muted-fg">{each.language}</span>
                </span>
                {/* expected verdict */}
                <span className="text-muted-fg">{VERDICTS[each.expected]}</span>
                {each.verdict ? (
                  <>
                    <TestVerdict verdict={each.verdict} />
                    {each.verdict === each.expected ? (
                      <IconCheck className="size-4 text-green-600" aria-label="As expected" />
                    ) : (
                      <IconX className="size-4 text-destructive" aria-label="Not as expected" />
                    )}
                  </>
                ) : (
                  <Badge variant="secondary">
                    {each.status === "running" ? "Judging" : "Waiting"}
                  </Badge>
                )}
                <Button
                  size="icon-sm"
                  variant="ghost-destructive"
                  aria-label={`Remove ${each.label || each.language}...`}
                  tooltip="Remove..."
                  disabled={remove.isPending}
                  confirm={{
                    title: "Remove this solution?",
                    description: "It and its results are deleted.",
                    label: "Remove",
                  }}
                  onClick={() => remove.mutate(each.id)}
                >
                  <IconTrash />
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
      <form.AppForm>
        <form.Form className="flex flex-col gap-3 rounded-2xl border border-border p-4">
          <div className="flex flex-wrap items-start gap-3">
            <div className="w-44">
              <form.Field name="language">
                {(field) => (
                  <field.Field>
                    <field.Label />
                    <FieldSelect
                      field={field}
                      placeholder={languages.data?.[0]?.name}
                      options={(languages.data ?? []).map((each) => ({
                        value: each.key,
                        label: each.name,
                      }))}
                    />
                  </field.Field>
                )}
              </form.Field>
            </div>
            <div className="w-52">
              <form.Field name="expected">
                {(field) => (
                  <field.Field>
                    <field.Label />
                    <FieldSelect
                      field={field}
                      options={EXPECTED.map((verdict) => ({
                        value: verdict,
                        label: VERDICTS[verdict],
                      }))}
                    />
                  </field.Field>
                )}
              </form.Field>
            </div>
            <div className="min-w-48 flex-1">
              <form.Field name="label">{(field) => <field.TextField />}</form.Field>
            </div>
          </div>
          <form.Field name="source">
            {(field) => (
              <field.Field>
                <field.Label />
                <field.TextArea rows={8} className="font-mono" />
                <field.Error />
              </field.Field>
            )}
          </form.Field>
          <form.FormAlert title="Couldn't add the solution" />
          <div>
            <form.Submit size="sm" pending="Adding...">
              <IconPlus />
              Add solution
            </form.Submit>
          </div>
        </form.Form>
      </form.AppForm>
    </Screen.Section>
  );
}
