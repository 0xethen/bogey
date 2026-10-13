import { createFileRoute } from "@tanstack/react-router";
import { msg, useT } from "#/lib/translate.tsx";
import { Screen } from "@bogey/ui/components/screen";
import { CalendarFeed } from "./-components/calendar-feed.tsx";

export const Route = createFileRoute("/_authed/account/calendar")({
  staticData: {
    title: msg("accountNav.calendar"),
    settings: (t) => [
      { label: t("calendar.feed"), keywords: ["ical", "ics", "google calendar", "outlook"] },
    ],
  },
  component: RouteComponent,
});

function RouteComponent() {
  const t = useT();
  return (
    <Screen title={t("accountNav.calendar")} description={t("calendar.intro")} width="embedded">
      <CalendarFeed />
    </Screen>
  );
}
