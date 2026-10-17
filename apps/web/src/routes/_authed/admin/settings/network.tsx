import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ownSettingsQueryOptions } from "@bogey/db/queries/settings";
import { Screen } from "@bogey/ui/components/screen";
import { Textarea } from "@bogey/ui/components/textarea";
import { operatorConfigPath } from "@bogey/config/settings";
import {
  prefetchSettingFields,
  SettingFields,
} from "#/components/settings/fields/setting-fields.tsx";
import { SettingRow } from "#/components/settings/fields/setting-row.tsx";
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
      description={
        <>
          {t("network.intro")}{" "}
          <a
            href="https://github.com/0xethen/bogey/wiki/self-hosting/network"
            target="_blank"
            rel="noreferrer noopener"
            className="link"
          >
            {t("network.introLink")}
          </a>
        </>
      }
      width="embedded"
    >
      <SettingFields
        scope={INSTANCE}
        namespace="network"
        keys={["clientIpHeader", "trustedHops"]}
      />
      <SettingRow
        id="network-trustedProxies"
        anchor="network.trustedProxies"
        keyName="trustedProxies"
        label={t("network.appServers")}
        description={t("network.appServersHelp")}
        source={{ kind: "operator", path: operatorConfigPath("network", "trustedProxies") }}
      >
        <Textarea
          id="network-trustedProxies"
          value={network.trustedProxies?.join("\n") ?? ""}
          placeholder={t("network.none")}
          rows={Math.max(2, network.trustedProxies?.length ?? 0)}
          className="font-mono"
          readOnly
          disabled
        />
      </SettingRow>
    </Screen>
  );
}
