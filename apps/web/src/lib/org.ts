import type { SectionTab } from "#/components/navigation/header/SectionTabs.tsx";
import type { T } from "#/lib/translate.tsx";

export const orgTabs = (t: T): Tuple<SectionTab> => [
  { key: "events", label: t("orgTab.events"), to: "/org/events" },
  { key: "members", label: t("orgTab.members"), to: "/org/members" },
  { key: "plugins", label: t("accountNav.plugins"), to: "/org/plugins" },
  { key: "audit", label: t("orgTab.audit"), to: "/org/audit" },
  { key: "settings", label: t("orgTab.settings"), to: "/org/settings" },
];
