import { loadConfig } from "./config.ts";
import { createProxy } from "./docker-proxy.ts";
import type { Policy } from "./docker-policy.ts";

function main() {
  const env = process.env;
  if (!env.BOGEY_RUNNER_ID) {
    throw new Error("Set BOGEY_RUNNER_ID to the runner's id, the same as the runner's.");
  }
  if (!env.BOGEY_RUNNER_WORK_DIR) {
    throw new Error("Set BOGEY_RUNNER_WORK_DIR, the same as the runner's.");
  }
  // reads the same BOGEY_RUNNER_* settings as the runner, and no credentials
  const config = loadConfig(env, { selfTest: true });
  const { limits } = config;
  const policy: Policy = {
    workDir: config.workDir,
    images: config.images,
    runtime: config.runtime,
    label: config.runnerId,
    maxMemoryMb: Math.max(limits.maxMemoryMb, limits.compileMemoryMb, 512),
    maxPids: Math.max(limits.pids, limits.compilePids, 64),
    maxCpus: Math.max(limits.cpus, limits.compileCpus, 1),
  };
  const socket = env.DOCKER_SOCKET || "/var/run/docker.sock";
  const listen = env.BOGEY_DOCKER_PROXY_LISTEN || "0.0.0.0:2375";
  const log = (message: string) => console.log(`${new Date().toISOString()} ${message}`);
  const server = createProxy({
    socket,
    policy,
    log,
    verbose: env.BOGEY_DOCKER_PROXY_LOG === "all",
  });
  if (listen.startsWith("/")) server.listen(listen);
  else {
    const at = listen.lastIndexOf(":");
    server.listen(Number(listen.slice(at + 1)), listen.slice(0, at));
  }
  log(
    `docker proxy on ${listen} for runner ${policy.label}: mounts under ${policy.workDir}, runtime ${policy.runtime || "default"}`,
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
