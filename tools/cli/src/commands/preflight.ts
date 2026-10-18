import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { step } from "../lib/activity.ts";
import {
  assess,
  cloudAuthLimits,
  envAuthLimits,
  sizing,
  tomlAuthLimits,
  type Assessment,
  type AuthLimits,
  type AuthSource,
  type Snapshot,
} from "../lib/capacity.ts";
import { databaseUrl, readEnv } from "../lib/credentials.ts";
import { parseFlags } from "../lib/flags.ts";
import { spawnRunner, type Runner } from "../lib/migrations.ts";
import { projectRef } from "../lib/remote-checks.ts";
import { findRepoRoot } from "../lib/repo-root.ts";
import type { CliResult } from "../cli.ts";

export const USAGE = `bogey preflight [--people <n>] [--event <org/slug>] [--db-url <postgres url>] [--json]

Checks that this instance can take an event of <n> people (participants, judges and staff
together) before doors open, and says what to change when it can't:

  Auth       the sign-in, code-check, session-refresh and email limits GoTrue enforces. Sign-in
             runs on the Bogey server, so they're sized as if everyone shared one IP. Read from
             the Management API on Supabase Cloud (needs SUPABASE_ACCESS_TOKEN), from GOTRUE_*
             variables when they're set here, or from supabase/config.toml for a CLI stack.
  Realtime   how many connections, joins and messages the Realtime tenant takes (self-hosted
             and CLI stacks; Cloud's depend on the plan).
  Database   connections already in use, failed pg_cron jobs and whether the email drain runs.
  Email      mail waiting in the outbox.
  Backup     how old the newest folder under backups/ is.

--event counts the event's members and approved registrations when --people isn't given, and
notes when the freeze starts. The database checks need DATABASE_URL (or --db-url) and psql.
Exits non-zero on anything that would break at that size; notes are what's tight.`;

const PEOPLE = /^[1-9]\d{0,5}$/;
const EVENT = /^(?:[a-z0-9-]+\/)?[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

function psqlRows(dbUrl: string, sql: string, run: Runner): string[][] | null {
  const result = run("psql", [dbUrl, "-X", "-At", "-F", "\t", "-v", "ON_ERROR_STOP=1", "-c", sql]);
  if (result.status !== 0) return null;
  return result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t"));
}

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

function readEvent(
  dbUrl: string,
  ref: string,
  run: Runner,
): { name: string; startsAt: string | null; people: number } | null {
  const [org, slug] = ref.includes("/") ? ref.split("/") : [null, ref];
  const orgFilter = org ? `and o.slug = ${quote(org)}` : "";
  const rows = psqlRows(
    dbUrl,
    `select e.name, coalesce(to_char(e.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), ''),
       (select count(*) from public.event_members m where m.event_id = e.id and m.status = 'active')
       + (select count(*) from public.registrations r
          where r.event_id = e.id and r.user_id is null and r.status in ('approved', 'pending'))
     from public.events e join public.orgs o on o.id = e.org_id
     where e.slug = ${quote(slug ?? "")} ${orgFilter} order by e.created_at limit 1`,
    run,
  );
  const row = rows?.[0];
  if (!row) return null;
  return { name: row[0] ?? ref, startsAt: row[1] || null, people: Number(row[2]) };
}

function readRealtime(dbUrl: string, run: Runner): Snapshot["realtime"] {
  const row = psqlRows(
    dbUrl,
    "select external_id, max_concurrent_users, max_joins_per_second, max_events_per_second from _realtime.tenants order by inserted_at limit 1",
    run,
  )?.[0];
  if (!row) return null;
  return {
    tenant: row[0] ?? "",
    maxConcurrentUsers: Number(row[1]),
    maxJoinsPerSecond: Number(row[2]),
    maxEventsPerSecond: Number(row[3]),
  };
}

function readDatabase(dbUrl: string, run: Runner): Snapshot["database"] {
  const row = psqlRows(
    dbUrl,
    "select current_setting('max_connections')::int, (select count(*) from pg_stat_activity)",
    run,
  )?.[0];
  return row ? { maxConnections: Number(row[0]), inUse: Number(row[1]) } : null;
}

function readCron(dbUrl: string, run: Runner): Snapshot["cron"] {
  const failed = psqlRows(
    dbUrl,
    "select distinct j.jobname from cron.job_run_details d join cron.job j using (jobid) where d.status = 'failed' and d.end_time > now() - interval '1 hour' order by 1",
    run,
  );
  const drain = psqlRows(
    dbUrl,
    "select coalesce(to_char(max(d.end_time) at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), '') from cron.job_run_details d join cron.job j using (jobid) where j.jobname = 'bogey-email-drain' and d.status = 'succeeded'",
    run,
  );
  if (!failed || !drain) return null;
  return {
    failedLastHour: failed.map((row) => row[0] ?? ""),
    lastDrainAt: drain[0]?.[0] || null,
  };
}

function readMail(dbUrl: string, run: Runner): Snapshot["mail"] {
  const row = psqlRows(
    dbUrl,
    "select count(*), coalesce(to_char(min(created_at) at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), '') from public.email_outbox where status in ('queued', 'sending')",
    run,
  )?.[0];
  return row ? { queued: Number(row[0]), oldestQueuedAt: row[1] || null } : null;
}

function newestBackup(root: string): string | null {
  const dir = join(root, "backups");
  if (!existsSync(dir)) return null;
  const times = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => statSync(join(dir, entry.name)).mtimeMs);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

async function readAuth(
  supabaseUrl: string,
  env: Readonly<Record<string, string | undefined>>,
  root: string,
  fetcher: typeof fetch,
): Promise<{ source: AuthSource; limits: AuthLimits } | null> {
  const ref = projectRef(supabaseUrl);
  if (ref) {
    const token = env.SUPABASE_ACCESS_TOKEN;
    if (!token) return null;
    try {
      const response = await fetcher(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) return null;
      const limits = cloudAuthLimits(await response.json());
      return limits ? { source: "cloud", limits } : null;
    } catch {
      return null;
    }
  }
  const fromEnv = envAuthLimits(env);
  if (fromEnv) return { source: "env", limits: fromEnv };
  const toml = join(root, "supabase", "config.toml");
  if (/:54321(?:\/|$)/.test(supabaseUrl) && existsSync(toml)) {
    return { source: "config.toml", limits: tomlAuthLimits(readFileSync(toml, "utf-8")) };
  }
  return null;
}

export function render(people: number, assessment: Assessment): string {
  const wanted = sizing(people);
  const header = assessment.issues.length
    ? `bogey preflight: ${assessment.issues.length} issue(s) for ${people} people`
    : `✓ bogey preflight: ready for ${people} people`;
  const issues = assessment.issues.flatMap((issue) => [
    `  ✗ ${issue.message}`,
    ...(issue.fix ? [`    fix: ${issue.fix}`] : []),
  ]);
  const notes = assessment.notes.map((note) => `  • ${note}`);
  const target = [
    "",
    `What ${people} people need:`,
    `  Auth      ${wanted.emailSent} emails/hour, ${wanted.otp} sign-ins and ${wanted.verify} code checks per 5 min, ${wanted.tokenRefresh} refreshes per 5 min`,
    `  Realtime  ${wanted.realtimeConnections} connections, ${wanted.realtimeJoins} joins/s, ${wanted.realtimeEvents} messages/s`,
    "  See docs/self-hosting/event-day.md for the rest of the checklist.",
  ];
  return [header, ...issues, ...notes, ...target].join("\n");
}

export async function runPreflight(
  cwd: string,
  args: string[],
  run: Runner = spawnRunner,
  fetcher: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<CliResult> {
  const flags = parseFlags(args);
  const root = findRepoRoot(cwd);
  const env: Readonly<Record<string, string | undefined>> = {
    ...readEnv(join(root, ".env")),
    ...process.env,
  };

  const peopleFlag = flags.people;
  if (peopleFlag !== undefined && (typeof peopleFlag !== "string" || !PEOPLE.test(peopleFlag))) {
    return { exitCode: 1, output: "--people takes a whole number, like --people 250." };
  }
  const eventFlag = flags.event;
  if (eventFlag !== undefined && (typeof eventFlag !== "string" || !EVENT.test(eventFlag))) {
    return { exitCode: 1, output: "--event takes an event's slug, or org/slug." };
  }

  const dbUrl = databaseUrl(root, flags["db-url"]);
  const event =
    eventFlag && dbUrl ? step(`Read ${eventFlag}`, () => readEvent(dbUrl, eventFlag, run)) : null;
  if (eventFlag && !dbUrl) {
    return {
      exitCode: 1,
      output: "--event reads the database: set DATABASE_URL or pass --db-url.",
    };
  }
  if (eventFlag && !event) return { exitCode: 1, output: `No event "${eventFlag}" here.` };

  const people = peopleFlag ? Number(peopleFlag) : (event?.people ?? 0);
  if (!people) {
    return {
      exitCode: 1,
      output: event
        ? `${event.name} has nobody yet: say how many to expect with --people.`
        : "Say how many people to expect: --people 250, or --event <org/slug> to count them.",
    };
  }

  const supabaseUrl = (env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const auth = await step("Read the auth rate limits", () =>
    readAuth(supabaseUrl, env, root, fetcher),
  );
  const fromDb = dbUrl
    ? step("Read the database", () => ({
        realtime: readRealtime(dbUrl, run),
        database: readDatabase(dbUrl, run),
        cron: readCron(dbUrl, run),
        mail: readMail(dbUrl, run),
      }))
    : { realtime: null, database: null, cron: null, mail: null };

  const snapshot: Snapshot = {
    people,
    cloud: projectRef(supabaseUrl) !== null,
    auth,
    ...fromDb,
    backupAt: newestBackup(root),
    event: event ? { name: event.name, startsAt: event.startsAt } : null,
    now,
  };
  const assessment = assess(snapshot);
  if (!dbUrl) {
    assessment.notes.push(
      "No DATABASE_URL, so Realtime, connections, background jobs and the outbox weren't checked.",
    );
  }

  if (flags.json === true) {
    return {
      exitCode: assessment.issues.length ? 1 : 0,
      output: JSON.stringify({ people, sizing: sizing(people), ...assessment, snapshot }, null, 2),
    };
  }
  return { exitCode: assessment.issues.length ? 1 : 0, output: render(people, assessment) };
}
