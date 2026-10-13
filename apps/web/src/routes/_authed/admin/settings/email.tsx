import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ownSettingsQueryOptions } from "@bogey/db/queries/settings";
import { brand } from "@bogey/config";
import { installedPlugins, pluginEmailKinds } from "@bogey/plugins";
import { Screen } from "@bogey/ui/components/screen";
import { msg, useT } from "#/lib/translate.tsx";
import {
  EmailSettings,
  emailSearchEntries,
} from "#/components/settings/sections/email-settings.tsx";

const INSTANCE = { scope: "instance" } as const;

export const Route = createFileRoute("/_authed/admin/settings/email")({
  staticData: {
    title: msg("email.title"),
    settings: (t) => emailSearchEntries("instance", t, pluginEmailKinds(installedPlugins())),
  },
  loader: ({ context }) =>
    Promise.all([
      context.query.ensureQueryData(ownSettingsQueryOptions(INSTANCE, "email")),
      context.query.ensureQueryData(ownSettingsQueryOptions(INSTANCE, "branding")),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" layout="settings" />,
});

function RouteComponent() {
  const t = useT();
  const { data: branding } = useSuspenseQuery(ownSettingsQueryOptions(INSTANCE, "branding"));
  const { data: email } = useSuspenseQuery(ownSettingsQueryOptions(INSTANCE, "email"));
  return (
    <Screen title={t("email.title")} description={t("email.adminIntro")} width="embedded">
      <EmailSettings
        scope={INSTANCE}
        current={email}
        orgName="MyOrganization"
        platform={branding.name ?? brand.name}
        pluginKinds={pluginEmailKinds(installedPlugins())}
      />
    </Screen>
  );
}
