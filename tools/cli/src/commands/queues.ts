import { serviceCredentials } from "../lib/credentials.ts";
import { select } from "../lib/rest.ts";
import { parseFlags } from "../lib/flags.ts";
import type { CliResult } from "../cli.ts";

export const USAGE = `bogey queues [--json]

How much mail and how many webhook deliveries are waiting, how old the oldest is, and the last
failure of each. Reads the tables with the service key.`;

interface Waiting {
  status: string;
  created_at: string;
  last_error: string | null;
}

export interface Queue {
  name: string;
  queued: number;
  failedLastDay: number;
  oldestQueuedAt: string | null;
  lastError: string | null;
}

const DAY = 24 * 60 * 60 * 1000;

export function summarize(name: string, rows: readonly Waiting[], now = Date.now()): Queue {
  const waiting = rows.filter((row) => row.status === "queued" || row.status === "sending");
  const oldest = waiting.map((row) => row.created_at).sort()[0] ?? null;
  const failed = rows.filter((row) => row.status === "failed");
  return {
    name,
    queued: waiting.length,
    failedLastDay: failed.filter((row) => now - Date.parse(row.created_at) < DAY).length,
    oldestQueuedAt: oldest,
    lastError:
      [...failed].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.last_error ?? null,
  };
}

function line(queue: Queue): string {
  const age = queue.oldestQueuedAt ? `, oldest since ${queue.oldestQueuedAt}` : "";
  const failure = queue.lastError ? `\n    last failure: ${queue.lastError}` : "";
  return `${queue.name}: ${queue.queued} waiting${age}; ${queue.failedLastDay} failed in the last day${failure}`;
}

export async function runQueues(cwd: string, args: string[]): Promise<CliResult> {
  const flags = parseFlags(args);
  const resolved = serviceCredentials(cwd);
  if (!resolved.ok) return { exitCode: 1, output: resolved.error };
  const query = "select=status,created_at,last_error&order=created_at.desc&limit=1000";
  const [mail, hooks] = await Promise.all([
    select<Waiting>(resolved.credentials, "email_outbox", query),
    select<Waiting>(resolved.credentials, "webhook_deliveries", query),
  ]);
  if (!mail.ok) return { exitCode: 1, output: mail.error };
  if (!hooks.ok) return { exitCode: 1, output: hooks.error };
  const queues = [summarize("Email", mail.data), summarize("Webhooks", hooks.data)];
  return {
    exitCode: 0,
    output: flags.json === true ? JSON.stringify(queues) : queues.map(line).join("\n"),
  };
}
