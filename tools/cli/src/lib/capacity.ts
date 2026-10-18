import type { ConsistencyIssue } from "./checks.ts";

/**
 * What an instance needs for an event of `people` (participants, judges and staff together).
 *
 * Sign-in runs on the Bogey server, so GoTrue's per-IP limits count the server's address
 * (and a venue's Wi-Fi shares one address anyway): size them as if every sign-in came from
 * one IP. The email limit is per hour for the whole project, and applies with the Send Email
 * hook too. Realtime counts every open tab as a connection.
 */
export interface Sizing {
  /** GoTrue: emails per hour, whole project. */
  emailSent: number;
  /** GoTrue: sign-in and sign-up requests per 5 minutes per IP. */
  otp: number;
  /** GoTrue: code and link verifications per 5 minutes per IP. */
  verify: number;
  /** GoTrue: session refreshes per 5 minutes per IP. */
  tokenRefresh: number;
  /** Realtime: concurrent connections (one per open tab). */
  realtimeConnections: number;
  /** Realtime: channel joins per second. */
  realtimeJoins: number;
  /** Realtime: messages per second. */
  realtimeEvents: number;
}

const roundUp = (value: number, step = 50) => Math.ceil(value / step) * step;

export function sizing(people: number): Sizing {
  return {
    emailSent: roundUp(people * 2),
    otp: roundUp(people * 2),
    verify: roundUp(people * 2),
    tokenRefresh: roundUp(people * 4),
    realtimeConnections: roundUp(people * 2),
    realtimeJoins: Math.max(100, roundUp(people)),
    realtimeEvents: Math.max(100, roundUp(people * 2)),
  };
}

export interface AuthLimits {
  emailSent: number;
  otp: number;
  verify: number;
  tokenRefresh: number;
}

/** GoTrue's own defaults, which apply when a self-hosted stack sets nothing. */
export const GOTRUE_DEFAULTS: AuthLimits = {
  emailSent: 30,
  otp: 30,
  verify: 30,
  tokenRefresh: 150,
};

export type AuthSource = "cloud" | "env" | "config.toml";

export interface RealtimeLimits {
  tenant: string;
  maxConcurrentUsers: number;
  maxJoinsPerSecond: number;
  maxEventsPerSecond: number;
}

export interface Snapshot {
  people: number;
  cloud: boolean;
  auth: { source: AuthSource; limits: AuthLimits } | null;
  realtime: RealtimeLimits | null;
  database: { maxConnections: number; inUse: number } | null;
  cron: { failedLastHour: Tuple<string>; lastDrainAt: string | null } | null;
  mail: { queued: number; oldestQueuedAt: string | null } | null;
  /** The newest folder under backups/, as a time; null when there is none. */
  backupAt: string | null;
  event: { name: string; startsAt: string | null } | null;
  now: number;
}

export interface Finding extends ConsistencyIssue {
  fix?: string;
}

export interface Assessment {
  issues: Finding[];
  notes: string[];
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const AUTH_LABELS: Record<keyof AuthLimits, { label: string; env: string; toml: string }> = {
  emailSent: {
    label: "emails per hour",
    env: "GOTRUE_RATE_LIMIT_EMAIL_SENT",
    toml: "email_sent",
  },
  otp: {
    label: "sign-ins per 5 minutes",
    env: "GOTRUE_RATE_LIMIT_OTP",
    toml: "sign_in_sign_ups",
  },
  verify: {
    label: "code checks per 5 minutes",
    env: "GOTRUE_RATE_LIMIT_VERIFY",
    toml: "token_verifications",
  },
  tokenRefresh: {
    label: "session refreshes per 5 minutes",
    env: "GOTRUE_RATE_LIMIT_TOKEN_REFRESH",
    toml: "token_refresh",
  },
};

const AUTH_KEYS: Tuple<keyof AuthLimits> = ["emailSent", "otp", "verify", "tokenRefresh"];

function authFix(source: AuthSource, wanted: AuthLimits): string {
  if (source === "cloud") {
    return `Dashboard → Authentication → Rate Limits: ${AUTH_KEYS.map((key) => `${AUTH_LABELS[key].label} ${wanted[key]}`).join(", ")}.`;
  }
  if (source === "config.toml") {
    return `In supabase/config.toml [auth.rate_limit]: ${AUTH_KEYS.map((key) => `${AUTH_LABELS[key].toml} = ${wanted[key]}`).join(", ")}, then supabase stop && supabase start.`;
  }
  return `In Supabase's .env or compose file: ${AUTH_KEYS.map((key) => `${AUTH_LABELS[key].env}=${wanted[key]}`).join(" ")}, then recreate the auth container.`;
}

function realtimeFix(tenant: string, wanted: Sizing): string {
  return `as supabase_admin (postgres can only read it), e.g. docker compose exec db psql -U supabase_admin -d postgres -c "update _realtime.tenants set max_concurrent_users = ${wanted.realtimeConnections}, max_joins_per_second = ${wanted.realtimeJoins}, max_events_per_second = ${wanted.realtimeEvents} where external_id = '${tenant}'", then restart the realtime container.`;
}

export function assess(snapshot: Snapshot): Assessment {
  const { people } = snapshot;
  const wanted = sizing(people);
  const issues: Finding[] = [];
  const notes: string[] = [];

  if (snapshot.auth) {
    const { limits, source } = snapshot.auth;
    const short = AUTH_KEYS.filter((key) => limits[key] < wanted[key]);
    const breaking = short.filter((key) => limits[key] < people);
    if (short.length) {
      const describe = (key: keyof AuthLimits) =>
        `${AUTH_LABELS[key].label} is ${limits[key]} (want ${wanted[key]})`;
      const message = `Auth allows too little for ${people} people: ${short.map(describe).join("; ")}. Sign-in runs on the Bogey server, so every attendee counts against one IP's limits.`;
      if (breaking.length) issues.push({ message, fix: authFix(source, wanted) });
      else notes.push(`${message} Fix: ${authFix(source, wanted)}`);
    }
  } else if (snapshot.cloud) {
    notes.push(
      `Couldn't read the project's auth rate limits: set SUPABASE_ACCESS_TOKEN (a Management API token) and run again, or check them by hand. ${authFix("cloud", wanted)}`,
    );
  } else {
    notes.push(
      `Couldn't tell which auth rate limits apply (no GOTRUE_* variables here, and the URL isn't a Supabase CLI stack). ${authFix("env", wanted)}`,
    );
  }

  if (snapshot.realtime) {
    const realtime = snapshot.realtime;
    if (realtime.maxConcurrentUsers < people) {
      issues.push({
        message: `Realtime takes ${realtime.maxConcurrentUsers} connections at once, fewer than ${people} people; the rest get too_many_connections and live pages stop updating.`,
        fix: realtimeFix(realtime.tenant, wanted),
      });
    } else if (
      realtime.maxConcurrentUsers < wanted.realtimeConnections ||
      realtime.maxJoinsPerSecond < wanted.realtimeJoins ||
      realtime.maxEventsPerSecond < wanted.realtimeEvents
    ) {
      notes.push(
        `Realtime is tight for ${people} people (${realtime.maxConcurrentUsers} connections, ${realtime.maxJoinsPerSecond} joins/s, ${realtime.maxEventsPerSecond} messages/s; want ${wanted.realtimeConnections}, ${wanted.realtimeJoins}, ${wanted.realtimeEvents}): people keep more than one tab open. Fix: ${realtimeFix(realtime.tenant, wanted)}`,
      );
    }
  } else if (snapshot.cloud) {
    const message = `Supabase Cloud caps Realtime by plan: Free 200 connections at once, Pro 500 (10,000 without the spend cap). ${people} people want about ${wanted.realtimeConnections}.`;
    if (people > 200) {
      notes.push(
        `${message} On Free, live pages break past 200. Check Reports → Realtime in the dashboard.`,
      );
    } else {
      notes.push(message);
    }
  } else {
    notes.push(
      "Couldn't read Realtime's limits (_realtime.tenants): set DATABASE_URL and run again.",
    );
  }

  if (snapshot.database) {
    const { maxConnections, inUse } = snapshot.database;
    if (inUse / maxConnections > 0.8) {
      issues.push({
        message: `The database has ${inUse} of ${maxConnections} connections in use already.`,
        fix: "Find what holds them (select usename, application_name, count(*) from pg_stat_activity group by 1, 2), or move to a bigger compute size.",
      });
    }
  }

  if (snapshot.cron) {
    const { failedLastHour, lastDrainAt } = snapshot.cron;
    if (failedLastHour.length) {
      issues.push({
        message: `Background jobs failed in the last hour: ${failedLastHour.join(", ")}.`,
        fix: "select jobname, return_message from cron.job_run_details join cron.job using (jobid) where status = 'failed' order by end_time desc limit 5",
      });
    }
    if (!lastDrainAt || snapshot.now - Date.parse(lastDrainAt) > 5 * MINUTE) {
      issues.push({
        message: lastDrainAt
          ? `The email drain last ran at ${lastDrainAt}; it should run every minute.`
          : "The email drain (pg_cron job bogey-email-drain) hasn't run.",
        fix: "Check that pg_cron is enabled and the bogey-email-drain job exists (bogey db repair puts it back).",
      });
    }
  }

  if (snapshot.mail?.oldestQueuedAt) {
    const waited = snapshot.now - Date.parse(snapshot.mail.oldestQueuedAt);
    if (waited > 5 * MINUTE) {
      issues.push({
        message: `${snapshot.mail.queued} email(s) are waiting, the oldest since ${snapshot.mail.oldestQueuedAt}.`,
        fix: "bogey queues shows the last failure; the drain needs appUrl set and the app reachable from the database.",
      });
    }
  }

  const starts = snapshot.event?.startsAt ? Date.parse(snapshot.event.startsAt) : null;
  if (!snapshot.backupAt) {
    notes.push("There's no backup under backups/: run bogey backup the night before.");
  } else if (snapshot.now - Date.parse(snapshot.backupAt) > 24 * HOUR) {
    notes.push(
      `The newest backup is from ${snapshot.backupAt}: take a fresh one (bogey backup) the night before.`,
    );
  }

  if (snapshot.event) {
    const when = snapshot.event.startsAt
      ? ` It starts ${snapshot.event.startsAt}; don't upgrade, rebuild or edit bogey.config.ts from an hour before until results are out.`
      : "";
    notes.push(`Sized for ${snapshot.event.name}: ${people} people.${when}`);
    if (starts !== null && starts - snapshot.now > 0 && starts - snapshot.now < HOUR) {
      notes.push("Doors open within the hour: the freeze has started.");
    }
  }

  return { issues, notes };
}

/** The [auth.rate_limit] numbers in a supabase/config.toml, over GoTrue's defaults. */
export function tomlAuthLimits(toml: string): AuthLimits {
  const lines = toml.split("\n");
  const start = lines.findIndex((line) => line.trim() === "[auth.rate_limit]");
  const rest = start === -1 ? [] : lines.slice(start + 1);
  const end = rest.findIndex((line) => line.trim().startsWith("["));
  const section = (end === -1 ? rest : rest.slice(0, end)).join("\n");
  const read = (key: string, fallback: number) => {
    const match = new RegExp(`^${key}\\s*=\\s*(\\d+)`, "m").exec(section);
    return match ? Number(match[1]) : fallback;
  };
  return {
    emailSent: read("email_sent", GOTRUE_DEFAULTS.emailSent),
    otp: read("sign_in_sign_ups", GOTRUE_DEFAULTS.otp),
    verify: read("token_verifications", GOTRUE_DEFAULTS.verify),
    tokenRefresh: read("token_refresh", GOTRUE_DEFAULTS.tokenRefresh),
  };
}

/** GOTRUE_RATE_LIMIT_* from an environment, or null when it declares no GOTRUE_* at all. */
export function envAuthLimits(
  env: Readonly<Record<string, string | undefined>>,
): AuthLimits | null {
  if (!Object.keys(env).some((key) => key.startsWith("GOTRUE_"))) return null;
  const read = (key: keyof AuthLimits) => {
    const value = Number(env[AUTH_LABELS[key].env]);
    return Number.isFinite(value) && value > 0 ? value : GOTRUE_DEFAULTS[key];
  };
  return {
    emailSent: read("emailSent"),
    otp: read("otp"),
    verify: read("verify"),
    tokenRefresh: read("tokenRefresh"),
  };
}

/** The Management API's /config/auth answer, as limits. */
export function cloudAuthLimits(body: unknown): AuthLimits | null {
  if (typeof body !== "object" || body === null) return null;
  const record: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(body));
  const read = (key: string, fallback: number) => {
    const value = record[key];
    return typeof value === "number" ? value : fallback;
  };
  return {
    emailSent: read("rate_limit_email_sent", GOTRUE_DEFAULTS.emailSent),
    otp: read("rate_limit_otp", GOTRUE_DEFAULTS.otp),
    verify: read("rate_limit_verify", GOTRUE_DEFAULTS.verify),
    tokenRefresh: read("rate_limit_token_refresh", GOTRUE_DEFAULTS.tokenRefresh),
  };
}
