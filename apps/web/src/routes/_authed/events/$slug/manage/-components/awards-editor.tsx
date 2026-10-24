import { useMemo, useState } from "react";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import { IconPlus, IconWand } from "@tabler/icons-react";
import {
  draftAwardsQueryOptions,
  saveAwardsFn,
  type Award,
  type AwardInput,
} from "@bogey/db/queries/awards";
import { eventDivisionsQueryOptions } from "@bogey/db/queries/divisions";
import type { ResultRow } from "@bogey/db/queries/judging";
import { eventEntriesQueryOptions, eventPrizesQueryOptions } from "@bogey/db/queries/prizes";
import { voteCountsQueryOptions } from "@bogey/db/queries/votes";
import { requestFailure } from "@bogey/db/errors";
import { AWARD_KINDS, proposeAwards } from "@bogey/utils/awards";
import { Button } from "@bogey/ui/components/button";
import { EditableList, EditableListItem } from "@bogey/ui/components/editable-list";
import { Screen } from "@bogey/ui/components/screen";
import {
  appFormOptions,
  errorVisibility,
  FieldSelect,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { useT, type T } from "#/lib/translate.tsx";

const awardSchema = (t: T) =>
  z.object({
    uid: z.string(),
    id: z.string(),
    kind: z.enum(AWARD_KINDS),
    label: z
      .string()
      .trim()
      .min(1, t("awardsEditor.nameIt"))
      .max(120, t("form.maxLength", { max: 120 }))
      .meta({ label: t("awardsEditor.award"), placeholder: t("awardsEditor.awardPlaceholder") }),
    place: z.number().nullable(),
    submissionId: z
      .string()
      .min(1, t("awardsEditor.pickWinner"))
      .meta({ label: t("awardsEditor.project"), placeholder: t("awardsEditor.pickProject") }),
    formId: z.string(),
    trackId: z.string(),
    divisionId: z.string(),
    note: z
      .string()
      .max(1000, t("form.maxLength", { max: 1000 }))
      .meta({ label: t("awardsEditor.note"), placeholder: t("awardsEditor.notePlaceholder") }),
  });

const schemaFor = (t: T) =>
  z.object({ awards: z.array(awardSchema(t)).max(200, t("awardsEditor.atMost")) });

type Draft = z.infer<ReturnType<typeof awardSchema>>;

function toDraft(award: Award): Draft {
  return {
    uid: award.id,
    id: award.id,
    kind: award.kind,
    label: award.label,
    place: award.place,
    submissionId: award.submissionId,
    formId: award.formId ?? "",
    trackId: award.trackId ?? "",
    divisionId: award.divisionId ?? "",
    note: award.note,
  };
}

function toInput(draft: Draft): AwardInput {
  return {
    ...(draft.id ? { id: draft.id } : {}),
    kind: draft.kind,
    label: draft.label.trim(),
    place: draft.place,
    submissionId: draft.submissionId,
    formId: draft.formId || null,
    trackId: draft.trackId || null,
    divisionId: draft.divisionId || null,
    note: draft.note,
  };
}

export function AwardsEditor({ eventId, rows }: { eventId: string; rows: Tuple<ResultRow> }) {
  const t = useT();
  const schema = useMemo(() => schemaFor(t), [t]);
  const queryClient = useQueryClient();
  const { data: drafts } = useSuspenseQuery(draftAwardsQueryOptions(eventId));
  const { data: prizes } = useSuspenseQuery(eventPrizesQueryOptions(eventId));
  const { data: entries } = useSuspenseQuery(eventEntriesQueryOptions(eventId));
  const { data: divisions } = useSuspenseQuery(eventDivisionsQueryOptions(eventId));
  const { data: counts } = useSuspenseQuery(voteCountsQueryOptions(eventId));
  const [active, setActive] = useState<string | null>(null);
  const titles = new Map(rows.map((row) => [row.submissionId, `${row.title} (${row.teamName})`]));
  const projectOptions: Tuple<{ value: string; label: string }> = [...titles].map(
    ([value, label]) => ({ value, label }),
  );
  const lastRound = new Map<string, number>();
  for (const row of rows) {
    lastRound.set(row.formId, Math.max(lastRound.get(row.formId) ?? 1, row.roundOrdinal));
  }
  const finalRows = rows.filter((row) => row.roundOrdinal === lastRound.get(row.formId));

  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: { awards: drafts.map(toDraft) },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, createValidationError }) => {
      const result = await saveAwardsFn({
        data: { eventId, awards: value.awards.map(toInput) },
      }).catch(requestFailure);
      if (!result.ok) return createValidationError(result.error.message);
      const saved = await queryClient.fetchQuery({
        ...draftAwardsQueryOptions(eventId),
        staleTime: 0,
      });
      form.reset({ awards: saved.map(toDraft) });
      return undefined;
    },
  });

  const propose = (): Draft[] =>
    proposeAwards({
      rows: finalRows,
      divisions,
      prizes,
      entries,
      votes: counts.map((row) => ({ submissionId: row.submissionId, count: row.count })),
    }).map((award) => ({
      uid: crypto.randomUUID(),
      id: "",
      kind: award.kind,
      label: award.label,
      place: award.place,
      submissionId: award.submissionId,
      formId: award.formId ?? "",
      trackId: award.trackId ?? "",
      divisionId: award.divisionId ?? "",
      note: "",
    }));

  return (
    <Screen.Section id="awards" title={t("results.awards")} description={t("awardsEditor.intro")}>
      <form.AppForm>
        <form.Form unsaved="save">
          <form.Field name="awards">
            {(list) => (
              <div className="flex flex-col gap-4">
                {list.value.length === 0 && (
                  <p className="text-sm text-muted-fg">{t("awardsEditor.none")}</p>
                )}
                <EditableList onMove={(from, to) => list.moveValue(from, to)}>
                  {list.value.map((award, index) => (
                    <EditableListItem
                      key={award.uid}
                      id={award.uid}
                      index={index}
                      noun={t("awardsEditor.noun")}
                      onRemove={() => list.removeValue(index)}
                      preview={
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium">
                            {award.label || t("awardsEditor.unnamed")}
                          </span>
                          <span className="text-sm text-muted-fg">
                            {titles.get(award.submissionId) ?? t("awardsEditor.nonepicked")}
                          </span>
                        </div>
                      }
                      editing={active === award.uid || !award.label.trim() || !award.submissionId}
                      onEdit={() => setActive(award.uid)}
                      onDone={() => setActive(null)}
                    >
                      <form.Field name={`awards[${index}].label`}>
                        {(field) => <field.TextField required />}
                      </form.Field>
                      <form.Field name={`awards[${index}].submissionId`}>
                        {(field) => (
                          <field.Field>
                            <field.Label required />
                            <FieldSelect field={field} options={projectOptions} />
                            <field.Error />
                          </field.Field>
                        )}
                      </form.Field>
                      <form.Field name={`awards[${index}].note`}>
                        {(field) => <field.TextField />}
                      </form.Field>
                    </EditableListItem>
                  ))}
                </EditableList>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={rows.length === 0}
                    confirm={
                      list.value.length > 0
                        ? {
                            title: t("awardsEditor.replaceTitle"),
                            description: t("awardsEditor.replaceBody"),
                            label: t("awardsEditor.replace"),
                          }
                        : undefined
                    }
                    onClick={() => list.handleChange(propose())}
                  >
                    <IconWand />
                    {t("awardsEditor.propose")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={rows.length === 0}
                    onClick={() => {
                      const uid = crypto.randomUUID();
                      list.pushValue({
                        uid,
                        id: "",
                        kind: "special",
                        label: "",
                        place: null,
                        submissionId: "",
                        formId: "",
                        trackId: "",
                        divisionId: "",
                        note: "",
                      });
                      setActive(uid);
                    }}
                  >
                    <IconPlus />
                    {t("awardsEditor.addSpecial")}
                  </Button>
                </div>
                <p className="text-sm text-muted-fg">
                  {t("awardsEditor.count", { count: list.value.length })}
                </p>
                <form.FormAlert title={t("awardsEditor.saveFailed")} />
              </div>
            )}
          </form.Field>
        </form.Form>
      </form.AppForm>
    </Screen.Section>
  );
}
