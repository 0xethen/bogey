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

export const Route = createFileRoute("/_authed/org/settings/email")({
  staticData: {
    title: msg("email.title"),
    settings: (t) => emailSearchEntries("org", t, pluginEmailKinds(installedPlugins())),
  },
  loader: ({ context }) =>
    Promise.all([
      context.query.ensureQueryData(
        settingsQueryOptions({ orgId: context.org.id }, ["branding", "email"]),
      ),
      context.query.ensureQueryData(
        ownSettingsQueryOptions({ scope: "org", orgId: context.org.id }, "email"),
      ),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" layout="settings" />,
});

function RouteComponent() {
  const t = useT();
  const { org } = Route.useRouteContext();
  const { data: settings } = useSuspenseQuery(
    settingsQueryOptions({ orgId: org.id }, ["branding", "email"]),
  );
  const { data: own } = useSuspenseQuery(
    ownSettingsQueryOptions({ scope: "org", orgId: org.id }, "email"),
  );
  return (
    <Screen title={t("email.title")} description={t("email.orgIntro")} width="embedded">
      <EmailSettings
        scope={{ scope: "org", orgId: org.id }}
        current={own}
        inheritedLayout={settings.email.layout}
        orgName={org.name}
        platform={settings.branding.name ?? brand.name}
        pluginKinds={pluginEmailKinds(installedPlugins())}
      />
    </Screen>
  );
}
