import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ownSettingsQueryOptions, updateSettings } from "@bogey/db/queries/settings";
import { Screen } from "@bogey/ui/components/screen";
import {
  prefetchSettingFields,
  SettingFields,
} from "#/components/settings/fields/setting-fields.tsx";
import { NetworkListForm } from "#/components/settings/fields/network-list.tsx";
import { searchSettings } from "#/components/settings/layout/search-entries.ts";
import { msg, useT } from "#/lib/translate.tsx";

const INSTANCE = { scope: "instance" } as const;

export const Route = createFileRoute("/_authed/admin/settings/network")({
  staticData: {
    title: msg("network.title"),
    settings: (t) => [
      ...searchSettings("network", ["clientIpHeader", "trustedHops"], t),
      { label: t("network.appServers"), keywords: ["proxy", "trusted proxies", "forwarded"] },
    ],
  },
  loader: ({ context }) => prefetchSettingFields(context.query, INSTANCE, ["network"]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" layout="settings" />,
});

function RouteComponent() {
  const t = useT();
  const { data: network } = useSuspenseQuery(ownSettingsQueryOptions(INSTANCE, "network"));
  return (
    <Screen
      title={t("network.title")}
      // todo: switch to 0xethen/bogey repo wiki link
      description={t("network.intro")}
      width="embedded"
    >
      <SettingFields
        scope={INSTANCE}
        namespace="network"
        keys={["clientIpHeader", "trustedHops"]}
      />
      <NetworkListForm
        saved={network.trustedProxies}
        onSave={(trustedProxies) => updateSettings(INSTANCE, "network", { trustedProxies })}
        label={t("network.appServers")}
        placeholder="172.18.0.0/16"
        description={t("network.appServersHelp")}
      />
    </Screen>
  );
}
