import { loadConfig } from "@bogey/config/load";
import { operatorChanges, type OperatorChange, type OperatorSettings } from "@bogey/config/resolve";
import { isCoreNamespace, type CoreNamespace } from "@bogey/config/settings";
import { step } from "../lib/activity.ts";
import { serviceCredentials, type Credentials } from "../lib/credentials.ts";
import { findRepoRoot } from "../lib/repo-root.ts";
import { insert, select, update } from "../lib/rest.ts";
import type { CliResult } from "../cli.ts";

export const USAGE = `bogey config [check | apply]

Reads bogey.config.ts (or the file BOGEY_CONFIG names) and checks it against the
schema. The keys an admin can't change in the app (appUrl, network, and
security.requireAdminMfa) are written to the database by the server when it
starts; check compares them with the database .env points at, and apply writes
them now, without a restart. Keys the file leaves out keep the database's value.`;

interface Row {
  namespace: string;
  value: Record<string, unknown> | null;
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

function describe(change: OperatorChange): string {
  return change.keys.map((key) => `${change.namespace}.${key}`).join(", ");
}

export async function operatorDrift(
  credentials: Credentials,
  operator: OperatorSettings,
): Promise<Result<{ changes: OperatorChange[]; existing: Set<CoreNamespace> }>> {
  const namespaces = Object.keys(operator);
  if (namespaces.length === 0) return { ok: true, data: { changes: [], existing: new Set() } };
  const rows = await select<Row>(
    credentials,
    "settings",
    `select=namespace,value&scope=eq.instance&namespace=in.(${namespaces.join(",")})`,
  );
  if (!rows.ok) return rows;
  const stored: Partial<Record<CoreNamespace, Record<string, unknown>>> = {};
  for (const row of rows.data) {
    if (isCoreNamespace(row.namespace)) stored[row.namespace] = row.value ?? {};
  }
  const existing = new Set(Object.keys(stored).filter(isCoreNamespace));
  return { ok: true, data: { changes: operatorChanges(operator, stored), existing } };
}

export async function runConfig(cwd: string, args: string[]): Promise<CliResult> {
  const [action = "check"] = args;
  if (action !== "check" && action !== "apply") return { exitCode: 1, output: USAGE };

  let loaded: ReturnType<typeof loadConfig>;
  try {
    loaded = loadConfig(process.env, findRepoRoot(cwd));
  } catch (error) {
    return { exitCode: 1, output: error instanceof Error ? error.message : String(error) };
  }
  const file = loaded.file ?? "No bogey.config.ts found; using the defaults";
  const credentials = serviceCredentials(cwd);
  if (!credentials.ok) {
    return { exitCode: 0, output: `✓ ${file} is valid.\n${credentials.error}` };
  }

  const drift = await step("Compare with the database", () =>
    operatorDrift(credentials.credentials, loaded.config.operator),
  );
  if (!drift.ok) return { exitCode: 1, output: drift.error };
  const { changes, existing } = drift.data;
  if (changes.length === 0) {
    return { exitCode: 0, output: `✓ ${file} is valid, and the database matches it.` };
  }
  if (action === "check") {
    return {
      exitCode: 1,
      output: [
        `${file} is valid, but the database has different values for:`,
        ...changes.map((change) => `  ${describe(change)}`),
        "Restart the server, or run bogey config apply.",
      ].join("\n"),
    };
  }

  for (const change of changes) {
    const query = `scope=eq.instance&namespace=eq.${change.namespace}`;
    const written = await step(`Set ${describe(change)}`, () =>
      existing.has(change.namespace)
        ? update<Row>(credentials.credentials, "settings", query, { value: change.value })
        : insert<Row>(credentials.credentials, "settings", {
            scope: "instance",
            namespace: change.namespace,
            value: change.value,
          }),
    );
    if (!written.ok) return { exitCode: 1, output: written.error };
  }
  return {
    exitCode: 0,
    output: `✓ Set ${changes.map(describe).join(", ")} from ${file}.`,
  };
}
