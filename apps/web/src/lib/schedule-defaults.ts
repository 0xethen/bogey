import type { WindowChange } from "@bogey/db/queries/manage";
import type { Enums } from "@bogey/db/types";
import type { PlainKey } from "#/lib/translate.tsx";

type Kind = Enums<"event_kind">;

export interface DefaultWindow extends WindowChange {
  when: PlainKey;
}

export function defaultSchedule(
  kind: Kind,
  startsAt: string | null,
  endsAt: string | null,
  now: string,
): DefaultWindow[] {
  if (!startsAt || !endsAt) return [];
  const window = (
    key: string,
    opens_at: string | null,
    closes_at: string | null,
    when: PlainKey,
  ): DefaultWindow => ({ key, opens_at, closes_at, override: null, when });

  const registration = window("registration", now, startsAt, "schedule.untilStart");
  if (kind !== "hackathon") return [registration];
  return [
    registration,
    window("teams", now, endsAt, "schedule.untilEnd"),
    window("instructions", startsAt, null, "schedule.fromStart"),
    window("submissions", startsAt, endsAt, "schedule.whileRuns"),
    window("judging", endsAt, null, "schedule.fromEnd"),
  ];
}
