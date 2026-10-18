import { createAdminClient } from "@bogey/db/admin";
import { getPublicEnv } from "@bogey/db/env";

export type CheckName = "database" | "auth" | "realtime" | "email";

export interface Check {
  ok: boolean;
  ms: number;
  detail?: string;
}

export interface Readiness {
  ok: boolean;
  checks: Record<CheckName, Check>;
}

type Probe = () => Promise<string | null>;

const PROBE_TIMEOUT_MS = 3_000;
const CACHE_MS = 5_000;
/** Mail the drain hasn't picked up after this long means pg_cron, pg_net or the app is stuck. */
export const MAIL_STUCK_MS = 5 * 60_000;

async function time(probe: Probe): Promise<Check> {
  const began = performance.now();
  let detail: string | null;
  try {
    detail = await Promise.race([
      probe(),
      new Promise<string>((resolve) =>
        setTimeout(() => resolve(`no answer in ${PROBE_TIMEOUT_MS} ms`), PROBE_TIMEOUT_MS),
      ),
    ]);
  } catch (error) {
    detail = error instanceof Error ? error.message : String(error);
  }
  const ms = Math.round(performance.now() - began);
  return detail ? { ok: false, ms, detail } : { ok: true, ms };
}

async function reachable(path: string): Promise<string | null> {
  const { supabaseUrl, supabaseKey } = getPublicEnv();
  const response = await fetch(`${supabaseUrl.replace(/\/+$/, "")}${path}`, {
    headers: { apikey: supabaseKey },
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  return response.ok ? null : `HTTP ${response.status}`;
}

export function mailProblem(oldestQueuedAt: string | null, now: number): string | null {
  if (!oldestQueuedAt) return null;
  return now - Date.parse(oldestQueuedAt) > MAIL_STUCK_MS ? "mail is waiting to be sent" : null;
}

export const PROBES: Record<CheckName, Probe> = {
  database: async () => {
    const { error } = await createAdminClient().from("orgs").select("id").limit(1);
    return error ? "the database didn't answer" : null;
  },
  auth: () => reachable("/auth/v1/health"),
  realtime: () => reachable("/realtime/v1/api/ping"),
  email: async () => {
    const { data, error } = await createAdminClient()
      .from("email_outbox")
      .select("created_at")
      .in("status", ["queued", "sending"])
      .order("created_at")
      .limit(1);
    if (error) return "couldn't read the outbox";
    return mailProblem(data[0]?.created_at ?? null, Date.now());
  },
};

export async function check(probes: Record<CheckName, Probe>): Promise<Readiness> {
  const [database, auth, realtime, email] = await Promise.all([
    time(probes.database),
    time(probes.auth),
    time(probes.realtime),
    time(probes.email),
  ]);
  const checks = { database, auth, realtime, email };
  return { ok: Object.values(checks).every((each) => each.ok), checks };
}

let cached: { at: number; report: Promise<Readiness> } | null = null;

/** Probes at most once every few seconds, however often monitors (or anyone) ask. */
export function readiness(): Promise<Readiness> {
  const now = Date.now();
  if (!cached || now - cached.at > CACHE_MS) cached = { at: now, report: check(PROBES) };
  return cached.report;
}
