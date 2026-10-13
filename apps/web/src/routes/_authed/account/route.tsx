import { createFileRoute, Outlet } from "@tanstack/react-router";
import {
  IconAccessible,
  IconAdjustments,
  IconBell,
  IconCalendar,
  IconKeyboard,
  IconPuzzle,
  IconShieldLock,
  IconUser,
} from "@tabler/icons-react";
import { preferencesQueryOptions } from "@bogey/db/queries/preferences";
import { installedPlugins, loadedPluginSlots } from "@bogey/plugins";
import { useT } from "#/lib/translate.tsx";
import { pluginAreaLinks } from "#/lib/plugins.ts";
import {
  SettingsLayout,
  type SettingsGroup,
} from "#/components/settings/layout/settings-layout.tsx";

export const Route = createFileRoute("/_authed/account")({
  staticData: {
    title: "Account",
    command: { group: "Account", keywords: ["profile", "preferences"] },
  },
  loader: ({ context }) => context.query.ensureQueryData(preferencesQueryOptions()),
  component: RouteComponent,
});

function RouteComponent() {
  const t = useT();
  const pluginPreferences = loadedPluginSlots().some(({ slots }) => slots.preferencesPanel);
  const pluginPages = pluginAreaLinks(installedPlugins(), "account").map(
    ({ key, label, to, exact }) => ({ key, label, to, exact, icon: IconPuzzle }),
  );
  const groups: Tuple<SettingsGroup> = [
    {
      pages: [
        {
          key: "profile",
          label: t("accountNav.profile"),
          icon: IconUser,
          to: "/account",
          exact: true,
        },
        {
          key: "preferences",
          label: t("accountNav.preferences"),
          icon: IconAdjustments,
          to: "/account/preferences",
        },
        {
          key: "accessibility",
          label: t("accountNav.accessibility"),
          icon: IconAccessible,
          to: "/account/accessibility",
        },
        {
          key: "notifications",
          label: t("accountNav.notifications"),
          icon: IconBell,
          to: "/account/notifications",
        },
        {
          key: "calendar",
          label: t("accountNav.calendar"),
          icon: IconCalendar,
          to: "/account/calendar",
        },
        {
          key: "shortcuts",
          label: t("accountNav.shortcuts"),
          icon: IconKeyboard,
          to: "/account/shortcuts",
        },
      ],
    },
    {
      label: t("accountNav.security"),
      pages: [
        {
          key: "security",
          label: t("accountNav.signInSecurity"),
          icon: IconShieldLock,
          to: "/account/security",
        },
      ],
    },
    ...(pluginPreferences || pluginPages.length > 0
      ? [
          {
            label: t("accountNav.plugins"),
            pages: [
              ...(pluginPreferences
                ? [
                    {
                      key: "plugins",
                      label: t("accountNav.plugins"),
                      icon: IconPuzzle,
                      to: "/account/plugins",
                    },
                  ]
                : []),
              ...pluginPages,
            ],
          },
        ]
      : []),
  ];
  return (
    <SettingsLayout label={t("accountNav.label")} groups={groups}>
      <Outlet />
    </SettingsLayout>
  );
}
