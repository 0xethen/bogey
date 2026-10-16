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
import { ensureUser, removeFiles, select, update } from "../lib/rest.ts";
import { rpc, serviceCredentials, type Credentials } from "../lib/credentials.ts";
import { parseFlags } from "../lib/flags.ts";
import type { Prompter } from "../lib/prompt.ts";
import type { CliResult } from "../cli.ts";

export const USAGE = `bogey event list [<org>]
bogey event visibility <org>/<event> draft|unlisted|public
bogey event delete <org>/<event> [--yes]
bogey event export <org>/<event> --out <folder>
bogey event import <folder> [--org <slug>] [--slug <new-slug>] [--name <name>]
                   [--starts-at <date> | --shift-days <n>] [--people]

list shows each org's events, or one org's. visibility publishes an event (public or
unlisted) or takes it back to a draft. delete removes an event with everything in it,
files included; it asks you to type the event's address, and --yes skips that for scripts.
It works even when bogey.config.ts sets events.uiDeletion to false.

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

const VISIBILITY = ["draft", "unlisted", "public"] as const;

interface EventRow {
  id: string;
  slug: string;
  name: string;
  visibility: string;
  starts_at: string | null;
  orgs: { slug: string };
}

async function findEvent(
  credentials: Credentials,
  name: string | undefined,
): Promise<{ ok: true; event: EventRow } | { ok: false; error: string }> {
  const [orgSlug, eventSlug] = (name ?? "").split("/");
  if (!orgSlug || !eventSlug)
    return { ok: false, error: `Name the event as <org>/<event>.\n\n${USAGE}` };
  const rows = await select<EventRow>(
    credentials,
    "events",
    `select=id,slug,name,visibility,starts_at,orgs!inner(slug)&orgs.slug=eq.${encodeURIComponent(orgSlug)}&slug=eq.${encodeURIComponent(eventSlug)}`,
  );
  if (!rows.ok) return rows;
  const event = rows.data[0];
  return event
    ? { ok: true, event }
    : {
        ok: false,
        error: `There is no event "${orgSlug}/${eventSlug}". \`bogey event list\` shows them.`,
      };
}

async function runList(credentials: Credentials, org: string | undefined): Promise<CliResult> {
  const filter = org ? `&orgs.slug=eq.${encodeURIComponent(org)}` : "";
  const rows = await step("Load events", () =>
    select<EventRow>(
      credentials,
      "events",
      `select=id,slug,name,visibility,starts_at,orgs!inner(slug)${filter}&order=created_at`,
    ),
  );
  if (!rows.ok) return { exitCode: 1, output: rows.error };
  if (rows.data.length === 0) {
    return { exitCode: 0, output: org ? `No events in ${org}.` : "No events yet." };
  }
  const names = rows.data.map((event) => `${event.orgs.slug}/${event.slug}`);
  const width = Math.max(...names.map((name) => name.length));
  const lines = rows.data.map((event, index) => {
    const starts = event.starts_at ? `  starts ${event.starts_at.slice(0, 10)}` : "";
    return `${names[index]!.padEnd(width)}  ${event.name} (${event.visibility})${starts}`;
  });
  return { exitCode: 0, output: lines.join("\n") };
}

async function runVisibility(credentials: Credentials, args: string[]): Promise<CliResult> {
  const visibility = args[1];
  if (!VISIBILITY.includes(visibility as (typeof VISIBILITY)[number])) {
    return { exitCode: 1, output: `Give the visibility: draft, unlisted or public.\n\n${USAGE}` };
  }
  const found = await findEvent(credentials, args[0]);
  if (!found.ok) return { exitCode: 1, output: found.error };
  const changed = await update(credentials, "events", `id=eq.${found.event.id}`, { visibility });
  if (!changed.ok) return { exitCode: 1, output: changed.error };
  return { exitCode: 0, output: `✓ ${args[0]} is now ${visibility}.` };
}

async function runDelete(
  credentials: Credentials,
  args: string[],
  prompter: Prompter | null,
): Promise<CliResult> {
  const found = await findEvent(credentials, args[0]);
  if (!found.ok) return { exitCode: 1, output: found.error };
  const { event } = found;
  if (!args.includes("--yes")) {
    if (!prompter) {
      return { exitCode: 1, output: "Not a terminal: pass --yes to delete without being asked." };
    }
    const typed = await prompter.text({
      message: `Type "${event.slug}" to delete ${event.name} and everything in it`,
      hint: "This can't be undone. `bogey event export` keeps a copy first. Anything else cancels.",
      optional: true,
    });
    if (typed !== event.slug) return { exitCode: 1, output: "Nothing was deleted." };
  }
  const deleted = await step(`Delete ${event.name}`, () =>
    rpc(credentials, "delete_event", { p_event: event.id, p_confirm: event.slug }),
  );
  if (!deleted.ok) return { exitCode: 1, output: deleted.error };
  const files = (deleted.data ?? []) as { bucket: string; path: string }[];
  const byBucket = new Map<string, string[]>();
  for (const file of files)
    byBucket.set(file.bucket, [...(byBucket.get(file.bucket) ?? []), file.path]);
  const left: string[] = [];
  for (const [bucket, paths] of byBucket) {
    for (let i = 0; i < paths.length; i += 500) {
      const removed = await removeFiles(credentials, bucket, paths.slice(i, i + 500));
      if (!removed.ok) left.push(removed.error);
    }
  }
  const lines = [`✓ Deleted ${args[0]}${files.length ? ` and its ${files.length} files` : ""}.`];
  if (left.length) lines.push(`Some files couldn't be removed:\n${left.join("\n")}`);
  return { exitCode: left.length ? 1 : 0, output: lines.join("\n") };
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

export async function runEvent(
  cwd: string,
  given: string[],
  prompter: Prompter | null = null,
): Promise<CliResult> {
  const args = [...given];
  if (args.length === 0 && prompter) {
    const picked = await prompter.select({
      message: "Events",
      options: [
        { value: "list", label: "List them" },
        { value: "visibility", label: "Publish or unpublish one" },
        { value: "delete", label: "Delete one" },
      ],
    });
    args.push(picked);
    if (picked === "list") {
      const org = await prompter.text({
        message: "Org address (slug)",
        hint: "Blank for every org",
        optional: true,
      });
      if (org) args.push(org);
    } else {
      args.push(
        await prompter.text({ message: "Event", hint: "As <org>/<event>, like acme/spring-hack" }),
      );
      if (picked === "visibility") {
        args.push(
          await prompter.select({
            message: "Visibility",
            options: VISIBILITY.map((value) => ({ value, label: value })),
          }),
        );
      }
    }
  }
  if (args[0] === "export") return runExport(cwd, args.slice(1));
  if (args[0] === "import") return runImport(cwd, args.slice(1));
  if (args[0] === "list" || args[0] === "visibility" || args[0] === "delete") {
    const resolved = serviceCredentials(cwd);
    if (!resolved.ok) return { exitCode: 1, output: resolved.error };
    if (args[0] === "list") return runList(resolved.credentials, args[1]);
    if (args[0] === "visibility") return runVisibility(resolved.credentials, args.slice(1));
    return runDelete(resolved.credentials, args.slice(1), prompter);
  }
  return {
    exitCode: args[0] ? 1 : 0,
    output: args[0] ? `bogey event: unknown subcommand "${args[0]}"\n\n${USAGE}` : USAGE,
  };
}
