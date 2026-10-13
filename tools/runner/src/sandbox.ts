import { spawn } from "node:child_process";
import { InfraError } from "./types.ts";

export interface Mount {
  host: string;
  container: string;
  writable: boolean;
}

export interface ExecSpec {
  image: string;
  command: string;
  cwd: string;
  mounts: Tuple<Mount>;
  stdin: string;
  timeMs: number;
  memoryMb: number;
  cpus: number;
  pids: number;
  maxOutputBytes: number;
  tmpfsMb: number;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  elapsedMs: number;
  timedOut: boolean;
  outputExceeded: boolean;
}

export interface Sandbox {
  exec(spec: ExecSpec, signal?: AbortSignal): Promise<ExecResult>;
  cleanup(): Promise<void>;
}

export const DOCKER_FAILED = 125;
export const KILLED = 137;

function capture(
  stream: NodeJS.ReadableStream | null,
  max: number,
  onExceeded: () => void,
): () => string {
  const chunks: Buffer[] = [];
  let size = 0;
  stream?.on("data", (chunk: Buffer) => {
    if (size > max) return;
    chunks.push(chunk);
    size += chunk.length;
    if (size > max) onExceeded();
  });
  return () => Buffer.concat(chunks).subarray(0, max).toString("utf-8");
}

export function dockerArgs(name: string, label: string, spec: ExecSpec): string[] {
  return [
    "run",
    "--rm",
    "-i",
    "--name",
    name,
    "--label",
    `bogey-runner=${label}`,
    "--network",
    "none",
    "--read-only",
    "--tmpfs",
    `/tmp:rw,nosuid,size=${spec.tmpfsMb}m`,
    "--memory",
    `${spec.memoryMb}m`,
    "--memory-swap",
    `${spec.memoryMb}m`,
    "--cpus",
    String(spec.cpus),
    "--pids-limit",
    String(spec.pids),
    "--ulimit",
    "nofile=1024:1024",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--user",
    "65534:65534",
    "-e",
    "HOME=/tmp",
    "-w",
    spec.cwd,
    ...spec.mounts.flatMap((mount) => [
      "-v",
      `${mount.host}:${mount.container}:${mount.writable ? "rw" : "ro"}`,
    ]),
    spec.image,
    "sh",
    "-c",
    spec.command,
  ];
}

export class DockerSandbox implements Sandbox {
  private counter = 0;
  private overhead = new Map<string, number>();

  private readonly docker: string;
  private readonly label: string;

  constructor(docker: string, label: string) {
    this.docker = docker;
    this.label = label;
  }

  private async measureOverhead(image: string): Promise<number> {
    const known = this.overhead.get(image);
    if (known !== undefined) return known;
    let cheapest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 3; i++) {
      const result = await this.once({
        image,
        command: ":",
        cwd: "/tmp",
        mounts: [],
        stdin: "",
        timeMs: 30_000,
        memoryMb: 128,
        cpus: 1,
        pids: 64,
        maxOutputBytes: 1_024,
        tmpfsMb: 16,
      });
      if (result.exitCode !== 0) {
        throw new InfraError(
          `image ${image} can't run a command (exit ${result.exitCode}): ${result.stderr.slice(0, 300)}`,
        );
      }
      cheapest = Math.min(cheapest, result.elapsedMs);
    }
    this.overhead.set(image, cheapest);
    return cheapest;
  }

  async exec(spec: ExecSpec, signal?: AbortSignal): Promise<ExecResult> {
    const overhead = await this.measureOverhead(spec.image);
    const result = await this.once(spec, signal, overhead);
    return { ...result, elapsedMs: Math.max(0, result.elapsedMs - overhead) };
  }

  private once(spec: ExecSpec, signal?: AbortSignal, overheadMs = 0): Promise<ExecResult> {
    const name = `bogey-${this.label}-${process.pid}-${++this.counter}`;
    return new Promise((resolve, reject) => {
      const started = Date.now();
      let timedOut = false;
      let outputExceeded = false;
      let settled = false;
      const kill = () => {
        spawn(this.docker, ["kill", name], { stdio: "ignore" }).on("error", () => {});
      };
      const child = spawn(this.docker, dockerArgs(name, this.label, spec), {
        stdio: ["pipe", "pipe", "pipe"],
      });

      const stopFor = (reason: "time" | "output") => {
        if (reason === "time") timedOut = true;
        else outputExceeded = true;
        kill();
      };
      const timer = setTimeout(() => stopFor("time"), spec.timeMs + overheadMs + 50);
      const onAbort = () => {
        kill();
        finish(() => reject(new Error("aborted")));
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      const out = capture(child.stdout, spec.maxOutputBytes, () => stopFor("output"));
      const err = capture(child.stderr, spec.maxOutputBytes, () => stopFor("output"));

      function finish(done: () => void) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        done();
      }

      child.on("error", (error) => {
        finish(() => reject(new InfraError(`couldn't run ${this.docker}: ${error.message}`)));
      });
      child.on("close", (code) => {
        finish(() => {
          const stderr = err();
          const exitCode = code ?? -1;
          if (exitCode === DOCKER_FAILED && !timedOut && !outputExceeded) {
            reject(
              new InfraError(
                `docker: ${stderr.trim().slice(0, 500) || "failed to start the container"}`,
              ),
            );
            return;
          }
          resolve({
            exitCode,
            stdout: out(),
            stderr,
            elapsedMs: Date.now() - started,
            timedOut,
            outputExceeded,
          });
        });
      });
      child.stdin?.on("error", () => {});
      child.stdin?.end(spec.stdin);
    });
  }

  async cleanup(): Promise<void> {
    await new Promise<void>((resolve) => {
      const list = spawn(
        this.docker,
        ["ps", "-aq", "--filter", `label=bogey-runner=${this.label}`],
        {
          stdio: ["ignore", "pipe", "ignore"],
        },
      );
      let ids = "";
      list.stdout?.on("data", (chunk: Buffer) => (ids += chunk.toString("utf-8")));
      list.on("error", () => resolve());
      list.on("close", () => {
        const found = ids.split(/\s+/).filter(Boolean);
        if (found.length === 0) return resolve();
        spawn(this.docker, ["rm", "-f", ...found], { stdio: "ignore" })
          .on("error", () => resolve())
          .on("close", () => resolve());
      });
    });
  }
}
