import { createServerFn } from "@tanstack/react-start";
import { getRequestHost, getRequestProtocol } from "@tanstack/react-start/server";
import { queryOptions } from "@tanstack/react-query";
import {
  effectiveProviders,
  isSignInProvider,
  SIGN_IN_PROVIDERS,
  type SignInProvider,
} from "@bogey/config/sign-in";
import { captchaToken } from "../auth.ts";
import { createAdminClient } from "../admin.ts";
import { getPublicEnv } from "../env.ts";
import { timeoutFetch } from "../fetch.ts";
import { createServerClient } from "../server.ts";
import { getOrgFn } from "../tenant.ts";

async function authEnabled(): Promise<Set<SignInProvider>> {
  const { supabaseUrl, supabaseKey } = getPublicEnv();
  const enabled = new Set<SignInProvider>();
  try {
    const response = await timeoutFetch()(`${supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: supabaseKey },
    });
    if (!response.ok) return enabled;
    const settings: unknown = await response.json();
    if (typeof settings !== "object" || settings === null) return enabled;
    const external = "external" in settings ? settings.external : null;
    for (const provider of SIGN_IN_PROVIDERS) {
      if (provider.oauth === null) continue;
      if (typeof external === "object" && external !== null && provider.key in external) {
        if (Reflect.get(external, provider.key) === true) enabled.add(provider.key);
      }
    }
    if ("saml_enabled" in settings && settings.saml_enabled === true) enabled.add("sso");
  } catch {}
  return enabled;
}

function listOf(value: unknown): Tuple<SignInProvider> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const providers = Reflect.get(value, "providers");
  return Array.isArray(providers) ? providers.filter(isSignInProvider) : undefined;
}

async function configured(orgId: string): Promise<Tuple<SignInProvider>> {
  const { data } = await createAdminClient()
    .from("settings")
    .select("scope, value")
    .eq("namespace", "signin")
    .or(`scope.eq.instance,org_id.eq.${orgId}`);
  const rows = data ?? [];
  const instance = listOf(rows.find((row) => row.scope === "instance")?.value);
  const org = listOf(rows.find((row) => row.scope === "org")?.value);
  return effectiveProviders(instance, org);
}

export const signInProvidersFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<Tuple<SignInProvider>> => {
    const org = await getOrgFn();
    if (!org.ok || !org.data) return [];
    const [listed, enabled] = await Promise.all([configured(org.data.id), authEnabled()]);
    return listed.filter((key) => enabled.has(key));
  },
);

export const signInProvidersQueryOptions = () =>
  queryOptions({
    queryKey: ["auth", "providers"] as const,
    queryFn: () => signInProvidersFn(),
    staleTime: 5 * 60_000,
  });

export const authProvidersFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<Tuple<SignInProvider>> => [...(await authEnabled())],
);

export const authProvidersQueryOptions = () =>
  queryOptions({
    queryKey: ["auth", "providers-on"] as const,
    queryFn: () => authProvidersFn(),
    staleTime: 60_000,
  });

const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export type ProviderUrl = { ok: true; url: string } | { ok: false; message: string };

export const signInProviderUrlFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { provider?: unknown; email?: unknown; captchaToken?: unknown };
    if (!isSignInProvider(raw.provider)) throw new Error("Unknown sign-in method");
    const domain =
      typeof raw.email === "string" ? (raw.email.trim().toLowerCase().split("@").at(-1) ?? "") : "";
    if (raw.provider === "sso" && !DOMAIN.test(domain)) {
      throw new Error("Enter your work email address");
    }
    return { provider: raw.provider, domain, captchaToken: captchaToken(raw.captchaToken) };
  })
  .handler(async ({ data }): Promise<ProviderUrl> => {
    const org = await getOrgFn();
    const offered = org.ok && org.data ? await signInProvidersFn() : [];
    if (!offered.includes(data.provider)) {
      return { ok: false, message: "That sign-in method isn't available here." };
    }
    const supabase = createServerClient();
    const origin = `${getRequestProtocol({ xForwardedProto: true })}://${getRequestHost({ xForwardedHost: true })}`;
    const options = { redirectTo: `${origin}/`, skipBrowserRedirect: true };

    if (data.provider === "sso") {
      const { data: sso, error } = await supabase.auth.signInWithSSO({
        domain: data.domain,
        options: { ...options, captchaToken: data.captchaToken },
      });
      if (error || !sso?.url) {
        if (error?.code === "sso_provider_not_found") {
          return { ok: false, message: "Single sign-on isn't set up for that address." };
        }
        if (error?.code === "captcha_failed") {
          return { ok: false, message: "Complete the check above, then try again." };
        }
        if (error) console.error("[bogey] starting single sign-on failed:", error);
        return { ok: false, message: "Couldn't start single sign-on." };
      }
      return { ok: true, url: sso.url };
    }

    const oauth = SIGN_IN_PROVIDERS.find((provider) => provider.key === data.provider)?.oauth;
    if (!oauth) return { ok: false, message: "That sign-in method isn't available here." };
    const { data: started, error } = await supabase.auth.signInWithOAuth({
      provider: oauth,
      options: {
        ...options,
        ...(oauth === "azure" ? { scopes: "email" } : {}),
        ...(oauth === "keycloak" ? { scopes: "openid" } : {}),
      },
    });
    if (error || !started.url) {
      if (error) console.error(`[bogey] starting ${oauth} sign-in failed:`, error);
      return { ok: false, message: "Couldn't start sign-in." };
    }
    return { ok: true, url: started.url };
  });
