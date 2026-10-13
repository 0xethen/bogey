import { type Api } from "./api.ts";
import type { Config } from "./config.ts";
import { judge } from "./judge.ts";
import type { Sandbox } from "./sandbox.ts";
import { InfraError, type Claim } from "./types.ts";

export interface Logger {
  info(message: string): void;
  error(message: string): void;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

export async function runClaim(
  claim: Claim,
  deps: { api: Api; sandbox: Sandbox; config: Config; log: Logger; stop: AbortSignal },
): Promise<"recorded" | "dropped" | "requeued" | "released"> {
  const { api, sandbox, config, log } = deps;
  const lost = new AbortController();
  const heartbeat = setInterval(
    () => {
      api.heartbeat(claim.judgingId).then(
        (kept) => {
          if (!kept) lost.abort();
        },
        (error: unknown) => log.error(`heartbeat for ${claim.judgingId} failed: ${String(error)}`),
      );
    },
    Math.max(5_000, (config.leaseSeconds * 1000) / 3),
  );
  const abort = AbortSignal.any([lost.signal, deps.stop]);
  try {
    const outcome = await judge(claim, {
      api,
      sandbox,
      limits: config.limits,
      workDir: config.workDir,
      signal: abort,
    });
    if (lost.signal.aborted) return "dropped";
    const kept = await api.record(claim.judgingId, outcome);
    log.info(
      `judging ${claim.judgingId} (${claim.problem.label}, ${claim.language.key}): ${outcome.verdict}`,
    );
    return kept ? "recorded" : "dropped";
  } catch (error) {
    if (lost.signal.aborted) return "dropped";
    if (deps.stop.aborted) {
      await api.release(claim.judgingId).catch(() => {});
      return "released";
    }
    const reason = error instanceof Error ? error.message : String(error);
    if (error instanceof InfraError) log.error(`judging ${claim.judgingId}: ${reason}`);
    else
      log.error(
        `judging ${claim.judgingId} failed unexpectedly: ${error instanceof Error ? (error.stack ?? reason) : reason}`,
      );
    await api.requeue(claim.judgingId, reason).catch((requeueError: unknown) => {
      log.error(`couldn't hand ${claim.judgingId} back: ${String(requeueError)}`);
    });
    return "requeued";
  } finally {
    clearInterval(heartbeat);
  }
}

export async function worker(
  index: number,
  deps: { api: Api; sandbox: Sandbox; config: Config; log: Logger; stop: AbortSignal },
): Promise<void> {
  const { api, config, log, stop } = deps;
  while (!stop.aborted) {
    let claim: Claim | null;
    try {
      claim = await api.claim();
    } catch (error) {
      log.error(`worker ${index}: claiming failed: ${String(error)}`);
      await sleep(config.pollMs * 2, stop);
      continue;
    }
    if (!claim) {
      await sleep(config.pollMs, stop);
      continue;
    }
    const result = await runClaim(claim, deps);
    if (result === "requeued") await sleep(config.pollMs * 2, stop);
  }
}
