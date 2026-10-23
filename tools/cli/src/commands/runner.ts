import { createHash, randomBytes } from "node:crypto";
import { step } from "../lib/activity.ts";
import { serviceCredentials, type Credentials } from "../lib/credentials.ts";
import { rpc } from "../lib/rest.ts";
import type { CliResult } from "../cli.ts";

export const USAGE = `bogey runner keys
bogey runner add <name> [--replace]
bogey runner revoke <name>

Keys for the challenges runner (docs/self-hosting/runner-security.md). A runner key can claim
queued judgings, read the tests of a judging it holds and record its verdict; nothing else.

  keys               List the keys, when each was last used, and whether a runner still judges
                     with the service key
  add <name>         Make a key and print it once; put it in the runner's BOGEY_RUNNER_KEY.
                     The database keeps only its SHA-256. --replace gives an existing name a
                     new key (the old one stops working)
  revoke <name>      Stop a key working; the runner's next call fails`;

export const SUBCOMMANDS = ["keys", "add", "revoke"] as const;

const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

interface KeyRow {
  name: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export function newRunnerKey(): { key: string; sha256: string } {
  const key = `bogey_runner_${randomBytes(32).toString("base64url")}`;
  return { key, sha256: createHash("sha256").update(key).digest("hex") };
}

const missing = (error: string) =>
  /challenges_runner_|PGRST202|Could not find the function/.test(error)
    ? `${error}\nThe database doesn't have runner keys yet: run bogey plugins migrate.`
    : error;

/** How many judgings a runner took with the service key lately; null when it can't tell. */
export async function legacyJudgings(credentials: Credentials): Promise<number | null> {
  const found = await rpc<number>(credentials, "challenges_runner_legacy_judgings", { p_days: 7 });
  return found.ok && typeof found.data === "number" ? found.data : null;
}

export const LEGACY_ADVICE =
  "A runner judged with the service key in the last 7 days. Give it its own key: bogey runner add <name>, set BOGEY_RUNNER_KEY, remove SUPABASE_SERVICE_ROLE_KEY from it (docs/self-hosting/runner-security.md)";

function when(value: string | null): string {
  return value ? value.replace("T", " ").slice(0, 16) : "never";
}

export async function runRunner(cwd: string, args: string[]): Promise<CliResult> {
  const [action, name, ...rest] = args;
  if (!action || !(SUBCOMMANDS as Tuple<string>).includes(action)) {
    return { exitCode: action ? 1 : 0, output: USAGE };
  }
  const resolved = serviceCredentials(cwd);
  if (!resolved.ok) return { exitCode: 1, output: resolved.error };
  const { credentials } = resolved;

  if (action === "keys") {
    const found = await step("Read the runner keys", () =>
      rpc<KeyRow[]>(credentials, "challenges_runner_keys", {}),
    );
    if (!found.ok) return { exitCode: 1, output: missing(found.error) };
    const legacy = await legacyJudgings(credentials);
    const lines = found.data.length
      ? found.data.map(
          (row) =>
            `  ${row.name.padEnd(20)} made ${when(row.created_at)}, last used ${when(row.last_used_at)}${row.revoked_at ? `, revoked ${when(row.revoked_at)}` : ""}`,
        )
      : ["  No runner keys. Make one with bogey runner add <name>."];
    if (legacy) lines.push("", `! ${LEGACY_ADVICE}.`);
    return { exitCode: 0, output: lines.join("\n") };
  }

  if (!name || !NAME.test(name)) {
    return {
      exitCode: 1,
      output: `A key's name is lowercase letters, digits and "-" (40 at most), such as "runner" or "judge-box-2".\n\n${USAGE}`,
    };
  }

  if (action === "revoke") {
    const revoked = await step(`Revoke ${name}`, () =>
      rpc<boolean | null>(credentials, "challenges_runner_key_revoke", { p_name: name }),
    );
    if (!revoked.ok) return { exitCode: 1, output: missing(revoked.error) };
    return revoked.data
      ? {
          exitCode: 0,
          output: `✓ ${name} no longer works. A runner using it stops at its next call.`,
        }
      : { exitCode: 1, output: `No key called ${name} that still works.` };
  }

  const replace = rest.includes("--replace");
  const made = newRunnerKey();
  const added = await step(`Make ${name}`, () =>
    rpc<null>(credentials, "challenges_runner_key_add", {
      p_name: name,
      p_key_sha256: made.sha256,
      p_replace: replace,
    }),
  );
  if (!added.ok) {
    const taken = /duplicate key|23505|already exists/.test(added.error);
    return {
      exitCode: 1,
      output: taken
        ? `There's already a key called ${name}. Pick another name, or pass --replace to give it a new key.`
        : missing(added.error),
    };
  }
  return {
    exitCode: 0,
    output: [
      `✓ Runner key ${name}. It's shown only this once:`,
      "",
      `BOGEY_RUNNER_KEY=${made.key}`,
      "",
      "Put it in the runner's environment (the all-in-one .env), and remove SUPABASE_SERVICE_ROLE_KEY from the runner if it has it.",
    ].join("\n"),
  };
}
