import { useMemo, useState } from "react";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  eventConflictsQueryOptions,
  judgeCalibrationQueryOptions,
  removeConflictFn,
  setConflictsFn,
  type ConflictItem,
} from "@bogey/db/queries/conflicts";
import { judgingProgressQueryOptions } from "@bogey/db/queries/judging";
import { eventTeamsQueryOptions } from "@bogey/db/queries/roster";
import { requestFailure, unwrap } from "@bogey/db/errors";
import { calibrationFlags, parseConflicts } from "@bogey/utils/fairness";
import { Badge } from "@bogey/ui/components/badge";
import { Button } from "@bogey/ui/components/button";
import { DisclosureList, DisclosureRow } from "@bogey/ui/components/disclosure-row";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Screen } from "@bogey/ui/components/screen";
import {
  appFormOptions,
  errorVisibility,
  FieldSelect,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { type PlainKey, type T, useHelperSay, useT } from "#/lib/translate.tsx";
import { LINK, Linked, SettingLink } from "#/components/settings/setting-link.tsx";
import { useEventViewer } from "#/lib/viewer.ts";

const pairSchema = (t: T) =>
  z.object({
    judgeId: z
      .string()
      .min(1, t("fairness.pickJudge"))
      .meta({ label: t("fairness.judge"), placeholder: t("fairness.pickJudge") }),
    teamId: z
      .string()
      .min(1, t("fairness.pickTeam"))
      .meta({ label: t("fairness.team"), placeholder: t("fairness.pickTeam") }),
    reason: z
      .string()
      .trim()
      .max(500, t("form.maxLength", { max: 500 }))
      .meta({ label: orgStatusReason(t), placeholder: t("managePrizes.optional") }),
  });

const orgStatusReason = (t: T) => t("orgStatus.reason");

const pasteSchema = (t: T) =>
  z.object({
    pasted: z
      .string()
      .refine((text) => parseConflicts(text).lines.length > 0, t("fairness.addLine"))
      .meta({ label: t("fairness.orPaste"), placeholder: t("fairness.pastePlaceholder") })
      .describe(t("fairness.pasteHelp")),
  });

export function Conflicts({ eventId }: { eventId: string }) {
  const t = useT();
  const say = useHelperSay();
  const pairs = useMemo(() => pairSchema(t), [t]);
  const pasted = useMemo(() => pasteSchema(t), [t]);
  const queryClient = useQueryClient();
  const { data: conflicts } = useSuspenseQuery(eventConflictsQueryOptions(eventId));
  const { data: progress } = useSuspenseQuery(judgingProgressQueryOptions(eventId));
  const { data: teams } = useSuspenseQuery(eventTeamsQueryOptions(eventId));
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: eventConflictsQueryOptions(eventId).queryKey }),
      queryClient.invalidateQueries({ queryKey: judgingProgressQueryOptions(eventId).queryKey }),
      queryClient.invalidateQueries({ queryKey: ["results-preview", eventId] }),
    ]);
  };
  const record = async (items: ConflictItem[]) => {
    const result = await setConflictsFn({ data: { eventId, items } }).catch(requestFailure);
    if (!result.ok) return result.error.message;
    const outcome = result.data;
    setNotice(
      outcome.unmatched
        ? t("fairness.recordedUnmatched", {
            recorded: outcome.recorded,
            unmatched: outcome.unmatched,
          })
        : t("fairness.recorded", { recorded: outcome.recorded }),
    );
    await refresh();
    return undefined;
  };
  const pairForm = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: { judgeId: "", teamId: "", reason: "" },
      errorVisibility,
      validators: [rewardEarlyPunishLate(pairs)],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const failure = await record([value]);
      if (failure) return createValidationError(failure);
      formApi.reset();
      return undefined;
    },
  });
  const pasteForm = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: { pasted: "" },
      errorVisibility,
      validators: [rewardEarlyPunishLate(pasted)],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const failure = await record(parseConflicts(value.pasted).lines);
      if (failure) return createValidationError(failure);
      formApi.reset();
      return undefined;
    },
  });
  const lift = useMutation({
    mutationFn: async (pair: { judgeId: string; teamId: string }) =>
      unwrap(await removeConflictFn({ data: { eventId, ...pair } })),
    onSuccess: refresh,
  });

  return (
    <Screen.Section
      id="conflicts"
      title={t("manageJudging.conflicts")}
      description={t("fairness.intro")}
    >
      <pairForm.AppForm>
        <pairForm.Form className="flex flex-wrap items-end gap-3">
          <pairForm.Field name="judgeId">
            {(field) => (
              <field.Field className="w-52">
                <field.Label />
                <FieldSelect
                  field={field}
                  options={progress.judges.map((item) => ({
                    value: item.userId,
                    label: item.name,
                  }))}
                />
                <field.Error />
              </field.Field>
            )}
          </pairForm.Field>
          <pairForm.Field name="teamId">
            {(field) => (
              <field.Field className="w-52">
                <field.Label />
                <FieldSelect
                  field={field}
                  options={teams.teams.map((item) => ({ value: item.id, label: item.name }))}
                />
                <field.Error />
              </field.Field>
            )}
          </pairForm.Field>
          <pairForm.Field name="reason">
            {(field) => (
              <field.Field className="w-56">
                <field.Label />
                <field.TextInput maxLength={500} />
                <field.Error />
              </field.Field>
            )}
          </pairForm.Field>
          <pairForm.Submit size="sm" variant="outline">
            {t("fairness.add")}
          </pairForm.Submit>
          <pairForm.FormAlert title={t("fairness.addFailed")} />
        </pairForm.Form>
      </pairForm.AppForm>
      <pasteForm.AppForm>
        <pasteForm.Form className="flex flex-col gap-3">
          <pasteForm.Field name="pasted">
            {(field) => {
              const { lines, problems } = parseConflicts(field.value, say);
              return (
                <>
                  <field.TextAreaField
                    rows={3}
                    description={
                      <>
                        {t("fairness.pasteHelp")}
                        {problems.length > 0 &&
                          ` ${problems.map((problem) => t("fairness.lineProblem", { line: problem.line, message: problem.message })).join(" ")}`}
                      </>
                    }
                  />
                  <div>
                    <pasteForm.Submit size="sm" variant="outline" pending={t("webhooks.adding")}>
                      {lines.length > 0
                        ? t("fairness.addN", { count: lines.length })
                        : t("fairness.addMany")}
                    </pasteForm.Submit>
                  </div>
                </>
              );
            }}
          </pasteForm.Field>
          <pasteForm.FormAlert title={t("fairness.addManyFailed")} />
        </pasteForm.Form>
      </pasteForm.AppForm>
      {notice && (
        <p role="status" className="text-sm text-muted-fg">
          {notice}
        </p>
      )}
      <ErrorAlert error={lift.error} title={t("fairness.updateFailed")} />
      {conflicts.length > 0 && (
        <DisclosureList>
          {conflicts.map((conflict) => (
            <DisclosureRow
              key={`${conflict.judgeId}:${conflict.teamId}`}
              title={t("fairness.pair", { judge: conflict.judgeName, team: conflict.teamName })}
              meta={conflict.reason || undefined}
              actions={
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={lift.isPending}
                  confirm={{
                    title: t("fairness.liftTitle"),
                    description: t("fairness.liftBody", {
                      judge: conflict.judgeName,
                      team: conflict.teamName,
                    }),
                    label: t("fairness.lift"),
                  }}
                  onClick={() =>
                    lift.mutate({ judgeId: conflict.judgeId, teamId: conflict.teamId })
                  }
                >
                  {t("fairness.liftButton")}
                </Button>
              }
            />
          ))}
        </DisclosureList>
      )}
    </Screen.Section>
  );
}

const FLAG_TEXT = {
  harsh: "fairness.harsh",
  generous: "fairness.generous",
  flat: "fairness.flat",
} as const satisfies Record<string, PlainKey>;

export function Calibration({ eventId }: { eventId: string }) {
  const t = useT();
  const slug = useEventViewer()?.event.slug ?? "";
  const { data: judges } = useSuspenseQuery(judgeCalibrationQueryOptions(eventId));
  if (judges.length === 0) return null;
  const flags = calibrationFlags(judges);
  return (
    <Screen.Section
      id="how-judges-score"
      title={t("manageJudging.howScore")}
      description={
        <Linked
          text={t("fairness.calibrationHelp", { settings: LINK })}
          links={[
            <SettingLink
              key="normalize"
              to={`/events/${slug}/manage/judging`}
              hash="judging.normalize"
            >
              {t("path.judgingNormalize")}
            </SettingLink>,
          ]}
        />
      }
    >
      <DisclosureList>
        {judges.map((judge) => {
          const flag = flags.get(judge.judgeId);
          return (
            <DisclosureRow
              key={judge.judgeId}
              title={
                <>
                  {judge.name}
                  {flag && (
                    <Badge variant="outline" className="ml-2">
                      {t(FLAG_TEXT[flag])}
                    </Badge>
                  )}
                </>
              }
              meta={t("fairness.calibrationMeta", {
                mean: judge.meanPct,
                sd: judge.sdPct,
                scores: judge.scores,
                entries: judge.entries,
              })}
            />
          );
        })}
      </DisclosureList>
    </Screen.Section>
  );
}
