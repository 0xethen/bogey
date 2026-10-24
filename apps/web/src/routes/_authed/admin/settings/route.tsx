import { createFileRoute, Outlet } from "@tanstack/react-router";
import {
  IconCalendarCog,
  IconGauge,
  IconMail,
  IconNetwork,
  IconSettings,
  IconUserShield,
  IconWorldSearch,
} from "@tabler/icons-react";
import { preferencesQueryOptions } from "@bogey/db/queries/preferences";
import {
  SettingsLayout,
  type SettingsGroup,
} from "#/components/settings/layout/settings-layout.tsx";
import { msg, useT, type T } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/admin/settings")({
  staticData: { title: msg("orgTab.settings"), command: { label: msg("adminSettings.command") } },
  loader: ({ context }) =>
    context.query.query({ ...preferencesQueryOptions(), staleTime: "static" }),
  component: RouteComponent,
});

const groups = (t: T): Tuple<SettingsGroup> => [
  {
    pages: [
      {
        key: "general",
        label: t("orgSettings.general"),
        icon: IconSettings,
        to: "/admin/settings",
        exact: true,
      },
      {
        key: "accounts",
        label: t("accounts.title"),
        icon: IconUserShield,
        to: "/admin/settings/accounts",
      },
    ],
  },
  {
    label: t("adminTab.orgs"),
    pages: [
      {
        key: "event-defaults",
        label: t("eventDefaults.title"),
        icon: IconCalendarCog,
        to: "/admin/settings/event-defaults",
      },
      { key: "limits", label: t("limits.title"), icon: IconGauge, to: "/admin/settings/limits" },
    ],
  },
  {
    label: t("settingsGroup.delivery"),
    pages: [
      { key: "email", label: t("email.title"), icon: IconMail, to: "/admin/settings/email" },
      {
        key: "search-engines",
        label: t("searchEngines.title"),
        icon: IconWorldSearch,
        to: "/admin/settings/search-engines",
      },
      {
        key: "network",
        label: t("network.title"),
        icon: IconNetwork,
        to: "/admin/settings/network",
      },
    ],
  },
];

function RouteComponent() {
  const t = useT();
  return (
    <SettingsLayout label={t("adminSettings.command")} groups={groups(t)}>
      <Outlet />
    </SettingsLayout>
  );
}
