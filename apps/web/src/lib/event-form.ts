import { z } from "zod";
import { eventSlugTakenFn } from "@bogey/db/queries/org";
import { SLUG } from "@bogey/utils/keys";
import type { T } from "#/lib/translate.tsx";

export const slugSchema = (t: T) =>
  z
    .string()
    .min(1, { message: t("eventForm.chooseAddress"), abort: true })
    .max(64, t("form.maxLength", { max: 64 }))
    .regex(SLUG, t("eventForm.slugRule"));

const teamSize = (t: T) =>
  z
    .number(t("orgLimit.enterNumber"))
    .int(t("eventForm.whole"))
    .min(1, t("eventForm.atLeast", { min: 1 }))
    .max(50, t("eventForm.atMost", { max: 50 }));

export const eventFields = (t: T) => ({
  name: z
    .string()
    .trim()
    .min(1, t("eventForm.needName"))
    .max(120, t("form.maxLength", { max: 120 }))
    .meta({ label: t("checkin.name") }),
  slug: slugSchema(t).meta({ label: t("eventForm.address"), placeholder: "spring-hack" }),
  timezone: z
    .string()
    .min(1, t("eventForm.chooseZone"))
    .meta({ label: t("prefs.timezone") })
    .describe(t("eventForm.zoneHelp")),
  startsAt: z.string().meta({ label: t("eventForm.starts") }),
  endsAt: z.string().meta({ label: t("eventForm.ends") }),
  teamMin: teamSize(t).meta({ label: t("eventForm.teamMin") }),
  teamMax: teamSize(t).meta({ label: t("eventForm.teamMax") }),
});

export const checkEventRanges =
  (t: T) =>
  (
    value: { startsAt: string; endsAt: string; teamMin: number; teamMax: number },
    ctx: z.RefinementCtx,
  ) => {
    if (value.startsAt && value.endsAt && value.endsAt <= value.startsAt) {
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: t("eventForm.endAfter") });
    }
    if (value.teamMax < value.teamMin) {
      ctx.addIssue({ code: "custom", path: ["teamMax"], message: t("eventForm.teamOrder") });
    }
  };

export async function slugTaken(
  orgId: string,
  slug: string,
  signal: AbortSignal,
  t: T,
  exceptEventId?: string,
): Promise<string | undefined> {
  const result = await eventSlugTakenFn({ data: { orgId, slug, exceptEventId }, signal });
  return result.ok && result.data ? t("eventForm.taken") : undefined;
}
