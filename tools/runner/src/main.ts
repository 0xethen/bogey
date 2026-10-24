import { createApi } from "./api.ts";
import { loadConfig } from "./config.ts";
import { clearWorkDir, prepareWorkDir } from "./paths.ts";
import { worker, type Logger } from "./runner.ts";
import { DockerSandbox } from "./sandbox.ts";
import { selfTest } from "./self-test.ts";

const log: Logger = {
  info: (message) => console.log(`${new Date().toISOString()} ${message}`),
  error: (message) => console.error(`${new Date().toISOString()} ${message}`),
};

async function main() {
  const testing = process.argv.includes("--self-test");
  const config = loadConfig(process.env, { selfTest: testing });
  for (const warning of config.warnings) log.error(`warning: ${warning}`);
  const sandbox = new DockerSandbox({
    docker: config.dockerBin,
    label: config.runnerId,
    runtime: config.runtime,
    nproc: config.nproc,
    images: config.images,
  });

  await prepareWorkDir(config.workDir);

  // the self-test may run beside a judging runner with the same id, so it clears nothing
  if (testing) {
    const only = process.argv
      .find((arg) => arg.startsWith("--language="))
      ?.slice("--language=".length);
    process.exitCode = (await selfTest({ config, sandbox, log, only })) ? 0 : 1;
    return;
  }

  await sandbox.cleanup();
  for (const left of await clearWorkDir(config.workDir)) {
    log.error(`warning: couldn't remove ${left}, which a sandbox left; remove it as root`);
  }

  const api = createApi(config);
  const stop = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      log.info(`${signal}: finishing up; judgings in hand go back to the queue`);
      stop.abort();
    });
  }
  log.info(
    `runner ${config.runnerId} starting: ${config.concurrency} at a time, work in ${config.workDir}, ${config.credential.kind === "key" ? "runner key" : "service key"}, runtime ${config.runtime || "default"}`,
  );
  await Promise.all(
    Array.from({ length: config.concurrency }, (_, index) =>
      worker(index, { api, sandbox, config, log, stop: stop.signal }),
    ),
  );
  await sandbox.cleanup();
  await clearWorkDir(config.workDir);
  log.info("stopped");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
