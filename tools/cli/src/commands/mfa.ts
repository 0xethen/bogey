import { loadConfig } from "@bogey/config/load";
import { step } from "../lib/activity.ts";
import { findRepoRoot } from "../lib/repo-root.ts";
import type { Prompter } from "../lib/prompt.ts";
import { serviceCredentials } from "../lib/credentials.ts";
import { insert, select, update } from "../lib/rest.ts";
import type { CliResult } from "../cli.ts";

export const USAGE = `bogey mfa [status | on | off]

Whether instance admins need an authenticator app before the database treats
them as admins (Instance > Settings > Accounts). It's on by default. If every
admin is locked out, \`bogey mfa off\` lets them back in with their email
sign-in alone; turn it back on after they've set one up in Account. Admins can't
change it in the app. When bogey.config.ts sets security.requireAdminMfa, the
server puts that value back when it next starts, so change it there too.`;

interface Row {
  value: Record<string, unknown> | null;
}

const WHERE = "scope=eq.instance&namespace=eq.accounts";

export async function runMfa(
  cwd: string,
  args: string[],
  prompter: Prompter | null = null,
): Promise<CliResult> {
  let [action = "status"] = args;
  if (action !== "status" && action !== "on" && action !== "off") {
    return { exitCode: 1, output: USAGE };
  }
  const credentials = serviceCredentials(cwd);
  if (!credentials.ok) return { exitCode: 1, output: credentials.error };

  const found = await step("Read the instance's settings", () =>
    select<Row>(credentials.credentials, "settings", `select=value&${WHERE}`),
  );
  if (!found.ok) return { exitCode: 1, output: found.error };
  const current = found.data[0]?.value ?? null;
  const required = current?.requireAdminMfa !== false;

  if (args.length === 0 && prompter) {
    prompter.say(
      required
        ? "Instance admins need an authenticator app (on)."
        : "Instance admins don't need an authenticator app (off).",
    );
    const flip = await prompter.confirm({
      message: required
        ? "Turn it off, so admins get in with email sign-in alone?"
        : "Turn it back on?",
    });
    if (!flip) return { exitCode: 0, output: "Left as it was." };
    action = required ? "off" : "on";
  }

  if (action === "status") {
    return {
      exitCode: 0,
      output: required
        ? "Instance admins need an authenticator app (on)."
        : "Instance admins don't need an authenticator app (off).",
    };
  }
  const want = action === "on";
  if (want === required) {
    return { exitCode: 0, output: `Already ${action}.` };
  }

  const value = { ...current, requireAdminMfa: want };
  const written = await step(`Turn it ${action}`, () =>
    found.data.length
      ? update<Row>(credentials.credentials, "settings", WHERE, { value })
      : insert<Row>(credentials.credentials, "settings", {
          scope: "instance",
          namespace: "accounts",
          value,
        }),
  );
  if (!written.ok) return { exitCode: 1, output: written.error };
  const declared = declaredRequirement(cwd);
  const reverts =
    declared !== null && declared !== want
      ? `\nbogey.config.ts sets security.requireAdminMfa: ${declared}, so the server turns it ${declared ? "on" : "off"} again when it next starts. Change it there to keep this.`
      : "";
  return {
    exitCode: 0,
    output:
      (want
        ? "✓ Instance admins need an authenticator app again."
        : "✓ Instance admins can use the Instance pages with email sign-in alone. Turn it back on with `bogey mfa on` once they've set up an authenticator app.") +
      reverts,
  };
}

function declaredRequirement(cwd: string): boolean | null {
  try {
    const value = loadConfig(process.env, findRepoRoot(cwd)).config.operator.accounts
      ?.requireAdminMfa;
    return typeof value === "boolean" ? value : null;
  } catch {
    return null;
  }
}
