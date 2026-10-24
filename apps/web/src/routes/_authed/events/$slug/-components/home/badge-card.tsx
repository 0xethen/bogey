import { z } from "zod";
import { useT } from "#/lib/translate.tsx";
import { useLocale } from "@bogey/ui/lib/locale";
import { useNow } from "@bogey/ui/hooks/now";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconCircleCheck } from "@tabler/icons-react";
import { checkInFn, myBadgeQueryOptions, myCheckInQueryOptions } from "@bogey/db/queries/checkin";
import { settingsQueryOptions } from "@bogey/db/queries/settings";
import { eventWindowsQueryOptions, isWindowOpen, windowByKey } from "@bogey/db/queries/windows";
import { requestFailure } from "@bogey/db/errors";
import { Screen } from "@bogey/ui/components/screen";
import {
  appFormOptions,
  errorVisibility,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { QrCode } from "#/components/event/qr-code.tsx";
import { formatRelative } from "@bogey/utils/time";

const venueCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Enter the venue code")
    .max(20, "Venue codes are at most 20 characters")
    .meta({ label: "Venue code" })
    .describe("Posted at the check-in desk."),
});

export function BadgeCard({ eventId, endsAt }: { eventId: string; endsAt: string | null }) {
  const t = useT();
  const queryClient = useQueryClient();
  const badge = useQuery(myBadgeQueryOptions(eventId));
  const checkedIn = useQuery(myCheckInQueryOptions(eventId));
  const settings = useQuery(settingsQueryOptions({ eventId }, ["checkin"]));
  const windows = useQuery(eventWindowsQueryOptions(eventId));
  const now = useNow(60_000);
  const locale = useLocale();
  const form = useAppForm({
    ...appFormOptions.strictSchema(venueCodeSchema, {
      defaultValues: { code: "" },
      errorVisibility,
      validators: [rewardEarlyPunishLate(venueCodeSchema)],
    }),
    onSubmit: async ({ value, createValidationError, formApi }) => {
      const result = await checkInFn({
        data: { eventId, code: value.code, method: "self" },
      }).catch(requestFailure);
      if (!result.ok) return createValidationError(result.error.message);
      formApi.reset();
      await queryClient.invalidateQueries({ queryKey: myCheckInQueryOptions(eventId).queryKey });
      return undefined;
    },
  });

  if (!badge.data || (endsAt && now !== null && new Date(endsAt).getTime() < now)) return null;
  const when = checkedIn.data;
  const selfOpen =
    settings.data?.checkin.selfCheckIn === true &&
    windows.data !== undefined &&
    isWindowOpen(windowByKey(windows.data, "checkin"));

  return (
    <Screen.Section title={t("badge.title")}>
      <div className="flex flex-wrap items-center gap-6">
        <QrCode value={badge.data.code} label={t("badge.qrLabel", { name: badge.data.name })} />
        <div className="flex flex-col gap-1">
          <p className="font-heading text-xl font-semibold">{badge.data.name}</p>
          <p className="text-sm text-muted-fg">
            {[badge.data.team, badge.data.division].filter(Boolean).join(" · ")}
          </p>
          <p className="font-mono text-lg tracking-widest">{badge.data.code}</p>
          {when ? (
            <p className="flex items-center gap-1 text-sm text-success">
              <IconCircleCheck className="size-4" />
              {t("badge.checkedIn", {
                when: formatRelative(when, now === null ? undefined : new Date(now), locale),
              })}
            </p>
          ) : (
            <p className="text-sm text-muted-fg">{t("badge.showAtDesk")}</p>
          )}
        </div>
      </div>
      {!when && selfOpen && (
        <form.AppForm>
          <form.Form className="flex flex-wrap items-end gap-2">
            <form.Field name="code">
              {(field) => (
                <field.TextField
                  label={t("badge.venueCode")}
                  placeholder={t("badge.venueCodePlaceholder")}
                  autoComplete="off"
                />
              )}
            </form.Field>
            <form.Submit>{t("badge.checkIn")}</form.Submit>
          </form.Form>
          <form.FormAlert title={t("badge.failedTitle")} />
        </form.AppForm>
      )}
    </Screen.Section>
  );
}
