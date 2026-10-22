import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { IconEyeOff } from "@tabler/icons-react";
import {
  chooseTeamDivisionFn,
  eventDivisionsQueryOptions,
  type Division,
} from "@bogey/db/queries/divisions";
import {
  formReaches,
  mySubmissionsQueryOptions,
  type MySubmissions,
  type SubmissionFile,
  type SubmissionForm,
} from "@bogey/db/queries/submissions";
import { requestFailure, unwrap } from "@bogey/db/errors";
import { Alert, AlertDescription, AlertTitle } from "@bogey/ui/components/alert";
import { Button } from "@bogey/ui/components/button";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Facts } from "@bogey/ui/components/facts";
import { Screen } from "@bogey/ui/components/screen";
import { canMoveTo, DivisionChoices } from "#/components/event/team/divisions.tsx";
import { useT } from "#/lib/translate.tsx";

export interface ReviewValues {
  title: string;
  answers: { [key: string]: string | boolean };
}

/** The last step of a submission: what judges see first, what's missing, and the team's division. */
export function ReviewStep({
  eventId,
  form,
  values,
  files,
  team,
  blind,
  missing,
  onFix,
  visibility,
}: {
  eventId: string;
  form: SubmissionForm;
  values: ReviewValues;
  files: Tuple<SubmissionFile>;
  team: NonNullable<MySubmissions["team"]>;
  blind: boolean;
  missing: Tuple<string>;
  onFix: () => void;
  visibility: ReactNode;
}) {
  const t = useT();
  const { data: divisions } = useSuspenseQuery(eventDivisionsQueryOptions(eventId));
  const division = divisions.find((each) => each.id === team.divisionId);
  const answerable = form.items.filter((item) => item.kind !== "file");
  const answered = answerable.filter((item) => {
    const value = values.answers[item.key];
    return value !== undefined && value !== "" && value !== false;
  });
  const tagline = form.items
    .filter((item) => item.kind === "text" && !(blind && item.namesPeople))
    .map((item) => values.answers[item.key])
    .find((value): value is string => typeof value === "string" && value.trim() !== "");

  return (
    <div className="flex flex-col gap-10">
      {missing.length > 0 && (
        <Alert>
          <AlertTitle>{t("sub.reviewMissing")}</AlertTitle>
          <AlertDescription>
            <p>{missing.join(", ")}</p>
            <Button type="button" size="sm" variant="outline" className="mt-2" onClick={onFix}>
              {t("sub.reviewFix")}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Screen.Section title={t("sub.reviewJudges")} description={t("sub.reviewJudgesHelp")}>
        <div className="flex flex-col gap-4 rounded-2xl border border-border p-5">
          <div className="flex flex-col gap-1">
            <h3 className="font-heading text-xl font-semibold">
              {values.title.trim() || t("judging.untitled")}
            </h3>
            {tagline && <p className="text-sm text-muted-fg">{tagline}</p>}
          </div>
          <Facts
            facts={[
              {
                label: t("sub.reviewTeam"),
                value: blind ? (
                  <span className="inline-flex items-center gap-1.5 text-muted-fg">
                    <IconEyeOff className="size-4" />
                    {t("sub.reviewTeamHidden")}
                  </span>
                ) : (
                  team.name
                ),
              },
              ...(divisions.length > 0
                ? [
                    {
                      label: t("sub.reviewDivision"),
                      value: division?.name ?? t("sub.reviewNoDivision"),
                    },
                  ]
                : []),
              { label: t("sub.reviewForm"), value: form.title },
              {
                label: t("sub.reviewAnswered"),
                value: t("sub.reviewAnsweredValue", {
                  done: answered.length,
                  total: answerable.length,
                }),
              },
              ...(form.items.some((item) => item.kind === "file")
                ? [
                    {
                      label: t("sub.reviewFiles"),
                      value: t("sub.reviewFilesValue", { count: files.length }),
                    },
                  ]
                : []),
            ]}
          />
        </div>
      </Screen.Section>

      {divisions.length > 0 && (
        <TeamDivision eventId={eventId} form={form} divisions={divisions} current={division} />
      )}

      {visibility}
    </div>
  );
}

function TeamDivision({
  eventId,
  form,
  divisions,
  current,
}: {
  eventId: string;
  form: SubmissionForm;
  divisions: Tuple<Division>;
  current: Division | undefined;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<string | null>(current?.id ?? null);
  const options = divisions.filter(
    (division) => division.id === current?.id || formReaches(form, division.id),
  );
  const canChange = options.some(
    (division) => division.id !== current?.id && canMoveTo(current, division),
  );
  const move = useMutation({
    mutationFn: async (divisionId: string) =>
      unwrap(await chooseTeamDivisionFn({ data: { eventId, divisionId } }).catch(requestFailure)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["divisions", eventId] });
      await queryClient.invalidateQueries({
        queryKey: mySubmissionsQueryOptions(eventId).queryKey,
      });
    },
  });
  if (!canChange) return null;

  return (
    <Screen.Section title={t("sub.reviewDivisionTitle")} description={t("sub.reviewDivisionHelp")}>
      <div className="flex flex-col gap-3">
        <DivisionChoices
          divisions={options}
          value={picked}
          current={current?.id ?? null}
          idPrefix="team-division"
          label={t("sub.reviewDivisionLabel")}
          onChange={setPicked}
        />
        <ErrorAlert error={move.error} title={t("sub.reviewDivisionFailed")} />
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={!picked || picked === current?.id || move.isPending}
            onClick={() => picked && move.mutate(picked)}
          >
            {move.isPending ? t("common.saving") : t("sub.reviewDivisionMove")}
          </Button>
        </div>
      </div>
    </Screen.Section>
  );
}
