import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  applyPlan,
  archiveFilePath,
  archiveTexts,
  downloadFile,
  parseArchive,
  planImport,
  readArchive,
  shiftTo,
  type RestAccess,
} from "@bogey/db/archive";
import { step } from "../lib/activity.ts";
import { ensureUser, select } from "../lib/rest.ts";
import { serviceCredentials, type Credentials } from "../lib/credentials.ts";
import { parseFlags } from "../lib/flags.ts";
import type { CliResult } from "../cli.ts";

export const USAGE = `bogey event export <org>/<event> --out <folder>
bogey event import <folder> [--org <slug>] [--slug <new-slug>] [--name <name>]
                   [--starts-at <date> | --shift-days <n>] [--people]

export writes an event to a folder: manifest.json, one JSON file per table and the uploaded files.
import makes a new event from such a folder, in this or another instance, as a draft. Every id is new.
Without --people only the event's setup comes back (windows, divisions, prizes, forms, criteria, rounds, pages,
settings, agenda). --people also restores members (creating accounts for emails that have none), teams,
registrations, submissions and files, votes, scores, feedback, awards, results, announcements and check-ins.
Dates move with --starts-at (the event's new start) or --shift-days. Uses the service key.`;

function access(credentials: Credentials): RestAccess {
  return { url: credentials.url, apikey: credentials.serviceKey, bearer: credentials.serviceKey };
}

function write(root: string, path: string, content: string | Uint8Array): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

async function orgId(
  credentials: Credentials,
  slug: string | undefined,
): Promise<string | string[]> {
  if (slug) {
    const rows = await select<{ id: string }>(
      credentials,
      "orgs",
      `slug=eq.${encodeURIComponent(slug)}&select=id`,
    );
    if (!rows.ok) return [rows.error];
    return rows.data[0]?.id ?? [`There is no organization "${slug}".`];
  }
  const rows = await select<{ value: { defaultOrg?: string } }>(
    credentials,
    "settings",
    "scope=eq.instance&namespace=eq.tenancy&select=value",
  );
  if (!rows.ok) return [rows.error];
  return rows.data[0]?.value.defaultOrg ?? ["No default organization. Pass --org <slug>."];
}

async function runExport(cwd: string, args: string[]): Promise<CliResult> {
  const flags = parseFlags(args.slice(1));
  const [orgSlug, eventSlug] = (args[0] ?? "").split("/");
  if (!orgSlug || !eventSlug || typeof flags.out !== "string") {
    return {
      exitCode: 1,
      output: `Name the event as <org>/<event> and give --out <folder>.\n\n${USAGE}`,
    };
  }
  const resolved = serviceCredentials(cwd);
  if (!resolved.ok) return { exitCode: 1, output: resolved.error };
  const credentials = resolved.credentials;

  const orgs = await select<{ id: string }>(
    credentials,
    "orgs",
    `slug=eq.${encodeURIComponent(orgSlug)}&select=id`,
  );
  if (!orgs.ok) return { exitCode: 1, output: orgs.error };
  const org = orgs.data[0];
  const events = org
    ? await select<{ id: string }>(
        credentials,
        "events",
        `org_id=eq.${org.id}&slug=eq.${encodeURIComponent(eventSlug)}&select=id`,
      )
    : null;
  if (events && !events.ok) return { exitCode: 1, output: events.error };
  const event = events?.data[0];
  if (!event) return { exitCode: 1, output: `There is no event "${orgSlug}/${eventSlug}".` };

  if (existsSync(flags.out) && readdirSync(flags.out).length > 0) {
    return { exitCode: 1, output: `${flags.out} isn't empty. Pick a new folder.` };
  }
  try {
    const rest = access(credentials);
    const data = await step("Read the event", () => readArchive(rest, event.id));
    for (const file of archiveTexts(data)) write(flags.out, file.path, file.text);
    let copied = 0;
    for (const file of data.manifest.files) {
      try {
        write(flags.out, archiveFilePath(file), await downloadFile(rest, file));
        copied += 1;
      } catch (error) {
        return {
          exitCode: 1,
          output: `Couldn't copy ${file.bucket}/${file.path}: ${String(error)}`,
        };
      }
    }
    const rows = Object.values(data.manifest.tables).reduce((sum, count) => sum + count, 0);
    return {
      exitCode: 0,
      output: `✓ Wrote ${rows} rows from ${Object.keys(data.manifest.tables).length} tables, ${copied} files and ${data.manifest.people.length} people to ${flags.out}.`,
    };
  } catch (error) {
    return {
      exitCode: 1,
      output: `Export failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function runImport(cwd: string, args: string[]): Promise<CliResult> {
  const folder = args[0];
  const flags = parseFlags(args.slice(1));
  if (
    !folder ||
    folder.startsWith("--") ||
    !existsSync(folder) ||
    !statSync(folder).isDirectory()
  ) {
    return { exitCode: 1, output: `Give the folder an export wrote.\n\n${USAGE}` };
  }
  const resolved = serviceCredentials(cwd);
  if (!resolved.ok) return { exitCode: 1, output: resolved.error };
  const credentials = resolved.credentials;

  try {
    const data = parseArchive((path) => {
      const full = join(folder, path);
      return existsSync(full) ? readFileSync(full, "utf-8") : undefined;
    });
    const target = await orgId(credentials, typeof flags.org === "string" ? flags.org : undefined);
    if (Array.isArray(target)) return { exitCode: 1, output: target[0] ?? "No organization." };

    const slug = typeof flags.slug === "string" ? flags.slug : data.manifest.event.slug;
    const taken = await select<{ id: string }>(
      credentials,
      "events",
      `org_id=eq.${target}&slug=eq.${encodeURIComponent(slug)}&select=id`,
    );
    if (!taken.ok) return { exitCode: 1, output: taken.error };
    if (taken.data.length > 0) {
      return {
        exitCode: 1,
        output: `The organization already has an event "${slug}". Pass --slug <new-slug>.`,
      };
    }

    let shiftMs = 0;
    if (typeof flags["starts-at"] === "string") shiftMs = shiftTo(data, flags["starts-at"]);
    else if (typeof flags["shift-days"] === "string")
      shiftMs = Number(flags["shift-days"]) * 86_400_000;
    if (Number.isNaN(shiftMs)) return { exitCode: 1, output: "--shift-days takes a number." };

    const users = new Map<string, string>();
    if (flags.people === true) {
      for (const person of data.manifest.people) {
        const found = await ensureUser(credentials, person.email);
        if (!found.ok) return { exitCode: 1, output: found.error };
        users.set(person.id, found.data);
      }
    }

    const plan = planImport(data, {
      orgId: target,
      slug,
      ...(typeof flags.name === "string" ? { name: flags.name } : {}),
      shiftMs,
      people: flags.people === true,
      users,
      newId: randomUUID,
    });
    await step("Restore the event", () =>
      applyPlan(access(credentials), plan, async (path) => {
        const full = join(folder, path);
        return existsSync(full) ? new Uint8Array(readFileSync(full)) : undefined;
      }),
    );
    const skipped = Object.entries(plan.skipped)
      .map(([table, count]) => `${count} ${table}`)
      .join(", ");
    return {
      exitCode: 0,
      output:
        `✓ Restored "${slug}" as a draft event${flags.people === true ? ` with ${users.size} people` : ""}.` +
        (skipped ? `\nLeft out because what they point at isn't in the archive: ${skipped}.` : ""),
    };
  } catch (error) {
    return {
      exitCode: 1,
      output: `Import failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function runEvent(cwd: string, args: string[]): Promise<CliResult> {
  if (args[0] === "export") return runExport(cwd, args.slice(1));
  if (args[0] === "import") return runImport(cwd, args.slice(1));
  return {
    exitCode: args[0] ? 1 : 0,
    output: args[0] ? `bogey event: unknown subcommand "${args[0]}"\n\n${USAGE}` : USAGE,
  };
}
