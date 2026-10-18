import { useMemo } from "react";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import { activeRound } from "@bogey/utils/rounds";
import { judgingRoundsQueryOptions } from "@bogey/db/queries/judging";
import { eventSubmissionsQueryOptions } from "@bogey/db/queries/submissions";
import { offlineScoresQueryOptions, saveOfflineScoresFn } from "@bogey/db/queries/demos";
import { requestFailure } from "@bogey/db/errors";
import { Screen } from "@bogey/ui/components/screen";
import {
  appFormOptions,
  errorVisibility,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { useT, type T } from "#/lib/translate.tsx";

const scoresSchema = (t: T) =>
  z.object({
    items: z.array(
      z.object({
        roundId: z.string(),
        submissionId: z.string(),
        score: z
          .string()
          .trim()
          .refine(
            (value) => value === "" || Number.isFinite(Number(value)),
            t("offlineScores.number"),
          )
          .meta({ label: t("offlineScores.score") }),
      }),
    ),
  });

/**
 * Scores for rounds judged outside Bogey: organizers type in each entry's total, and results rank
 * them like any other round (higher first).
 */
export function OfflineScores({ eventId }: { eventId: string }) {
  const t = useT();
  const schema = useMemo(() => scoresSchema(t), [t]);
  const queryClient = useQueryClient();
  const { data: rounds } = useSuspenseQuery(judgingRoundsQueryOptions(eventId));
  const { data: submissions } = useSuspenseQuery(eventSubmissionsQueryOptions(eventId));
  const { data: saved } = useSuspenseQuery(offlineScoresQueryOptions(eventId));
  const offline = rounds.rounds.filter((round) => round.format === "offline");
  const entries = submissions
    .filter((submission) => submission.status === "submitted")
    .flatMap((submission) => {
      const round = activeRound(rounds.rounds, rounds.entries, {
        id: submission.id,
        formId: submission.form_id,
      });
      return round && round.format === "offline" ? [{ submission, round }] : [];
    })
    .sort(
      (a, b) =>
        a.round.ordinal - b.round.ordinal ||
        a.submission.teamName.localeCompare(b.submission.teamName),
    );
  const scoreOf = (roundId: string, submissionId: string) => {
    const found = saved.find((row) => row.roundId === roundId && row.submissionId === submissionId);
    return found ? String(found.score) : "";
  };
  const defaults = entries.map(({ submission, round }) => ({
    roundId: round.id,
    submissionId: submission.id,
    score: scoreOf(round.id, submission.id),
  }));

  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: { items: defaults },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
      for (const round of offline) {
        const changed = value.items.filter(
          (item) =>
            item.roundId === round.id &&
            item.score.trim() !== scoreOf(item.roundId, item.submissionId),
        );
        if (changed.length === 0) continue;
        const result = await saveOfflineScoresFn({
          data: {
            roundId: round.id,
            scores: changed.map((item) => ({
              submissionId: item.submissionId,
              score: item.score.trim() === "" ? null : Number(item.score),
            })),
          },
        }).catch(requestFailure);
        if (!result.ok) return createValidationError(result.error.message);
      }
      await queryClient.invalidateQueries({ queryKey: ["results-preview", eventId] });
      const next = await queryClient.fetchQuery({
        ...offlineScoresQueryOptions(eventId),
        staleTime: 0,
      });
      formApi.reset({
        items: value.items.map((item) => {
          const found = next.find(
            (row) => row.roundId === item.roundId && row.submissionId === item.submissionId,
          );
          return { ...item, score: found ? String(found.score) : "" };
        }),
      });
      return undefined;
    },
  });

  if (offline.length === 0) return null;
  return (
    <Screen.Section
      id="offline-scores"
      title={t("offlineScores.title")}
      description={t("offlineScores.intro")}
    >
      {entries.length === 0 ? (
        <p className="text-sm text-muted-fg">{t("offlineScores.none")}</p>
      ) : (
        <form.AppForm>
          <form.Form unsaved="save" className="flex flex-col gap-1">
            {entries.map(({ submission, round }, index) => (
              <form.Field key={`${round.id}:${submission.id}`} name={`items[${index}].score`}>
                {(field) => (
                  <field.Field
                    orientation="inline"
                    className="justify-between gap-4 border-b border-border py-2 last:border-b-0"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium">
                        {submission.title || t("offlineScores.untitled")}
                      </span>
                      <span className="truncate text-xs text-muted-fg">
                        {offline.length > 1
                          ? `${submission.teamName} · ${round.name}`
                          : submission.teamName}
                      </span>
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <field.Label className="sr-only">
                        {t("offlineScores.scoreFor", {
                          title: submission.title || submission.teamName,
                        })}
                      </field.Label>
                      <field.TextInput inputMode="decimal" className="w-24 text-right" />
                      <field.Error />
                    </span>
                  </field.Field>
                )}
              </form.Field>
            ))}
            <form.FormAlert title={t("offlineScores.saveFailed")} />
          </form.Form>
        </form.AppForm>
      )}
    </Screen.Section>
  );
}
