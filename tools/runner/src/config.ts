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
}

export interface Config {
  supabaseUrl: string;
  serviceKey: string;
  runnerId: string;
  concurrency: number;
  pollMs: number;
  leaseSeconds: number;
  workDir: string;
  dockerBin: string;
  limits: HostLimits;
}

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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const backend = env.BOGEY_RUNNER_BACKEND ?? "docker";
  if (backend !== "docker") {
    throw new Error(
      `BOGEY_RUNNER_BACKEND="${backend}" isn't built. Docker is the only sandbox in this version.`,
    );
  }
  const supabaseUrl = env.SUPABASE_URL?.replace(/\/+$/, "");
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !/^https?:\/\//.test(supabaseUrl))
    throw new Error("Set SUPABASE_URL to the project's address.");
  if (!serviceKey)
    throw new Error(
      "Set SUPABASE_SERVICE_ROLE_KEY. The runner holds it; keep it off every other machine.",
    );

  return {
    supabaseUrl,
    serviceKey,
    runnerId: env.BOGEY_RUNNER_ID || `${hostname()}-${process.pid}`,
    concurrency: integer(env, "BOGEY_RUNNER_CONCURRENCY", 2, 1, 64),
    pollMs: integer(env, "BOGEY_RUNNER_POLL_MS", 2_000, 200, 60_000),
    leaseSeconds: integer(env, "BOGEY_RUNNER_LEASE_SECONDS", 120, 30, 3_600),
    workDir: env.BOGEY_RUNNER_WORK_DIR || join(tmpdir(), "bogey-runner"),
    dockerBin: env.BOGEY_RUNNER_DOCKER || "docker",
    limits: {
      maxTimeMs: integer(env, "BOGEY_RUNNER_MAX_TIME_MS", 20_000, 100, 600_000),
      maxMemoryMb: integer(env, "BOGEY_RUNNER_MAX_MEMORY_MB", 1_024, 16, 65_536),
      maxOutputKb: integer(env, "BOGEY_RUNNER_MAX_OUTPUT_KB", 16_384, 1, 1_048_576),
      cpus: number(env, "BOGEY_RUNNER_CPUS", 1, 0.1, 64),
      pids: integer(env, "BOGEY_RUNNER_PIDS", 128, 8, 65_536),
      compileTimeMs: integer(env, "BOGEY_RUNNER_COMPILE_TIME_MS", 60_000, 1_000, 1_800_000),
      compileMemoryMb: integer(env, "BOGEY_RUNNER_COMPILE_MEMORY_MB", 2_048, 64, 65_536),
      compileCpus: number(env, "BOGEY_RUNNER_COMPILE_CPUS", 2, 0.1, 64),
      compilePids: integer(env, "BOGEY_RUNNER_COMPILE_PIDS", 512, 8, 65_536),
    },
  };
}
