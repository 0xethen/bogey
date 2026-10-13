import { createFileRoute } from "@tanstack/react-router";
import { msg, useT } from "#/lib/translate.tsx";
import { Screen } from "@bogey/ui/components/screen";
import { NotificationSettings } from "./-components/notification-settings.tsx";

export const Route = createFileRoute("/_authed/account/notifications")({
  staticData: {
    title: msg("accountNav.notifications"),
    settings: (t) => [{ label: t("nav.notifications"), keywords: ["email", "bell", "alerts"] }],
  },
  component: RouteComponent,
});

function RouteComponent() {
  const t = useT();
  return (
    <Screen
      title={t("accountNav.notifications")}
      description={t("notifications.intro")}
      width="embedded"
    >
      <NotificationSettings />
    </Screen>
  );
}
