import { hostname, tmpdir } from "node:os";
import { join } from "node:path";

export interface HostLimits {
  maxTimeMs: number;
  maxMemoryMb: number;
  maxOutputKb: number;
  cpus: number;
  pids: number;
  compileTimeMs: number;
  compileMemoryMb: number;
  compileCpus: number;
  compilePids: number;
  /** the whole judging, every compile and test together */
  judgingTimeMs: number;
}

/**
 * `key` is a runner key from `bogey runner key add`, which can only claim, read the tests of what
 * it holds and record verdicts. `service` is the old service-role key, kept for installs that
 * haven't switched yet.
 */
export type Credential =
  | { kind: "key"; runnerKey: string; apiKey: string | null }
  | { kind: "service"; serviceKey: string };

export interface Config {
  supabaseUrl: string;
  credential: Credential;
  runnerId: string;
  concurrency: number;
  pollMs: number;
  leaseSeconds: number;
  workDir: string;
  dockerBin: string;
  runtime: string;
  images: Tuple<string>;
  nproc: number;
  limits: HostLimits;
  warnings: Tuple<string>;
}

export const DEFAULT_IMAGES = ["bogey-runner-*", "ghcr.io/0xethen/bogey-runner-*"];
export const RUNNER_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
export const RUNNER_KEY = /^bogey_runner_[A-Za-z0-9_-]{43}$/;
const RUNTIME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

function integer(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}, not "${raw}"`);
  }
  return value;
}

function number(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a number from ${min} to ${max}, not "${raw}"`);
  }
  return value;
}

function credentialOf(env: NodeJS.ProcessEnv, warnings: string[]): Credential {
  const runnerKey = env.BOGEY_RUNNER_KEY;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (runnerKey) {
    if (!RUNNER_KEY.test(runnerKey)) {
      throw new Error("BOGEY_RUNNER_KEY isn't a runner key. Make one with `bogey runner key add`.");
    }
    if (serviceKey) {
      throw new Error(
        "Both BOGEY_RUNNER_KEY and SUPABASE_SERVICE_ROLE_KEY are set. Remove the service key: the runner needs only its own key.",
      );
    }
    const apiKey = env.SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY || null;
    return { kind: "key", runnerKey, apiKey };
  }
  if (serviceKey) {
    warnings.push(
      "This runner holds the service-role key, which can read and change everything. Make it a runner key (`bogey runner key add <name>`), set BOGEY_RUNNER_KEY and remove SUPABASE_SERVICE_ROLE_KEY. See docs/self-hosting/runner-security.md.",
    );
    return { kind: "service", serviceKey };
  }
  throw new Error(
    "Set BOGEY_RUNNER_KEY to a runner key (`bogey runner key add <name>` prints one).",
  );
}

function defaultId(): string {
  const host = hostname()
    .replace(/[^A-Za-z0-9_.-]/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "");
  return `${host || "runner"}-${process.pid}`.slice(0, 64);
}

function list(raw: string | undefined, fallback: Tuple<string>): Tuple<string> {
  if (!raw) return fallback;
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: { selfTest?: boolean } = {},
): Config {
  const backend = env.BOGEY_RUNNER_BACKEND ?? "docker";
  if (backend !== "docker") {
    throw new Error(
      `BOGEY_RUNNER_BACKEND="${backend}" isn't built. Docker is the only sandbox in this version.`,
    );
  }
  const warnings: string[] = [];
  // the self-test judges known programs and never talks to the database
  const supabaseUrl = options.selfTest
    ? "http://self-test.invalid"
    : env.SUPABASE_URL?.replace(/\/+$/, "");
  if (!supabaseUrl || !/^https?:\/\//.test(supabaseUrl))
    throw new Error("Set SUPABASE_URL to the project's address.");
  const credential: Credential = options.selfTest
    ? { kind: "key", runnerKey: "", apiKey: null }
    : credentialOf(env, warnings);

  const runnerId = env.BOGEY_RUNNER_ID || defaultId();
  if (!RUNNER_ID.test(runnerId)) {
    throw new Error(
      `BOGEY_RUNNER_ID must be letters, digits, ".", "_" or "-" (64 at most), not "${runnerId}"`,
    );
  }
  const runtime = env.BOGEY_RUNNER_RUNTIME ?? "";
  if (runtime && !RUNTIME.test(runtime)) {
    throw new Error(`BOGEY_RUNNER_RUNTIME="${runtime}" isn't a runtime name (runc, runsc...)`);
  }
  const concurrency = integer(env, "BOGEY_RUNNER_CONCURRENCY", 2, 1, 64);
  const pids = integer(env, "BOGEY_RUNNER_PIDS", 128, 8, 65_536);
  const compilePids = integer(env, "BOGEY_RUNNER_COMPILE_PIDS", 512, 8, 65_536);

  return {
    supabaseUrl,
    credential,
    runnerId,
    concurrency,
    pollMs: integer(env, "BOGEY_RUNNER_POLL_MS", 2_000, 200, 60_000),
    leaseSeconds: integer(env, "BOGEY_RUNNER_LEASE_SECONDS", 120, 30, 3_600),
    workDir: join(env.BOGEY_RUNNER_WORK_DIR || join(tmpdir(), "bogey-runner"), runnerId),
    dockerBin: env.BOGEY_RUNNER_DOCKER || "docker",
    runtime,
    images: list(env.BOGEY_RUNNER_IMAGES, DEFAULT_IMAGES),
    // RLIMIT_NPROC counts every process of the sandbox user on the host, so it covers all at once
    nproc: integer(
      env,
      "BOGEY_RUNNER_NPROC",
      Math.max(pids, compilePids) * concurrency * 2,
      16,
      1_048_576,
    ),
    limits: {
      maxTimeMs: integer(env, "BOGEY_RUNNER_MAX_TIME_MS", 20_000, 100, 600_000),
      maxMemoryMb: integer(env, "BOGEY_RUNNER_MAX_MEMORY_MB", 1_024, 16, 65_536),
      maxOutputKb: integer(env, "BOGEY_RUNNER_MAX_OUTPUT_KB", 16_384, 1, 1_048_576),
      cpus: number(env, "BOGEY_RUNNER_CPUS", 1, 0.1, 64),
      pids,
      compileTimeMs: integer(env, "BOGEY_RUNNER_COMPILE_TIME_MS", 60_000, 1_000, 1_800_000),
      compileMemoryMb: integer(env, "BOGEY_RUNNER_COMPILE_MEMORY_MB", 2_048, 64, 65_536),
      compileCpus: number(env, "BOGEY_RUNNER_COMPILE_CPUS", 2, 0.1, 64),
      compilePids,
      judgingTimeMs: integer(env, "BOGEY_RUNNER_JUDGING_TIME_MS", 900_000, 10_000, 21_600_000),
    },
    warnings,
  };
}
