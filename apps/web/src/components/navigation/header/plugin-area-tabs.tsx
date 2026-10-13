import { useQuery } from "@tanstack/react-query";
import { useMatch } from "@tanstack/react-router";
import { installedPlugins } from "@bogey/plugins";
import { settingsQueryOptions } from "@bogey/db/queries/settings";
import { offeredPlugins, pluginAreaLinks } from "#/lib/plugins.ts";
import { orgTabs } from "#/lib/org.ts";
import { useT, type T } from "#/lib/translate.tsx";
import { RouteTabs, type RouteTab } from "./TabRow.tsx";

function withPluginTabs(core: Tuple<RouteTab>, plugins: Tuple<RouteTab>): Tuple<RouteTab> {
  if (plugins.length === 0) return core;
  return [...core.slice(0, -1), ...plugins, ...core.slice(-1)];
}

export function OrgTabs() {
  const t = useT();
  const orgId = useMatch({ from: "/_authed/org", shouldThrow: false })?.context.org.id;
  const settings = useQuery({
    ...settingsQueryOptions({ orgId: orgId ?? "" }, ["plugins"]),
    enabled: orgId !== undefined,
  });
  const plugins = settings.data ? offeredPlugins(settings.data.plugins) : [];
  return <RouteTabs tabs={withPluginTabs(orgTabs(t), pluginAreaLinks(plugins, "org"))} />;
}

export const adminTabs = (t: T): Tuple<RouteTab> => [
  { key: "overview", label: t("adminTab.overview"), to: "/admin", exact: true },
  { key: "orgs", label: t("adminTab.orgs"), to: "/admin/orgs" },
  { key: "people", label: t("adminTab.people"), to: "/admin/people" },
  { key: "deletions", label: t("adminTab.deletions"), to: "/admin/deletions" },
  { key: "reports", label: t("adminTab.reports"), to: "/admin/reports" },
  { key: "plugins", label: t("accountNav.plugins"), to: "/admin/plugins" },
  { key: "settings", label: t("orgTab.settings"), to: "/admin/settings" },
];

export function AdminTabs() {
  const t = useT();
  return (
    <RouteTabs tabs={withPluginTabs(adminTabs(t), pluginAreaLinks(installedPlugins(), "admin"))} />
  );
}
