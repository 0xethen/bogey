import { existsSync } from "node:fs";
import { step } from "../lib/activity.ts";
import { join } from "node:path";
import { disabledPlugins } from "@bogey/config";
import { rpc, serviceCredentials, type Credentials } from "../lib/credentials.ts";
import { findRepoRoot } from "../lib/repo-root.ts";
import { pluginDir, pluginKeysOnDisk } from "../lib/plugin-dirs.ts";
import { select } from "../lib/rest.ts";
import { parseFlags } from "../lib/flags.ts";
import type { CliResult } from "../cli.ts";

export const USAGE = `bogey seed demo [--org <slug>]

Creates (or recreates) the demo hackathon in an org, plus each enabled plugin's
demo (a plugin provides one as \`public.<key>_seed_demo(p_org uuid)\` in seed.sql).
Uses the default org unless --org is given. No accounts are created.`;

export async function seedDemo(
  cwd: string,
  credentials: Credentials,
  orgId: string,
): Promise<{ ok: true; data: string[] } | { ok: false; error: string }> {
  const core = await rpc(credentials, "bogey_seed_demo", { p_org: orgId });
  if (!core.ok) return core;
  const seeded = ["demo-hackathon"];

  const root = findRepoRoot(cwd);
  const keys = pluginKeysOnDisk(root).filter(
    (key) => existsSync(join(pluginDir(root, key), "seed.sql")) && !disabledPlugins.includes(key),
  );

  for (const key of keys.sort()) {
    const result = await rpc(credentials, `${key.replaceAll("-", "_")}_seed_demo`, {
      p_org: orgId,
    });
    if (!result.ok)
      return {
        ok: false,
        error: `${key}: ${result.error} (apply its SQL with \`bogey plugins sql\`)`,
      };
    seeded.push(`${key} demo`);
  }
  return { ok: true, data: seeded };
}

export async function runSeed(cwd: string, args: string[]): Promise<CliResult> {
  if (args[0] !== "demo") {
    return {
      exitCode: args[0] ? 1 : 0,
      output: args[0] ? `bogey seed: unknown fixture "${args[0]}"\n\n${USAGE}` : USAGE,
    };
  }
  const flags = parseFlags(args.slice(1));

  const resolved = serviceCredentials(cwd);
  if (!resolved.ok) return { exitCode: 1, output: resolved.error };
  const credentials = resolved.credentials;

  let orgId: string | undefined;
  if (typeof flags.org === "string") {
    const rows = await select<{ id: string }>(
      credentials,
      "orgs",
      `slug=eq.${encodeURIComponent(flags.org)}&select=id`,
    );
    if (!rows.ok) return { exitCode: 1, output: rows.error };
    orgId = rows.data[0]?.id;
  } else {
    const rows = await select<{ value: { defaultOrg?: string } }>(
      credentials,
      "settings",
      "scope=eq.instance&namespace=eq.tenancy&select=value",
    );
    if (!rows.ok) return { exitCode: 1, output: rows.error };
    orgId = rows.data[0]?.value.defaultOrg;
  }
  if (!orgId) {
    return {
      exitCode: 1,
      output: "No such org. Run `bogey org init` first, or pass --org <slug>.",
    };
  }

  const result = await step("Seed the demo events", () => seedDemo(cwd, credentials, orgId));
  if (!result.ok) return { exitCode: 1, output: `Seeding failed.\n${result.error}` };
  return { exitCode: 0, output: `✓ Seeded ${result.data.join(", ")}.` };
}
