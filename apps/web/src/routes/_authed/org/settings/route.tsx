import { createFileRoute, Outlet } from "@tanstack/react-router";
import {
  IconCalendarCog,
  IconCertificate,
  IconKey,
  IconMail,
  IconSettings,
  IconWebhook,
  IconWorldSearch,
} from "@tabler/icons-react";
import { preferencesQueryOptions } from "@bogey/db/queries/preferences";
import {
  SettingsLayout,
  type SettingsGroup,
} from "#/components/settings/layout/settings-layout.tsx";
import { msg, useT, type T } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/org/settings")({
  staticData: { title: msg("orgTab.settings"), command: { label: msg("orgSettings.command") } },
  loader: ({ context }) => context.query.ensureQueryData(preferencesQueryOptions()),
  component: RouteComponent,
});

const groups = (t: T): Tuple<SettingsGroup> => [
  {
    pages: [
      {
        key: "general",
        label: t("orgSettings.general"),
        icon: IconSettings,
        to: "/org/settings",
        exact: true,
      },
      {
        key: "sign-in",
        label: t("signInMethods.title"),
        icon: IconKey,
        to: "/org/settings/sign-in",
      },
      {
        key: "event-defaults",
        label: t("eventDefaults.title"),
        icon: IconCalendarCog,
        to: "/org/settings/event-defaults",
      },
      {
        key: "certificates",
        label: t("certificates.title"),
        icon: IconCertificate,
        to: "/org/settings/certificates",
      },
    ],
  },
  {
    label: t("settingsGroup.communication"),
    pages: [
      { key: "email", label: t("email.title"), icon: IconMail, to: "/org/settings/email" },
      {
        key: "webhooks",
        label: t("webhooks.title"),
        icon: IconWebhook,
        to: "/org/settings/webhooks",
      },
      {
        key: "search-engines",
        label: t("searchEngines.title"),
        icon: IconWorldSearch,
        to: "/org/settings/search-engines",
      },
    ],
  },
];

function RouteComponent() {
  const t = useT();
  return (
    <SettingsLayout label={t("orgSettings.command")} groups={groups(t)}>
      <Outlet />
    </SettingsLayout>
  );
}
