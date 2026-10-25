import { Screen } from "@bogey/ui/components/screen";
import { useT } from "#/lib/translate.tsx";
import { BadgeCard } from "./home/badge-card.tsx";

/** All a participant sees of an event that asks them to check in first (checkin.requiredToEnter). */
export function CheckInGate({
  eventId,
  eventName,
  endsAt,
}: {
  eventId: string;
  eventName: string;
  endsAt: string | null;
}) {
  const t = useT();
  return (
    <Screen
      title={t("checkinGate.title")}
      description={t("checkinGate.body", { event: eventName })}
      width="narrow"
    >
      <BadgeCard eventId={eventId} endsAt={endsAt} />
    </Screen>
  );
}
