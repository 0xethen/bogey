import { createFileRoute } from "@tanstack/react-router";
import { Screen } from "@bogey/ui/components/screen";
import {
  prefetchSettingFields,
  SettingFields,
} from "#/components/settings/fields/setting-fields.tsx";
import { searchSettings } from "#/components/settings/layout/search-entries.ts";
import { msg, useT } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/org/settings/search-engines")({
  staticData: {
    title: msg("searchEngines.title"),
    settings: (t) => searchSettings("seo", ["indexing", "description"], t),
  },
  loader: ({ context }) =>
    prefetchSettingFields(context.query, { scope: "org", orgId: context.org.id }, ["seo"]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" layout="settings" />,
});

function RouteComponent() {
  const t = useT();
  const { org } = Route.useRouteContext();
  return (
    <Screen
      title={t("searchEngines.title")}
      description={t("searchEngines.orgIntro", { org: org.name })}
      width="embedded"
    >
      <SettingFields
        scope={{ scope: "org", orgId: org.id }}
        namespace="seo"
        keys={["indexing", "description"]}
      />
    </Screen>
  );
}
