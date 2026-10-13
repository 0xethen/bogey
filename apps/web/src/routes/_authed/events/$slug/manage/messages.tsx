import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@bogey/ui/components/button";
import { Screen } from "@bogey/ui/components/screen";
import {
  prefetchSettingFields,
  SettingFields,
} from "#/components/settings/fields/setting-fields.tsx";
import { searchSection, searchSettings } from "#/components/settings/layout/search-entries.ts";
import { msg, useT } from "#/lib/translate.tsx";
import { PluginSettingSections } from "#/components/settings/sections/plugin-sections.tsx";

const CHAT_KEYS = ["enabled", "staff", "participants", "judges", "copyTeam"] as const;

export const Route = createFileRoute("/_authed/events/$slug/manage/messages")({
  staticData: {
    title: msg("eventTab.messages"),
    settings: (t) => [
      searchSection(t("messages.who"), { id: "chat", keywords: ["chat", "questions"] }),
      ...searchSettings("chat", CHAT_KEYS, t),
    ],
  },
  loader: ({ context }) =>
    prefetchSettingFields(context.query, { scope: "event", eventId: context.event.id }, ["chat"]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" />,
});

function RouteComponent() {
  const t = useT();
  const { event } = Route.useRouteContext();
  const scope = { scope: "event", eventId: event.id } as const;
  return (
    <Screen
      title={t("eventTab.messages")}
      description={t("messages.manageIntro")}
      width="embedded"
      actions={
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<Link to="/events/$slug/messages" params={{ slug: event.slug }} />}
        >
          {t("messages.open")}
        </Button>
      }
    >
      <Screen.Section id="chat" title={t("messages.who")}>
        <SettingFields scope={scope} namespace="chat" keys={CHAT_KEYS} />
      </Screen.Section>
      <PluginSettingSections page="messages" />
    </Screen>
  );
}
