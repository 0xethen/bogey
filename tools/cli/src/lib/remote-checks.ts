import { z } from "zod";
import { HOOK_URI, type ConsistencyIssue } from "./checks.ts";
import type { Credentials } from "./credentials.ts";

export interface RemoteInput extends Credentials {
  accessToken?: string;
  publishableKey?: string;
  fetcher?: typeof fetch;
}

export interface RemoteReport {
  issues: ConsistencyIssue[];
  notes: string[];
}

const authSettings = z.object({
  disable_signup: z.boolean().optional(),
  mailer_autoconfirm: z.boolean().optional(),
  external: z.record(z.string(), z.boolean()).optional(),
});

const authConfig = z.object({
  disable_signup: z.boolean().nullish(),
  mailer_autoconfirm: z.boolean().nullish(),
  mailer_otp_length: z.number().nullish(),
  site_url: z.string().nullish(),
  uri_allow_list: z.string().nullish(),
  hook_before_user_created_enabled: z.boolean().nullish(),
  hook_before_user_created_uri: z.string().nullish(),
  hook_send_email_enabled: z.boolean().nullish(),
  hook_send_email_uri: z.string().nullish(),
  mfa_totp_enroll_enabled: z.boolean().nullish(),
  mfa_totp_verify_enabled: z.boolean().nullish(),
});

const settingsRows = z.array(
  z.object({ namespace: z.string(), value: z.record(z.string(), z.unknown()) }),
);
const orgRows = z.array(z.object({ id: z.string() }));
const sendRows = z.array(z.object({ sent_at: z.string() }));

export function projectRef(url: string): string | null {
  const match = /^https:\/\/([a-z0-9]{10,})\.supabase\.(?:co|red)(?:\/|$)/.exec(url);
  return match?.[1] ?? null;
}

type Fetcher = typeof fetch;

async function getJson(
  fetcher: Fetcher,
  url: string,
  headers: Record<string, string>,
): Promise<{ ok: true; body: unknown } | { ok: false; status: number | null; message: string }> {
  let response: Response;
  try {
    response = await fetcher(url, { headers });
  } catch (error) {
    return { ok: false, status: null, message: String(error) };
  }
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {}
  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "message" in body &&
      typeof body.message === "string"
        ? body.message
        : text.slice(0, 200) || `HTTP ${response.status}`;
    return { ok: false, status: response.status, message };
  }
  return { ok: true, body };
}

export function checkAuthConfig(raw: unknown): ConsistencyIssue[] {
  const parsed = authConfig.safeParse(raw);
  if (!parsed.success)
    return [{ message: "The Management API's auth settings weren't in the shape expected." }];
  const config = parsed.data;
  const issues: ConsistencyIssue[] = [];
  const say = (message: string) => issues.push({ message });
  if (!config.hook_before_user_created_enabled) {
    say(
      "The Before User Created hook is off (Authentication → Hooks); nothing enforces registration.signup.",
    );
  } else if (config.hook_before_user_created_uri !== HOOK_URI) {
    say(`The Before User Created hook must be the Postgres function ${HOOK_URI}.`);
  }
  if (!config.hook_send_email_enabled) {
    say(
      "The Send Email hook is off (Authentication → Hooks); sign-in mail won't carry each org's name.",
    );
  } else if (!config.hook_send_email_uri?.endsWith("/api/auth/send-email")) {
    say("The Send Email hook's address should end in /api/auth/send-email.");
  }
  if (config.mailer_otp_length !== 6) say("Email OTP length should be 6.");
  if (config.disable_signup)
    say("Sign-ups are disabled, which stops the sign-up hook from running.");
  if (config.mailer_autoconfirm)
    say("Email auto-confirm is on, so GoTrue confirms users without sending mail.");
  if (!config.site_url || /localhost/.test(config.site_url))
    say("Site URL is empty or still localhost.");
  if (!config.uri_allow_list)
    say("No redirect URLs are allowed; add every host Bogey is served on.");
  if (!config.mfa_totp_enroll_enabled || !config.mfa_totp_verify_enabled) {
    say("Authenticator apps (TOTP) are off, which instance admins need.");
  }
  return issues;
}

export async function remoteChecks(input: RemoteInput): Promise<RemoteReport> {
  const fetcher = input.fetcher ?? fetch;
  const issues: ConsistencyIssue[] = [];
  const notes: string[] = [];
  const service = { apikey: input.serviceKey, authorization: `Bearer ${input.serviceKey}` };
  const base = input.url.replace(/\/$/, "");

  const settings = await getJson(fetcher, `${base}/auth/v1/settings`, {
    apikey: input.publishableKey ?? input.serviceKey,
  });
  if (!settings.ok) {
    issues.push({ message: `Auth didn't answer at ${base}/auth/v1/settings: ${settings.message}` });
    return { issues, notes };
  }
  const auth = authSettings.safeParse(settings.body);
  if (auth.success) {
    if (auth.data.disable_signup) {
      issues.push({
        message:
          "Auth has sign-ups disabled, so the sign-up hook never runs and invitations break.",
      });
    }
    if (auth.data.mailer_autoconfirm) {
      issues.push({ message: "Auth auto-confirms email, so no sign-in mail is sent." });
    }
    if (auth.data.external && auth.data.external.email === false) {
      issues.push({
        message: "The email provider is off, so nobody can sign in with a code or link.",
      });
    }
  }

  const admin = await getJson(fetcher, `${base}/auth/v1/admin/users?per_page=1`, service);
  if (!admin.ok) {
    issues.push({
      message: `The service key was refused by Auth (${admin.message}); SUPABASE_SERVICE_ROLE_KEY should be the secret key.`,
    });
  }

  const orgs = await getJson(fetcher, `${base}/rest/v1/orgs?select=id&limit=1`, service);
  if (!orgs.ok) {
    issues.push({
      message: `Couldn't read the schema (${orgs.message}); has the schema been applied (bogey db migrate)?`,
    });
  } else if (!orgRows.safeParse(orgs.body).data?.length) {
    issues.push({ message: "There is no organization yet: run bogey org init." });
  }

  if (orgs.ok) {
    const tenancy = await getJson(
      fetcher,
      `${base}/rest/v1/settings?select=namespace,value&scope=eq.instance&namespace=eq.tenancy`,
      service,
    );
    const rows = tenancy.ok ? settingsRows.safeParse(tenancy.body).data : undefined;
    if (!rows?.[0]?.value.appUrl) {
      issues.push({
        message:
          "The app address isn't set, so Bogey's own email waits in the queue: set appUrl in bogey.config.ts (docs/self-hosting/email.md).",
      });
    }
    const sends = await getJson(
      fetcher,
      `${base}/rest/v1/email_sends?select=sent_at&order=sent_at.desc&limit=1`,
      service,
    );
    if (sends.ok && !sendRows.safeParse(sends.body).data?.length) {
      notes.push(
        "No email has gone through the Send Email hook yet. Sign in once (bogey login <email> prints a code without mail; requesting a code by email tests the hook) and run this again.",
      );
    }
  }

  const ref = projectRef(base);
  if (input.accessToken && ref) {
    const config = await getJson(
      fetcher,
      `https://api.supabase.com/v1/projects/${ref}/config/auth`,
      {
        authorization: `Bearer ${input.accessToken}`,
      },
    );
    if (config.ok) issues.push(...checkAuthConfig(config.body));
    else
      issues.push({ message: `The Management API refused the access token (${config.message}).` });
  } else {
    notes.push(
      ref
        ? "The Before User Created hook, OTP length and authenticator-app settings can only be read with a Management API token: set SUPABASE_ACCESS_TOKEN (supabase.com/dashboard/account/tokens) and run again."
        : "The hook and MFA settings of a self-hosted stack are checked from its environment (bogey doctor, with GOTRUE_* set); this URL isn't a Supabase Cloud project.",
    );
  }
  return { issues, notes };
}
