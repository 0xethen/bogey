import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UserIdentity } from "@supabase/supabase-js";
import { browserClient } from "@bogey/db/browser";
import { stashRedirect } from "@bogey/db/auth";
import { signInProvidersQueryOptions } from "@bogey/db/queries/sign-in";
import { SIGN_IN_PROVIDERS, providerLabel, isSignInProvider } from "@bogey/config/sign-in";
import { Button } from "@bogey/ui/components/button";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Screen } from "@bogey/ui/components/screen";
import { Spinner } from "@bogey/ui/components/spinner";
import { useT, type T } from "#/lib/translate.tsx";

const identitiesKey = ["account", "identities"] as const;

async function loadIdentities(): Promise<Tuple<UserIdentity>> {
  const { data, error } = await browserClient().auth.getUserIdentities();
  if (error) throw error;
  return data.identities;
}

function nameOf(identity: UserIdentity, t: T): string {
  if (identity.provider === "email") return t("security.email");
  return isSignInProvider(identity.provider) ? providerLabel(identity.provider) : identity.provider;
}

function detail(identity: UserIdentity): string | null {
  const email = identity.identity_data?.email;
  return typeof email === "string" ? email : null;
}

export function LinkedSignIns() {
  const t = useT();
  const queryClient = useQueryClient();
  const identities = useQuery({ queryKey: identitiesKey, queryFn: loadIdentities, retry: false });
  const offered = useQuery(signInProvidersQueryOptions());

  const unlink = useMutation({
    mutationFn: async (identity: UserIdentity) => {
      const { error } = await browserClient().auth.unlinkIdentity(identity);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: identitiesKey }),
  });

  const link = useMutation({
    mutationFn: async (key: string) => {
      const provider = SIGN_IN_PROVIDERS.find((each) => each.key === key)?.oauth;
      if (!provider) return;
      stashRedirect("/account/security");
      const { error } = await browserClient().auth.linkIdentity({
        provider,
        options: {
          redirectTo: `${location.origin}/`,
          ...(provider === "azure" ? { scopes: "email" } : {}),
          ...(provider === "keycloak" ? { scopes: "openid" } : {}),
        },
      });
      if (error) {
        throw error.code === "manual_linking_disabled"
          ? new Error(t("security.linkingOff"))
          : error;
      }
    },
  });

  const linked = identities.data ?? [];
  const linkable = (offered.data ?? []).filter(
    (key) => key !== "sso" && !linked.some((identity) => identity.provider === key),
  );
  if (!identities.data || (linked.length < 2 && !linkable.length)) {
    return identities.isPending ? <Spinner /> : null;
  }

  return (
    <Screen.Section
      id="linked-sign-ins"
      title={t("security.linked")}
      description={t("security.linkedHelp")}
    >
      <ul className="flex flex-col gap-2">
        {linked.map((identity) => (
          <li key={identity.identity_id} className="flex items-center justify-between gap-3">
            <span className="flex flex-col">
              <span>{nameOf(identity, t)}</span>
              {detail(identity) && (
                <span className="text-sm text-muted-fg">{detail(identity)}</span>
              )}
            </span>
            {linked.length > 1 && (
              <Button
                variant="outline"
                disabled={unlink.isPending}
                aria-label={`${t("security.unlinkNamed", { name: nameOf(identity, t) })}...`}
                confirm={{
                  title: t("security.unlinkTitle", { name: nameOf(identity, t) }),
                  description: t("security.unlinkBody", { name: nameOf(identity, t) }),
                  label: t("security.unlink"),
                }}
                onClick={() => unlink.mutate(identity)}
              >
                {t("security.unlinkButton")}...
              </Button>
            )}
          </li>
        ))}
      </ul>
      {linkable.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {linkable.map((key) => (
            <Button
              key={key}
              variant="outline"
              disabled={link.isPending}
              onClick={() => link.mutate(key)}
            >
              {t("security.link", { provider: providerLabel(key) })}...
            </Button>
          ))}
        </div>
      )}
      <ErrorAlert error={unlink.error} title={t("security.unlinkFailed")} />
      <ErrorAlert error={link.error} title={t("security.linkFailed")} />
    </Screen.Section>
  );
}
