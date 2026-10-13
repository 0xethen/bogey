import { createFileRoute } from "@tanstack/react-router";
import { Screen } from "@bogey/ui/components/screen";
import { msg, useT } from "#/lib/translate.tsx";
import { prefetchSettingFields } from "#/components/settings/fields/setting-fields.tsx";
import {
  EVENT_DEFAULT_NAMESPACES,
  eventDefaultsSearch,
  EventDefaults,
} from "#/components/settings/sections/event-defaults.tsx";

export const Route = createFileRoute("/_authed/org/settings/event-defaults")({
  staticData: { title: msg("eventDefaults.title"), settings: eventDefaultsSearch },
  loader: ({ context }) =>
    prefetchSettingFields(
      context.query,
      { scope: "org", orgId: context.org.id },
      EVENT_DEFAULT_NAMESPACES,
    ),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" layout="settings" />,
});

function RouteComponent() {
  const t = useT();
  const { org } = Route.useRouteContext();
  return (
    <Screen
      title={t("eventDefaults.title")}
      description={t("eventDefaults.intro")}
      width="embedded"
    >
      <EventDefaults scope={{ scope: "org", orgId: org.id }} />
    </Screen>
  );
}
