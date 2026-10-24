import { createFileRoute } from "@tanstack/react-router";
import { ownSettingsQueryOptions } from "@bogey/db/queries/settings";
import { installedPlugins } from "@bogey/plugins";
import { Screen } from "@bogey/ui/components/screen";
import { msg, useT } from "#/lib/translate.tsx";
import { OrgPlugins } from "./-components/org-plugins.tsx";
import { ownPluginSettingsQueryOptions } from "#/lib/plugins.ts";

export const Route = createFileRoute("/_authed/org/plugins")({
  staticData: {
    title: msg("accountNav.plugins"),
    command: { label: msg("orgExt.command") },
  },
  loader: ({ context }) =>
    Promise.all([
      context.query.query({
        ...ownSettingsQueryOptions({ scope: "org", orgId: context.org.id }, "plugins"),
        staleTime: "static",
      }),
      ...installedPlugins().map((manifest) =>
        context.query.query({
          ...ownPluginSettingsQueryOptions({ scope: "org", orgId: context.org.id }, manifest.key),
          staleTime: "static",
        }),
      ),
    ]),
  component: RouteComponent,
});

function RouteComponent() {
  const t = useT();
  const { org } = Route.useRouteContext();
  return (
    <Screen title={t("accountNav.plugins")} description={t("orgExt.intro")} width="narrow">
      <OrgPlugins orgId={org.id} />
    </Screen>
  );
}
