import { useQuery } from "@tanstack/react-query";
import { myPasswordLoginFn } from "@bogey/db/auth";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { SIGN_IN_PROVIDERS } from "@bogey/config/sign-in";
import { Screen } from "@bogey/ui/components/screen";
import { msg, useT } from "#/lib/translate.tsx";
import { searchSection } from "#/components/settings/layout/search-entries.ts";
import { AdminPasswordSection } from "./-components/admin-password.tsx";
import { DevicesSection } from "./-components/devices.tsx";
import { LinkedSignIns } from "./-components/linked-sign-ins.tsx";
import { TwoFactorSection } from "./-components/two-factor.tsx";

export const Route = createFileRoute("/_authed/account/security")({
  staticData: {
    title: msg("accountNav.signInSecurity"),
    settings: (t) => [
      searchSection(t("security.linked"), {
        keywords: SIGN_IN_PROVIDERS.map((provider) => provider.label),
        id: "linked-sign-ins",
      }),
      searchSection(t("security.twoFactor"), {
        keywords: ["mfa", "2fa", "authenticator"],
        id: "two-factor-sign-in",
      }),
      searchSection(t("security.password"), { id: "password" }),
    ],
  },
  validateSearch: z.object({ mfa: z.literal("admin").optional().catch(undefined) }),
  component: RouteComponent,
});

function RouteComponent() {
  const t = useT();
  const { session } = Route.useRouteContext();
  const { mfa } = Route.useSearch();
  const passwordLogin = useQuery({
    queryKey: ["password-login", session.user.id] as const,
    queryFn: () => myPasswordLoginFn(),
    enabled: !session.platformAdmin,
  });
  return (
    <Screen title={t("accountNav.signInSecurity")} width="embedded">
      {mfa === "admin" && <TwoFactorSection forAdmin />}
      <LinkedSignIns />
      {mfa !== "admin" && <TwoFactorSection />}
      {(session.platformAdmin || passwordLogin.data) && <AdminPasswordSection />}
      <DevicesSection />
    </Screen>
  );
}
