import { createFileRoute } from "@tanstack/react-router";
import { brand } from "@bogey/config";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ownSettingsQueryOptions, settingsQueryOptions } from "@bogey/db/queries/settings";
import { installedPlugins, pluginEmailKinds } from "@bogey/plugins";
import { Screen } from "@bogey/ui/components/screen";
import { msg, useT } from "#/lib/translate.tsx";
import {
  EmailSettings,
  emailSearchEntries,
} from "#/components/settings/sections/email-settings.tsx";
import { PluginSettingSections } from "#/components/settings/sections/plugin-sections.tsx";

export const Route = createFileRoute("/_authed/events/$slug/manage/email")({
  staticData: {
    title: msg("email.title"),
    settings: (t) => emailSearchEntries("event", t, pluginEmailKinds(installedPlugins())),
  },
  loader: ({ context }) =>
    Promise.all([
      context.query.query({
        ...settingsQueryOptions({ orgId: context.event.org_id, eventId: context.event.id }, [
          "branding",
          "email",
        ]),
        staleTime: "static",
      }),
      context.query.query({
        ...ownSettingsQueryOptions({ scope: "event", eventId: context.event.id }, "email"),
        staleTime: "static",
      }),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" />,
});

function RouteComponent() {
  const t = useT();
  const { event, session } = Route.useRouteContext();
  const { data: settings } = useSuspenseQuery(
    settingsQueryOptions({ orgId: event.org_id, eventId: event.id }, ["branding", "email"]),
  );
  const { data: own } = useSuspenseQuery(
    ownSettingsQueryOptions({ scope: "event", eventId: event.id }, "email"),
  );

  return (
    <Screen title={t("email.title")} description={t("email.eventIntro")} width="embedded">
      <EmailSettings
        scope={{ scope: "event", eventId: event.id }}
        current={own}
        inheritedLayout={settings.email.layout}
        orgName={session.org?.name ?? settings.branding.name ?? brand.name}
        platform={settings.branding.name ?? brand.name}
        pluginKinds={pluginEmailKinds(installedPlugins())}
      />
      <PluginSettingSections page="email" />
    </Screen>
  );
}
