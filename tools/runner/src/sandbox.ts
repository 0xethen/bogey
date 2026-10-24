import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
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
  /** largest file the sandbox may write (RLIMIT_FSIZE) */
  fileSizeMb: number;
  /** compilers may run what they build in /tmp; tests and checkers can't */
  execTmp?: boolean;
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

export interface SandboxOptions {
  docker: string;
  label: string;
  /** OCI runtime, e.g. runsc for gVisor; empty for the daemon's default */
  runtime: string;
  nproc: number;
  /** image names the sandbox may run (exact names, or prefixes ending in "*") */
  images: Tuple<string>;
}

export const DOCKER_FAILED = 125;
export const KILLED = 137;
export const SANDBOX_USER = "65534:65534";
// how long a container may take to die after it was killed before the runner gives up on it
export const KILL_GRACE_MS = 5_000;

const IMAGE_NAME = /^[a-z0-9][a-z0-9._/:-]{0,200}(@sha256:[a-f0-9]{64})?$/;
const CONTAINER_PATH = /^\/[A-Za-z0-9_./-]{0,200}$/;
const HOST_PATH = /^\/[A-Za-z0-9_./-]{0,1000}$/;

export function imageAllowed(image: string, allowed: Tuple<string>): boolean {
  if (!IMAGE_NAME.test(image)) return false;
  return allowed.some((rule) =>
    rule.endsWith("*") ? image.startsWith(rule.slice(0, -1)) : image === rule,
  );
}

function checkPath(path: string, pattern: RegExp, what: string): string {
  if (!pattern.test(path) || path.split("/").includes("..")) {
    throw new InfraError(`${what} "${path}" isn't a plain absolute path`);
  }
  return path;
}

export function dockerArgs(
  name: string,
  options: Omit<SandboxOptions, "docker">,
  spec: ExecSpec,
): string[] {
  if (!imageAllowed(spec.image, options.images)) {
    throw new InfraError(
      `image "${spec.image}" isn't one this runner may use (BOGEY_RUNNER_IMAGES)`,
    );
  }
  const tmp = [
    "rw",
    "nosuid",
    "nodev",
    ...(spec.execTmp ? ["exec"] : ["noexec"]),
    `size=${spec.tmpfsMb}m`,
  ];
  const fsize = spec.fileSizeMb * 1024 * 1024;
  return [
    "run",
    "--rm",
    "-i",
    "--name",
    name,
    "--label",
    `bogey-runner=${options.label}`,
    "--pull",
    "never",
    ...(options.runtime ? ["--runtime", options.runtime] : []),
    "--network",
    "none",
    "--ipc",
    "private",
    "--cgroupns",
    "private",
    "--hostname",
    "sandbox",
    "--log-driver",
    "none",
    "--no-healthcheck",
    "--read-only",
    "--tmpfs",
    `/tmp:${tmp.join(",")}`,
    "--memory",
    `${spec.memoryMb}m`,
    "--memory-swap",
    `${spec.memoryMb}m`,
    "--oom-score-adj",
    "1000",
    "--cpus",
    String(spec.cpus),
    "--pids-limit",
    String(spec.pids),
    "--ulimit",
    "nofile=1024:1024",
    "--ulimit",
    `nproc=${options.nproc}:${options.nproc}`,
    "--ulimit",
    `fsize=${fsize}:${fsize}`,
    "--ulimit",
    "core=0:0",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--user",
    SANDBOX_USER,
    "-e",
    "HOME=/tmp",
    "-w",
    checkPath(spec.cwd, CONTAINER_PATH, "working directory"),
    ...spec.mounts.flatMap((mount) => [
      "--mount",
      [
        "type=bind",
        `src=${checkPath(mount.host, HOST_PATH, "mount")}`,
        `dst=${checkPath(mount.container, CONTAINER_PATH, "mount point")}`,
        ...(mount.writable ? [] : ["readonly"]),
        "bind-propagation=rprivate",
      ].join(","),
    ]),
    "--entrypoint",
    "/bin/sh",
    spec.image,
    "-c",
    spec.command,
  ];
}

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

export class DockerSandbox implements Sandbox {
  private counter = 0;
  // two runners with one id (a self-test beside the runner) both run as pid 1, so not the pid
  private readonly instance = randomBytes(4).toString("hex");
  private overhead = new Map<string, number>();
  private readonly options: SandboxOptions;

  constructor(options: SandboxOptions) {
    this.options = options;
  }

  private docker(args: string[]): ChildProcess {
    return spawn(this.options.docker, args, { stdio: "ignore" }).on("error", () => {});
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
        fileSizeMb: 1,
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
    const name = `bogey-${this.options.label}-${this.instance}-${++this.counter}`;
    const args = dockerArgs(name, this.options, spec);
    return new Promise((resolve, reject) => {
      const started = Date.now();
      let timedOut = false;
      let outputExceeded = false;
      let settled = false;
      let forced: NodeJS.Timeout | undefined;
      const child = spawn(this.options.docker, args, { stdio: ["pipe", "pipe", "pipe"] });

      // kills the whole container; if it doesn't go, the CLI is killed and the container removed
      const kill = () => {
        if (forced) return;
        this.docker(["kill", name]);
        forced = setTimeout(() => {
          child.kill("SIGKILL");
          this.docker(["rm", "-f", name]);
        }, KILL_GRACE_MS);
      };
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
        finish(() =>
          reject(new InfraError(`couldn't run ${this.options.docker}: ${error.message}`)),
        );
      });
      child.on("close", (code) => {
        if (forced) clearTimeout(forced);
        finish(() => {
          const stderr = err();
          const exitCode = code ?? KILLED;
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

  /** Removes containers an earlier run with the same label left behind. */
  async cleanup(): Promise<void> {
    await new Promise<void>((resolve) => {
      const list = spawn(
        this.options.docker,
        ["ps", "-aq", "--filter", `label=bogey-runner=${this.options.label}`],
        { stdio: ["ignore", "pipe", "ignore"] },
      );
      let ids = "";
      list.stdout?.on("data", (chunk: Buffer) => (ids += chunk.toString("utf-8")));
      list.on("error", () => resolve());
      list.on("close", () => {
        const found = ids.split(/\s+/).filter((id) => /^[a-f0-9]{12,64}$/.test(id));
        if (found.length === 0) return resolve();
        spawn(this.options.docker, ["rm", "-f", ...found], { stdio: "ignore" })
          .on("error", () => resolve())
          .on("close", () => resolve());
      });
    });
  }
}
