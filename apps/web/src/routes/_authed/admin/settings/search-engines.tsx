import { createFileRoute } from "@tanstack/react-router";
import { Screen } from "@bogey/ui/components/screen";
import {
  prefetchSettingFields,
  SettingFields,
} from "#/components/settings/fields/setting-fields.tsx";
import { searchSettings } from "#/components/settings/layout/search-entries.ts";
import { msg, useT } from "#/lib/translate.tsx";

const INSTANCE = { scope: "instance" } as const;

export const Route = createFileRoute("/_authed/admin/settings/search-engines")({
  staticData: {
    title: msg("searchEngines.title"),
    settings: (t) => searchSettings("seo", ["indexing", "description"], t),
  },
  loader: ({ context }) => prefetchSettingFields(context.query, INSTANCE, ["seo"]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" layout="settings" />,
});

function RouteComponent() {
  const t = useT();
  return (
    <Screen
      title={t("searchEngines.title")}
      description={t("searchEngines.adminIntro")}
      width="embedded"
    >
      <SettingFields scope={INSTANCE} namespace="seo" keys={["indexing", "description"]} />
    </Screen>
  );
}
