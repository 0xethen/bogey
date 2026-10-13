import { createApi } from "./api.ts";
import { loadConfig } from "./config.ts";
import { worker, type Logger } from "./runner.ts";
import { DockerSandbox } from "./sandbox.ts";
import { selfTest } from "./self-test.ts";

const log: Logger = {
  info: (message) => console.log(`${new Date().toISOString()} ${message}`),
  error: (message) => console.error(`${new Date().toISOString()} ${message}`),
};

async function main() {
  const config = loadConfig();
  const sandbox = new DockerSandbox(config.dockerBin, config.runnerId);

  if (process.argv.includes("--self-test")) {
    const only = process.argv
      .find((arg) => arg.startsWith("--language="))
      ?.slice("--language=".length);
    process.exitCode = (await selfTest({ config, sandbox, log, only })) ? 0 : 1;
    return;
  }

  await sandbox.cleanup();
  const api = createApi(config);
  const stop = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      log.info(`${signal}: finishing up; judgings in hand go back to the queue`);
      stop.abort();
    });
  }
  log.info(
    `runner ${config.runnerId} starting: ${config.concurrency} at a time, work in ${config.workDir}`,
  );
  await Promise.all(
    Array.from({ length: config.concurrency }, (_, index) =>
      worker(index, { api, sandbox, config, log, stop: stop.signal }),
    ),
  );
  await sandbox.cleanup();
  log.info("stopped");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
