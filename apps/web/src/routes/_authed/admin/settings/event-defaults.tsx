import { createFileRoute } from "@tanstack/react-router";
import { Screen } from "@bogey/ui/components/screen";
import { msg, useT } from "#/lib/translate.tsx";
import { prefetchSettingFields } from "#/components/settings/fields/setting-fields.tsx";
import {
  EVENT_DEFAULT_NAMESPACES,
  eventDefaultsSearch,
  EventDefaults,
} from "#/components/settings/sections/event-defaults.tsx";

const INSTANCE = { scope: "instance" } as const;

export const Route = createFileRoute("/_authed/admin/settings/event-defaults")({
  staticData: { title: msg("eventDefaults.title"), settings: eventDefaultsSearch },
  loader: ({ context }) => prefetchSettingFields(context.query, INSTANCE, EVENT_DEFAULT_NAMESPACES),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" layout="settings" />,
});

function RouteComponent() {
  const t = useT();
  return (
    <Screen
      title={t("eventDefaults.title")}
      description={t("eventDefaults.adminIntro")}
      width="embedded"
    >
      <EventDefaults scope={INSTANCE} />
    </Screen>
  );
}
