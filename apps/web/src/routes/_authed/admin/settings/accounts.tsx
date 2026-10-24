import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ownSettingsQueryOptions } from "@bogey/db/queries/settings";
import { Screen } from "@bogey/ui/components/screen";
import {
  prefetchSettingFields,
  SettingFields,
} from "#/components/settings/fields/setting-fields.tsx";
import { searchSection, searchSettings } from "#/components/settings/layout/search-entries.ts";
import { msg, useT } from "#/lib/translate.tsx";
import { signInSearch, SignInMethods } from "#/components/settings/sections/sign-in-methods.tsx";

const INSTANCE = { scope: "instance" } as const;

export const Route = createFileRoute("/_authed/admin/settings/accounts")({
  staticData: {
    title: msg("accounts.title"),
    settings: (t) => [
      searchSection(t("accounts.section"), {
        keywords: ["delete", "mfa", "two-factor", "portfolio", "profile"],
        id: "accounts",
      }),
      ...searchSettings(
        "accounts",
        ["portfolios", "deletionRequests", "requireAdminMfa", "deviceSignOut", "maxPasskeys"],
        t,
      ),
      signInSearch(t),
    ],
  },
  loader: ({ context }) =>
    Promise.all([
      context.query.query({ ...ownSettingsQueryOptions(INSTANCE, "signin"), staleTime: "static" }),
      prefetchSettingFields(context.query, INSTANCE, ["accounts"]),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" layout="settings" />,
});

function RouteComponent() {
  const t = useT();
  const queryClient = useQueryClient();
  return (
    <Screen title={t("accounts.title")} description={t("accounts.intro")} width="embedded">
      <Screen.Section id="accounts" title={t("accounts.section")}>
        <SettingFields
          scope={INSTANCE}
          namespace="accounts"
          keys={[
            "portfolios",
            "deletionRequests",
            "requireAdminMfa",
            "deviceSignOut",
            "maxPasskeys",
          ]}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ["account"] })}
        />
      </Screen.Section>
      <Screen.Section
        id="sign-in-methods"
        title={t("signInMethods.title")}
        description={t("signInMethods.adminIntro")}
      >
        <SignInMethods scope={INSTANCE} />
      </Screen.Section>
    </Screen>
  );
}
