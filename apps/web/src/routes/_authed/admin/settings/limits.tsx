import { createFileRoute } from "@tanstack/react-router";
import { Screen } from "@bogey/ui/components/screen";
import {
  prefetchSettingFields,
  SettingFields,
} from "#/components/settings/fields/setting-fields.tsx";
import { searchSettings } from "#/components/settings/layout/search-entries.ts";
import { msg, useT } from "#/lib/translate.tsx";

const INSTANCE = { scope: "instance" } as const;

const KEYS = [
  "eventsPerOrg",
  "adminsPerOrg",
  "participantsPerEvent",
  "emailsPerDay",
  "storageMbPerOrg",
  "maxUploadMb",
  "customDomainsPerOrg",
  "pendingInvitesPerOrg",
] as const;

export const Route = createFileRoute("/_authed/admin/settings/limits")({
  staticData: { title: msg("limits.title"), settings: (t) => searchSettings("limits", KEYS, t) },
  loader: ({ context }) => prefetchSettingFields(context.query, INSTANCE, ["limits"]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" layout="settings" />,
});

function RouteComponent() {
  const t = useT();
  return (
    <Screen title={t("limits.title")} description={t("limits.intro")} width="embedded">
      <SettingFields scope={INSTANCE} namespace="limits" keys={KEYS} />
    </Screen>
  );
}
