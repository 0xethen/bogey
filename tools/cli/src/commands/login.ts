import { busy, step } from "../lib/activity.ts";
import type { Prompter } from "../lib/prompt.ts";
import { REQUEST_TIMEOUT_MS, serviceCredentials, type Credentials } from "../lib/credentials.ts";
import type { CliResult } from "../cli.ts";
import { ensureUser } from "../lib/rest.ts";

export const USAGE = `bogey login <email>

Prints a sign-in code for an account that already exists, without sending email.
Refuses unknown addresses (see --create).

  --create      Also create the account if there is no such user, even in an org
                that only lets invited people sign up. Off by default: a typo
                would otherwise mint a real, sign-in-able account.
  --app <url>   Where the printed sign-in link opens (default http://localhost:3000).`;

async function findUser(
  credentials: Credentials,
  email: string,
): Promise<{ exists: boolean } | null> {
  let response: Response;

  try {
    response = await fetch(
      `${credentials.url}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`,
      {
        headers: {
          apikey: credentials.serviceKey,
          authorization: `Bearer ${credentials.serviceKey}`,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
  } catch {
    return null;
  }

  if (!response.ok) return null;

  const body = (await response.json().catch(() => null)) as {
    users?: Array<{ email?: string }>;
  } | null;

  if (!body?.users) return null;

  const needle = email.toLowerCase();
  return { exists: body.users.some((user) => user.email?.toLowerCase() === needle) };
}

export async function runLogin(
  cwd: string,
  args: string[],
  prompter: Prompter | null = null,
): Promise<CliResult> {
  let create = args.includes("--create");
  const appIndex = args.indexOf("--app");
  const app = (appIndex >= 0 ? args[appIndex + 1] : undefined) ?? "http://localhost:3000";
  const email =
    args.find(
      (arg, index) => !arg.startsWith("--") && !(appIndex >= 0 && index === appIndex + 1),
    ) ??
    (prompter
      ? await prompter.text({
          message: "Sign in as which email?",
          validate: (value) =>
            /^[^\s@]+@[^\s@]+$/.test(value) ? null : "That isn't an email address.",
        })
      : undefined);

  if (!email) return { exitCode: 1, output: USAGE };

  const resolved = serviceCredentials(cwd);
  if (!resolved.ok) return { exitCode: 1, output: resolved.error };

  const credentials = resolved.credentials;

  if (!create) {
    const found = await step(`Look up ${email}`, () => findUser(credentials, email));

    if (found === null) {
      return {
        exitCode: 1,
        output:
          `Couldn't check whether ${email} exists: ${credentials.url} didn't answer.\n` +
          "Not continuing: generate_link creates the account when the address is unknown.",
      };
    }

    if (!found.exists && prompter) {
      create = await prompter.confirm({
        message: `There's no account for ${email}. Create one? (It can sign in right away.)`,
      });
      if (!create) return { exitCode: 1, output: `No account for ${email}; nothing was created.` };
    } else if (!found.exists) {
      return {
        exitCode: 1,
        output:
          `No account for ${email}.\n\n` +
          "Not creating one: this command exists to sign in as someone who already\n" +
          "exists, and a typo here would mint a real account that can sign in.\n\n" +
          `  bogey login ${email} --create    create it, then print a code\n` +
          "  Supabase Studio → 'Send invitation'",
      };
    }
  }

  if (create) {
    const ensured = await step(`Create an account for ${email}`, () =>
      ensureUser(credentials, email),
    );
    if (!ensured.ok) {
      return { exitCode: 1, output: `Couldn't create an account for ${email}: ${ensured.error}` };
    }
  }

  let response: Response;
  try {
    response = await busy("Make a sign-in code", () =>
      fetch(`${credentials.url}/auth/v1/admin/generate_link`, {
        method: "POST",
        headers: {
          apikey: credentials.serviceKey,
          authorization: `Bearer ${credentials.serviceKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ type: "magiclink", email }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }),
    );
  } catch (error) {
    return { exitCode: 1, output: `Couldn't reach ${credentials.url}: ${String(error)}` };
  }

  const body = (await response.json().catch(() => null)) as {
    email_otp?: string;
    hashed_token?: string;
    msg?: string;
    error_code?: string;
  } | null;

  if (!response.ok || !body?.email_otp) {
    const reason = body?.msg ?? `HTTP ${response.status}`;
    return { exitCode: 1, output: `Couldn't create a sign-in code for ${email}: ${reason}` };
  }

  return {
    exitCode: 0,
    output: [
      create
        ? `Sign-in code for ${email} (created if it didn't exist)`
        : `Sign-in code for ${email}`,
      "",
      `  ${body.email_otp}`,
      "",
      "Enter it at /auth/otp, or open this link:",
      body.hashed_token
        ? `  ${app.replace(/\/$/, "")}/auth/confirm?${new URLSearchParams({ token_hash: body.hashed_token, type: "magiclink" })}`
        : "  (no link returned)",
      "",
      "The code and the link are the same grant; using one voids the other.",
    ].join("\n"),
  };
}
