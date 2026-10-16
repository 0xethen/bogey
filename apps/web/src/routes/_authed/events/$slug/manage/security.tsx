import { createFileRoute } from "@tanstack/react-router";
import { Screen } from "@bogey/ui/components/screen";
import { searchSection, searchSettings } from "#/components/settings/layout/search-entries.ts";
import {
  prefetchSettingFields,
  SettingFields,
} from "#/components/settings/fields/setting-fields.tsx";
import { PluginSettingSections } from "#/components/settings/sections/plugin-sections.tsx";
import { msg, useT } from "#/lib/translate.tsx";
import { NetworkSection, prefetchNetworkSection } from "./-components/network-section.tsx";
import { VisibilityPicker } from "./-components/visibility-picker.tsx";

export const Route = createFileRoute("/_authed/events/$slug/manage/security")({
  staticData: {
    title: msg("security.title"),
    settings: (t) => [
      searchSection(t("security.publishing"), {
        keywords: ["publish", "draft", "unlisted", "public", "hide", "visibility"],
        id: "publishing",
      }),
      searchSection(t("security.access"), {
        keywords: ["invite only", "approve", "review", "join"],
        id: "access",
      }),
      ...searchSettings("registration", ["mode"], t),
      searchSection(t("security.privacy"), {
        keywords: ["private", "members only", "applicants", "pending", "hide", "agenda", "prizes"],
        id: "privacy",
      }),
      ...searchSettings("privacy", ["about", "agenda", "tracks"], t),
      searchSection(t("manageReg.network"), {
        keywords: ["wifi", "ip", "allowed networks", "venue", "security"],
        id: "network",
      }),
    ],
  },
  loader: ({ context }) =>
    Promise.all([
      prefetchNetworkSection(context.query, context.event.id),
      prefetchSettingFields(context.query, { scope: "event", eventId: context.event.id }, [
        "registration",
        "privacy",
      ]),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" layout="settings" />,
});

function RouteComponent() {
  const t = useT();
  const { event } = Route.useRouteContext();
  return (
    <Screen title={t("security.title")} description={t("security.intro")} width="embedded">
      <Screen.Section
        id="publishing"
        title={t("security.publishing")}
        description={t("security.publishingHelp")}
      >
        <VisibilityPicker event={event} />
      </Screen.Section>
      <Screen.Section
        id="access"
        title={t("security.access")}
        description={t("security.accessHelp")}
      >
        <SettingFields
          scope={{ scope: "event", eventId: event.id }}
          namespace="registration"
          keys={["mode"]}
        />
      </Screen.Section>
      <Screen.Section
        id="privacy"
        title={t("security.privacy")}
        description={t("security.privacyHelp")}
      >
        <SettingFields
          scope={{ scope: "event", eventId: event.id }}
          namespace="privacy"
          keys={["about", "agenda", "tracks"]}
        />
      </Screen.Section>
      <NetworkSection eventId={event.id} />
      <PluginSettingSections page="security" />
    </Screen>
  );
}
