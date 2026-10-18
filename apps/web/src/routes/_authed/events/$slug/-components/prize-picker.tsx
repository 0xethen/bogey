import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  eventPrizesQueryOptions,
  setSubmissionTracksFn,
  submissionTracksQueryOptions,
} from "@bogey/db/queries/prizes";
import { settingsQueryOptions } from "@bogey/db/queries/settings";
import { requestFailure, unwrap } from "@bogey/db/errors";
import { Checkbox } from "@bogey/ui/components/checkbox";
import { CheckboxGroup } from "@bogey/ui/components/checkbox-group";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Screen } from "@bogey/ui/components/screen";
import { PrizeCard } from "#/components/event/judging/prize-card.tsx";
import { useT } from "#/lib/translate.tsx";

export function PrizePicker({
  eventId,
  orgId,
  submissionId,
  formId,
  disabled,
}: {
  eventId: string;
  orgId: string;
  submissionId: string;
  formId: string;
  disabled: boolean;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const prizes = useQuery(eventPrizesQueryOptions(eventId));
  const entered = useQuery(submissionTracksQueryOptions(submissionId));
  const settings = useQuery(settingsQueryOptions({ orgId, eventId }, ["submissions"]));
  const save = useMutation({
    mutationFn: async (tracks: string[]) =>
      unwrap(await setSubmissionTracksFn({ data: { submissionId, tracks } }).catch(requestFailure)),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: submissionTracksQueryOptions(submissionId).queryKey,
      }),
  });

  const current = entered.data ?? [];
  const open = (prizes.data ?? []).filter(
    (prize) =>
      (prize.formId === null || prize.formId === formId) &&
      (prize.optIn || current.includes(prize.id)),
  );
  if (open.length === 0) return null;
  const max = settings.data?.submissions.maxTracks;
  const prompt = settings.data?.submissions.prizePrompt || t("prizes.choose");

  return (
    <Screen.Section
      id="prizes"
      title={t("prizes.title")}
      description={`${prompt}${max ? ` ${t("prizes.upTo", { max })}` : ""}`}
    >
      <CheckboxGroup
        value={current}
        disabled={disabled || save.isPending}
        onValueChange={(next) => save.mutate(next)}
      >
        {open.map((prize) => (
          <label key={prize.id} className="flex items-start gap-3">
            <Checkbox value={prize.id} disabled={!prize.optIn} className="mt-1" />
            <PrizeCard prize={prize} image={settings.data?.submissions.prizeImage} />
          </label>
        ))}
      </CheckboxGroup>
      <ErrorAlert error={save.error} title={t("prizes.saveFailed")} />
    </Screen.Section>
  );
}
