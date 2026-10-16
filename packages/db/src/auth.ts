import { createServerFn } from "@tanstack/react-start";
import {
  deleteCookie,
  getCookie,
  getRequestHost,
  getRequestProtocol,
} from "@tanstack/react-start/server";
import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { createServerClient } from "./server.ts";
import { getOrgFn, type Org } from "./tenant.ts";
import { resolveSettings } from "@bogey/config/settings";
import type { Enums, Tables } from "./types.ts";

export type OrgRole = Enums<"org_role">;

export interface Session {
  user: { id: string; email: string | null };
  profile: Tables<"profiles"> | null;
  org: Org | null;
  orgRole: OrgRole | null;
  platformAdmin: boolean;
  adminNeedsMfa: boolean;
}

export function isOrgAdmin(session: Session | null | undefined): boolean {
  return session?.orgRole === "admin" || session?.orgRole === "owner";
}

export type SessionResult =
  | { status: "authenticated"; session: Session }
  | { status: "anonymous" }
  | { status: "unavailable" };

export function classifyUserResult(error: unknown, hasUser: boolean) {
  if (isAuthRetryableFetchError(error)) return "unavailable" as const;
  if (error || !hasUser) return "anonymous" as const;
  return "authenticated" as const;
}

export const getSessionFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<SessionResult> => {
    const supabase = createServerClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();

    const classification = classifyUserResult(userError, !!userData.user);
    if (classification !== "authenticated" || !userData.user) {
      return { status: classification === "authenticated" ? "anonymous" : classification };
    }
    const userId = userData.user.id;

    const [orgResult, { data: profile }, { data: mfa }] = await Promise.all([
      getOrgFn(),
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.rpc("admin_mfa_status"),
    ]);
    const status = mfa && typeof mfa === "object" && !Array.isArray(mfa) ? mfa : {};
    const holdsRole = status.admin === true;
    const needsMfa = holdsRole && status.required === true && status.aal !== "aal2";
    const org = orgResult.ok ? orgResult.data : null;

    let orgRole: OrgRole | null = null;
    if (org) {
      const { data: membership } = await supabase
        .from("org_members")
        .select("role")
        .eq("org_id", org.id)
        .eq("user_id", userId)
        .maybeSingle();
      orgRole = membership?.role ?? null;
    }

    return {
      status: "authenticated",
      session: {
        user: { id: userId, email: userData.user.email ?? null },
        profile: profile ?? null,
        org,
        orgRole,
        platformAdmin: holdsRole && !needsMfa,
        adminNeedsMfa: needsMfa,
      },
    };
  },
);

export const sessionQueryKey = ["session"] as const;

export const sessionQueryOptions = () =>
  queryOptions({
    queryKey: sessionQueryKey,
    queryFn: () => getSessionFn(),
    staleTime: 10_000,
  });

export const exchangeCodeForSessionFn = createServerFn({ method: "POST" })
  .validator((code: unknown) => {
    if (typeof code !== "string" || !code) throw new Error("Missing auth code");
    return code;
  })
  .handler(async ({ data: code }) => {
    const supabase = createServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return { ok: !error };
  });

export const verifyEmailOtpFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const { email, token } = (input ?? {}) as { email?: unknown; token?: unknown };
    if (typeof email !== "string" || !email) throw new Error("Missing email");
    if (typeof token !== "string" || !/^\d{6}$/.test(token)) {
      throw new Error("Enter the six-digit code from your email");
    }
    return { email, token };
  })
  .handler(async ({ data }): Promise<{ ok: boolean; retryable: boolean }> => {
    const supabase = createServerClient();
    const { error } = await supabase.auth.verifyOtp({
      email: data.email,
      token: data.token,
      type: "email",
    });
    if (error) return { ok: false, retryable: isAuthRetryableFetchError(error) };
    return { ok: true, retryable: false };
  });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Supabase Auth checks it against the provider when captcha protection is on
export function captchaToken(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 ? value : undefined;
}

async function adminStatus(
  supabase: ReturnType<typeof createServerClient>,
): Promise<{ admin: boolean; required: boolean; aal: string } | null> {
  const { data, error } = await supabase.rpc("admin_mfa_status");
  if (error || !data || typeof data !== "object" || Array.isArray(data)) return null;
  return {
    admin: data.admin === true,
    required: data.required === true,
    aal: typeof data.aal === "string" ? data.aal : "aal1",
  };
}

// a platform admin turned on password sign-in for this account (Instance → People)
async function hasPasswordLogin(supabase: ReturnType<typeof createServerClient>): Promise<boolean> {
  const { data: userData } = await supabase.auth.getUser();
  const id = userData.user?.id;
  if (!id) return false;
  const { data } = await supabase.from("password_logins").select("user_id").eq("user_id", id);
  return (data?.length ?? 0) > 0;
}

export const myPasswordLoginFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<boolean> => hasPasswordLogin(createServerClient()),
);

export const PASSWORD_MIN = 12;

export type PasswordSignInResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "not_admin" | "unreachable" | "rate_limited" | "captcha" };

export const signInWithPasswordFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { email?: unknown; password?: unknown; captchaToken?: unknown };
    const { email, password } = raw;
    if (typeof email !== "string" || !EMAIL.test(email)) throw new Error("Enter your email");
    if (typeof password !== "string" || !password || password.length > 200) {
      throw new Error("Enter your password");
    }
    return { email: email.trim(), password, captchaToken: captchaToken(raw.captchaToken) };
  })
  .handler(async ({ data }): Promise<PasswordSignInResult> => {
    const supabase = createServerClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
      options: { captchaToken: data.captchaToken },
    });
    if (error) {
      if (isAuthRetryableFetchError(error)) return { ok: false, reason: "unreachable" };
      if (error.status === 429) return { ok: false, reason: "rate_limited" };
      if (error.code === "captcha_failed") return { ok: false, reason: "captcha" };
      return { ok: false, reason: "invalid" };
    }
    const status = await adminStatus(supabase);
    if (!status?.admin && !(await hasPasswordLogin(supabase))) {
      await supabase.auth.signOut({ scope: "local" });
      return { ok: false, reason: "not_admin" };
    }
    return { ok: true };
  });

export const setAdminPasswordFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const { password } = (input ?? {}) as { password?: unknown };
    if (typeof password !== "string" || password.length < PASSWORD_MIN || password.length > 200) {
      throw new Error(`Use at least ${PASSWORD_MIN} characters`);
    }
    return { password };
  })
  .handler(async ({ data }): Promise<{ ok: true } | { ok: false; message: string }> => {
    const supabase = createServerClient();
    const status = await adminStatus(supabase);
    if (!status?.admin && !(await hasPasswordLogin(supabase))) {
      return { ok: false, message: "Password sign-in isn't on for this account." };
    }
    if (status?.admin && status.required && status.aal !== "aal2") {
      return { ok: false, message: "Verify your authenticator app first, then set a password." };
    }
    const { error } = await supabase.auth.updateUser({ password: data.password });
    if (error) {
      return {
        ok: false,
        message: isAuthRetryableFetchError(error)
          ? "We can't reach the server right now. Try again in a moment."
          : error.message,
      };
    }
    return { ok: true };
  });

export type SendLinkResult =
  | { ok: true }
  | {
      ok: false;
      reason: "unreachable" | "rate_limited" | "closed" | "refused" | "captcha" | "unknown";
      message?: string;
    };

export const sendSignInLinkFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { email?: unknown; invite?: unknown; captchaToken?: unknown };
    const email = typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "";
    if (!EMAIL.test(email) || email.length > 254) throw new Error("Enter your email address");
    const invite =
      typeof raw.invite === "string" && /^[0-9a-f]{24}$/.test(raw.invite) ? raw.invite : undefined;
    return { email, invite, captchaToken: captchaToken(raw.captchaToken) };
  })
  .handler(async ({ data }): Promise<SendLinkResult> => {
    const supabase = createServerClient();
    const org = await getOrgFn();
    const current = org.ok ? org.data : null;

    let signup: string | undefined;
    if (current) {
      const { data: resolved } = await supabase.rpc("settings_for", {
        p_namespaces: ["registration"],
        p_org: current.id,
      });
      const value =
        resolved && typeof resolved === "object" && !Array.isArray(resolved)
          ? resolved.registration
          : undefined;
      signup = resolveSettings("registration", value).signup;
    }

    const origin = `${getRequestProtocol({ xForwardedProto: true })}://${getRequestHost({ xForwardedHost: true })}`;
    const { error } = await supabase.auth.signInWithOtp({
      email: data.email,
      options: {
        emailRedirectTo: `${origin}/auth/confirm`,
        shouldCreateUser: !!current && signup !== "closed",
        captchaToken: data.captchaToken,
        data: current
          ? { org: current.slug, ...(data.invite ? { invite: data.invite } : {}) }
          : undefined,
      },
    });
    if (!error) return { ok: true };
    if (isAuthRetryableFetchError(error)) return { ok: false, reason: "unreachable" };
    if (error.code === "over_email_send_rate_limit") return { ok: false, reason: "rate_limited" };
    if (error.code === "otp_disabled") return { ok: false, reason: "closed" };
    if (error.code === "captcha_failed") return { ok: false, reason: "captcha" };
    if (error.status === 403 && error.message) {
      return { ok: false, reason: "refused", message: error.message };
    }
    console.error("[bogey] sending a sign-in link failed:", error);
    return { ok: false, reason: "unknown" };
  });

const LINK_TYPES = ["email", "magiclink", "signup", "invite", "recovery", "email_change"] as const;
type LinkType = (typeof LINK_TYPES)[number];

function linkType(value: unknown): LinkType {
  const found = LINK_TYPES.find((type) => type === value);
  if (!found) throw new Error("Unknown link type");
  return found;
}

export const verifySignInLinkFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { tokenHash?: unknown; type?: unknown };
    if (typeof raw.tokenHash !== "string" || !/^[\w-]{8,200}$/.test(raw.tokenHash)) {
      throw new Error("Missing token");
    }
    return { tokenHash: raw.tokenHash, type: linkType(raw.type) };
  })
  .handler(async ({ data }): Promise<{ ok: boolean; retryable: boolean }> => {
    const supabase = createServerClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: data.tokenHash,
      type: data.type === "magiclink" ? "email" : data.type,
    });
    if (error) return { ok: false, retryable: isAuthRetryableFetchError(error) };
    return { ok: true, retryable: false };
  });

export const signOutFn = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ ok: boolean; retryable: boolean }> => {
    const supabase = createServerClient();
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) return { ok: false, retryable: isAuthRetryableFetchError(error) };
    return { ok: true, retryable: false };
  },
);

export class SignOutError extends Error {
  readonly retryable: boolean;

  constructor(retryable: boolean) {
    super(
      retryable
        ? "We can't reach the server right now. Try again in a moment."
        : "Something went wrong signing you out. Try again in a moment.",
    );
    this.name = "SignOutError";
    this.retryable = retryable;
  }
}

export async function signOut(queryClient: QueryClient): Promise<void> {
  const result = await signOutFn();
  if (!result.ok) throw new SignOutError(result.retryable);

  if (typeof document !== "undefined") {
    const { browserClient } = await import("./browser.ts");
    await browserClient().auth.signOut({ scope: "local" });
  }
  queryClient.removeQueries({ queryKey: sessionQueryKey });
}

export function safeInternalPath(value: string | undefined | null): string | null {
  if (!value || !value.startsWith("/")) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  if (value === "/auth" || value.startsWith("/auth/")) return null;
  return value;
}

export function redirectParam(href: string): string | undefined {
  const safe = safeInternalPath(href);
  return safe === null || safe === "/" ? undefined : safe;
}

const REDIRECT_COOKIE = "bogey_redirect";
const REDIRECT_MAX_AGE = 15 * 60;

export function stashRedirect(path: string | undefined | null): void {
  const safe = safeInternalPath(path);
  if (!safe) return;
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${REDIRECT_COOKIE}=${encodeURIComponent(safe)}; Path=/; Max-Age=${REDIRECT_MAX_AGE}; SameSite=Lax${secure}`;
}

export const consumeRedirectFn = createServerFn({ method: "POST" }).handler(async () => {
  const raw = getCookie(REDIRECT_COOKIE);
  if (raw === undefined) return null;
  deleteCookie(REDIRECT_COOKIE, { path: "/" });
  return safeInternalPath(decodeURIComponent(raw));
});
