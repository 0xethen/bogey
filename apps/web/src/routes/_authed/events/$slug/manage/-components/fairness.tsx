import { useMemo, useState } from "react";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  eventConflictsQueryOptions,
  eventPinsQueryOptions,
  judgeCalibrationQueryOptions,
  pinJudgeFn,
  removeConflictFn,
  setConflictsFn,
  unpinJudgeFn,
  type ConflictItem,
} from "@bogey/db/queries/conflicts";
import { judgingProgressQueryOptions } from "@bogey/db/queries/judging";
import { eventTeamsQueryOptions } from "@bogey/db/queries/roster";
import { requestFailure, unwrap } from "@bogey/db/errors";
import { calibrationFlags, parseConflicts } from "@bogey/utils/fairness";
import { Badge } from "@bogey/ui/components/badge";
import { Button } from "@bogey/ui/components/button";
import { DisclosureRow, RowList } from "@bogey/ui/components/row";
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

const KINDS = ["pin", "conflict"] as const;

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
    kind: z.enum(KINDS).meta({ label: t("manualAssign.kind") }),
    reason: z
      .string()
      .trim()
      .max(500, t("form.maxLength", { max: 500 }))
      .meta({ label: t("orgStatus.reason"), placeholder: t("managePrizes.optional") }),
  });

const pasteSchema = (t: T) =>
  z.object({
    pasted: z
      .string()
      .refine((text) => parseConflicts(text).lines.length > 0, t("fairness.addLine"))
      .meta({ label: t("manualAssign.orPaste"), placeholder: t("fairness.pastePlaceholder") })
      .describe(t("manualAssign.pasteHelp")),
  });

type Pair = { judgeId: string; teamId: string };

/**
 * Judges an organizer puts on a team's projects (pins) or keeps off them (conflicts), in one list:
 * the two are opposites, and a conflict wins.
 */
export function ManualAssignments({ eventId }: { eventId: string }) {
  const t = useT();
  const say = useHelperSay();
  const pairs = useMemo(() => pairSchema(t), [t]);
  const pasted = useMemo(() => pasteSchema(t), [t]);
  const queryClient = useQueryClient();
  const { data: conflicts } = useSuspenseQuery(eventConflictsQueryOptions(eventId));
  const { data: pins } = useSuspenseQuery(eventPinsQueryOptions(eventId));
  const { data: progress } = useSuspenseQuery(judgingProgressQueryOptions(eventId));
  const { data: teams } = useSuspenseQuery(eventTeamsQueryOptions(eventId));
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: eventConflictsQueryOptions(eventId).queryKey }),
      // a conflict removes a pin on the same pair
      queryClient.invalidateQueries({ queryKey: eventPinsQueryOptions(eventId).queryKey }),
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
  const pin = async (pair: Pair) => {
    const result = await pinJudgeFn({ data: { eventId, ...pair } }).catch(requestFailure);
    if (!result.ok) return result.error.message;
    setNotice(t("judgePins.pinned", { count: result.data }));
    await refresh();
    return undefined;
  };
  const pairForm = useAppForm({
    ...appFormOptions.strictSchema(pairs, {
      defaultValues: {
        judgeId: "",
        teamId: "",
        kind: "pin" as (typeof KINDS)[number],
        reason: "",
      },
      errorVisibility,
      validators: [rewardEarlyPunishLate(pairs)],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const failure =
        value.kind === "pin"
          ? await pin({ judgeId: value.judgeId, teamId: value.teamId })
          : await record([{ judgeId: value.judgeId, teamId: value.teamId, reason: value.reason }]);
      if (failure) return createValidationError(failure);
      formApi.reset();
      return undefined;
    },
  });
  const pasteForm = useAppForm({
    ...appFormOptions.strictSchema(pasted, {
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
    mutationFn: async (pair: Pair) =>
      unwrap(await removeConflictFn({ data: { eventId, ...pair } })),
    onSuccess: refresh,
  });
  const unpin = useMutation({
    mutationFn: async (pair: Pair) => unwrap(await unpinJudgeFn({ data: { eventId, ...pair } })),
    onSuccess: refresh,
  });
  const rows = [
    ...pins.map((each) => ({ ...each, kind: "pin" as const, reason: "" })),
    ...conflicts.map((each) => ({ ...each, kind: "conflict" as const })),
  ].sort((a, b) => a.judgeName.localeCompare(b.judgeName) || a.teamName.localeCompare(b.teamName));

  return (
    <Screen.Section
      id="manual-assignments"
      title={t("manualAssign.title")}
      description={t("manualAssign.intro")}
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
          <pairForm.Field name="kind">
            {(field) => (
              <field.Field className="w-44">
                <field.Label />
                <FieldSelect
                  field={field}
                  options={[
                    { value: "pin", label: t("manualAssign.always") },
                    { value: "conflict", label: t("manualAssign.never") },
                  ]}
                />
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
          <pairForm.Subscribe selector={(state) => state.values.kind}>
            {(kind) =>
              kind === "conflict" && (
                <pairForm.Field name="reason">
                  {(field) => (
                    <field.Field className="w-56">
                      <field.Label />
                      <field.TextInput maxLength={500} />
                      <field.Error />
                    </field.Field>
                  )}
                </pairForm.Field>
              )
            }
          </pairForm.Subscribe>
          <pairForm.Submit size="sm" variant="outline">
            {t("manualAssign.add")}
          </pairForm.Submit>
          <pairForm.FormAlert title={t("manualAssign.addFailed")} />
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
                        {t("manualAssign.pasteHelp")}
                        {problems.length > 0 &&
                          ` ${problems.map((problem) => t("fairness.lineProblem", { line: problem.line, message: problem.message })).join(" ")}`}
                      </>
                    }
                  />
                  <div>
                    <pasteForm.Submit
                      size="sm"
                      variant="secondary"
                      pending={`${t("webhooks.adding")}...`}
                    >
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
      <ErrorAlert error={lift.error ?? unpin.error} title={t("fairness.updateFailed")} />
      {rows.length === 0 ? (
        <p className="text-sm text-muted-fg">{t("manualAssign.none")}</p>
      ) : (
        <RowList>
          {rows.map((row) => (
            <DisclosureRow
              key={`${row.kind}:${row.judgeId}:${row.teamId}`}
              title={
                <>
                  {row.kind === "pin"
                    ? t("judgePins.pair", { judge: row.judgeName, team: row.teamName })
                    : t("fairness.pair", { judge: row.judgeName, team: row.teamName })}
                  <Badge variant={row.kind === "pin" ? "secondary" : "outline"} className="ml-2">
                    {row.kind === "pin" ? t("manualAssign.pinned") : t("manualAssign.conflict")}
                  </Badge>
                </>
              }
              meta={row.kind === "pin" ? t("judgePins.unpinHelp") : row.reason || undefined}
              actions={
                row.kind === "pin" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={unpin.isPending}
                    onClick={() => unpin.mutate({ judgeId: row.judgeId, teamId: row.teamId })}
                  >
                    {t("judgePins.unpin")}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={lift.isPending}
                    confirm={{
                      title: t("fairness.liftTitle"),
                      description: t("fairness.liftBody", {
                        judge: row.judgeName,
                        team: row.teamName,
                      }),
                      label: t("fairness.lift"),
                    }}
                    onClick={() => lift.mutate({ judgeId: row.judgeId, teamId: row.teamId })}
                  >
                    {t("fairness.liftButton")}...
                  </Button>
                )
              }
            />
          ))}
        </RowList>
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
              to={`/events/${slug}/manage/judging/results`}
              hash="judging.normalize"
            >
              {t("path.judgingNormalize")}
            </SettingLink>,
          ]}
        />
      }
    >
      <RowList>
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
      </RowList>
    </Screen.Section>
  );
}
