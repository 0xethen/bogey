import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  addDeliberationNoteFn,
  deliberationQueryOptions,
  flagSubmissionFn,
  resolveFlagFn,
  type Deliberation,
  type JudgingFlag,
} from "@bogey/db/queries/deliberation";
import type { Criterion } from "@bogey/db/queries/judging";
import { requestFailure } from "@bogey/db/errors";
import { Badge } from "@bogey/ui/components/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@bogey/ui/components/dialog";
import { FieldGroup } from "@bogey/ui/components/field";
import { Markdown } from "@bogey/ui/components/markdown";
import { RelativeTime } from "@bogey/ui/components/relative-time";
import { Screen } from "@bogey/ui/components/screen";
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
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { useT, type T } from "#/lib/translate.tsx";

const reasonSchema = (t: T) =>
  z.object({
    reason: z
      .string()
      .trim()
      .min(1, t("deliberation.needReason"))
      .max(500, t("form.maxLength", { max: 500 }))
      .meta({ label: t("deliberation.reason") })
      .describe(t("deliberation.reasonHelp")),
  });

function useRefresh(submissionId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: deliberationQueryOptions(submissionId).queryKey }),
      queryClient.invalidateQueries({ queryKey: ["judge-queue"] }),
      queryClient.invalidateQueries({ queryKey: ["judging-flags"] }),
    ]);
}

/** One line on why a project was flagged. */
export function flagReason(flag: JudgingFlag, t: T): string {
  if (flag.gap !== null) return t("deliberation.gapReason", { gap: Math.round(flag.gap) });
  return flag.raisedBy
    ? t("deliberation.flaggedBy", { name: flag.raisedBy, reason: flag.reason })
    : flag.reason;
}

export function FlagDialog({
  submissionId,
  open,
  onOpenChange,
}: {
  submissionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const schema = useMemo(() => reasonSchema(t), [t]);
  const refresh = useRefresh(submissionId);
  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: { reason: "" },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const result = await flagSubmissionFn({
        data: { submissionId, reason: value.reason },
      }).catch(requestFailure);
      if (!result.ok) return createValidationError(result.error.message);
      formApi.reset();
      onOpenChange(false);
      await refresh();
      return undefined;
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("deliberation.flagTitle")}</DialogTitle>
          <DialogDescription>{t("deliberation.flagIntro")}</DialogDescription>
        </DialogHeader>
        <form.AppForm>
          <form.Form>
            <FieldGroup>
              <form.Field name="reason">
                {(field) => <field.TextAreaField rows={3} required />}
              </form.Field>
              <form.FormAlert title={t("deliberation.flagFailed")} />
              <form.Submit pending={t("common.saving")}>{t("deliberation.flagSubmit")}</form.Submit>
            </FieldGroup>
          </form.Form>
        </form.AppForm>
      </DialogContent>
    </Dialog>
  );
}

/** The open (or last) flag on a project: everyone's scores, the discussion, and resolving it. */
export function DeliberationPanel({
  submissionId,
  criteria,
}: {
  submissionId: string;
  criteria: Tuple<Criterion>;
}) {
  const t = useT();
  const { data } = useQuery(deliberationQueryOptions(submissionId));
  if (!data) return null;
  const { flag } = data;
  if (flag.resolvedAt) {
    return (
      <p className="mb-6 flex flex-wrap items-center gap-2 text-sm text-muted-fg">
        <Badge variant="secondary">{t("deliberation.resolved")}</Badge>
        {flag.resolvedBy
          ? t("deliberation.resolvedBy", { name: flag.resolvedBy })
          : t("deliberation.resolvedPlain")}
        {flag.resolution && <span>· {flag.resolution}</span>}
      </p>
    );
  }
  return (
    <Screen.Section
      id="deliberation"
      title={t("deliberation.title")}
      description={flagReason(flag, t)}
      className="mb-8 rounded-2xl border border-warning/40 p-4"
    >
      <ScoreTable data={data} criteria={criteria} />
      <Notes data={data} />
      <NoteForm flagId={flag.id} submissionId={submissionId} />
      <ResolveForm flagId={flag.id} submissionId={submissionId} />
    </Screen.Section>
  );
}

function ScoreTable({ data, criteria }: { data: Deliberation; criteria: Tuple<Criterion> }) {
  const t = useT();
  if (data.judges.length === 0) {
    return <p className="text-sm text-muted-fg">{t("deliberation.noScores")}</p>;
  }
  const shown = criteria.filter((criterion) =>
    data.judges.some((judge) => judge.scores[criterion.id] !== undefined),
  );
  return (
    <div className="flex flex-col gap-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("deliberation.judge")}</TableHead>
            {shown.map((criterion) => (
              <TableHead key={criterion.id} className="text-right">
                {criterion.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.judges.map((judge) => (
            <TableRow key={judge.judgeId}>
              <TableCell>{judge.name}</TableCell>
              {shown.map((criterion) => (
                <TableCell key={criterion.id} className="text-right tabular-nums">
                  {judge.scores[criterion.id] ?? "–"}
                  <span className="text-muted-fg"> / {criterion.max_score}</span>
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {data.judges
        .filter((judge) => judge.note)
        .map((judge) => (
          <div key={judge.judgeId} className="text-sm">
            <p className="font-medium">{t("deliberation.notesOf", { name: judge.name })}</p>
            <Markdown className="text-muted-fg">{judge.note ?? ""}</Markdown>
          </div>
        ))}
    </div>
  );
}

function Notes({ data }: { data: Deliberation }) {
  if (data.notes.length === 0) return null;
  return (
    <ol className="flex flex-col gap-3">
      {data.notes.map((note) => (
        <li key={note.id} className="text-sm">
          <p className="text-muted-fg">
            <span className="font-medium text-fg">{note.author}</span> ·{" "}
            <RelativeTime value={note.createdAt} />
          </p>
          <Markdown>{note.body}</Markdown>
        </li>
      ))}
    </ol>
  );
}

const noteSchema = (t: T) =>
  z.object({
    body: z
      .string()
      .trim()
      .min(1, t("deliberation.needNote"))
      .max(5000, t("form.maxLength", { max: 5000 }))
      .meta({ label: t("deliberation.note") }),
  });

function NoteForm({ flagId, submissionId }: { flagId: string; submissionId: string }) {
  const t = useT();
  const schema = useMemo(() => noteSchema(t), [t]);
  const refresh = useRefresh(submissionId);
  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: { body: "" },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const result = await addDeliberationNoteFn({
        data: { flagId, body: value.body },
      }).catch(requestFailure);
      if (!result.ok) return createValidationError(result.error.message);
      formApi.reset();
      await refresh();
      return undefined;
    },
  });
  return (
    <form.AppForm>
      <form.Form className="flex flex-col gap-2">
        <form.Field name="body">{(field) => <field.TextAreaField rows={2} />}</form.Field>
        <form.FormAlert title={t("deliberation.noteFailed")} />
        <div>
          <form.Submit size="sm" variant="outline" pending={t("common.saving")}>
            {t("deliberation.addNote")}
          </form.Submit>
        </div>
      </form.Form>
    </form.AppForm>
  );
}

const resolveSchema = (t: T) =>
  z.object({
    resolution: z
      .string()
      .trim()
      .max(2000, t("form.maxLength", { max: 2000 }))
      .meta({ label: t("deliberation.outcome") })
      .describe(t("deliberation.outcomeHelp")),
  });

function ResolveForm({ flagId, submissionId }: { flagId: string; submissionId: string }) {
  const t = useT();
  const schema = useMemo(() => resolveSchema(t), [t]);
  const refresh = useRefresh(submissionId);
  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: { resolution: "" },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, createValidationError }) => {
      const result = await resolveFlagFn({
        data: { flagId, resolution: value.resolution },
      }).catch(requestFailure);
      if (!result.ok) return createValidationError(result.error.message);
      await refresh();
      return undefined;
    },
  });
  return (
    <form.AppForm>
      <form.Form className="flex flex-col gap-2 border-t border-border pt-4">
        <form.Field name="resolution">{(field) => <field.TextField />}</form.Field>
        <form.FormAlert title={t("deliberation.resolveFailed")} />
        <div>
          <form.Submit size="sm" pending={t("common.saving")}>
            {t("deliberation.resolve")}
          </form.Submit>
        </div>
      </form.Form>
    </form.AppForm>
  );
}
