import { isInside } from "./paths.ts";
import { imageAllowed, SANDBOX_USER } from "./sandbox.ts";

/**
 * What the Docker socket proxy lets through: the handful of calls `docker run`, `kill`, `rm` and
 * `ps` make, and container creation only in the shape `dockerArgs` builds. See
 * docs/self-hosting/runner-security.md.
 */
export interface Policy {
  /** host folder every bind mount must sit in */
  workDir: string;
  images: Tuple<string>;
  /** the OCI runtime every container must use; empty for the daemon's default */
  runtime: string;
  /** the runner's label value; empty accepts any runner's label */
  label: string;
  maxMemoryMb: number;
  maxPids: number;
  maxCpus: number;
}

export type Route =
  | { kind: "ping" | "version"; path: string }
  | { kind: "create"; path: string }
  | { kind: "list"; path: string }
  | { kind: "container"; id: string; path: string; upgrade: boolean };

export type Decision = { ok: true; route: Route } | { ok: false; reason: string };

const VERSION = String.raw`(?:/v\d{1,2}\.\d{1,3})?`;
const ID = String.raw`([A-Za-z0-9][A-Za-z0-9_.-]{0,127})`;
const CONTAINER_NAME = /^bogey-[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const MOUNT_TARGET = /^\/[a-z]{1,16}$/;
const LABEL = "bogey-runner";

// for each container action: the method, and the query parameters passed on
const ACTIONS: Record<string, { method: string; params: Tuple<string>; upgrade?: boolean }> = {
  attach: {
    method: "POST",
    params: ["stream", "stdin", "stdout", "stderr", "logs", "detachKeys"],
    upgrade: true,
  },
  start: { method: "POST", params: [] },
  wait: { method: "POST", params: ["condition"] },
  kill: { method: "POST", params: ["signal"] },
  "": { method: "DELETE", params: ["force", "v"] },
};

function query(url: URL, params: Tuple<string>): string {
  const kept = new URLSearchParams();
  for (const param of params) {
    const value = url.searchParams.get(param);
    if (value !== null) kept.set(param, value);
  }
  const text = kept.toString();
  return text ? `?${text}` : "";
}

/** Decides a request by its method and URL alone; a create also needs `checkCreate`. */
export function route(method: string, rawUrl: string, policy: Pick<Policy, "label">): Decision {
  const rawPath = rawUrl.split("?")[0] ?? "";
  if (/%|\\|\/\/|\/\.\.?(\/|$)/.test(rawPath)) return { ok: false, reason: "unusual path" };
  const url = new URL(rawUrl, "http://docker");
  const path = url.pathname;
  const version = new RegExp(`^${VERSION}`).exec(path)?.[0] ?? "";
  const rest = path.slice(version.length);

  if (rest === "/_ping" && (method === "GET" || method === "HEAD")) {
    return { ok: true, route: { kind: "ping", path: `${version}/_ping` } };
  }
  if (rest === "/version" && method === "GET") {
    return { ok: true, route: { kind: "version", path: `${version}/version` } };
  }

  if (rest === "/containers/create" && method === "POST") {
    const name = url.searchParams.get("name");
    if (!name || !CONTAINER_NAME.test(name)) {
      return { ok: false, reason: "a container must be named bogey-..." };
    }
    return {
      ok: true,
      route: { kind: "create", path: `${version}/containers/create${query(url, ["name"])}` },
    };
  }

  if (rest === "/containers/json" && method === "GET") {
    const problem = listFilterProblem(url.searchParams.get("filters"), policy.label);
    if (problem) return { ok: false, reason: problem };
    return {
      ok: true,
      route: { kind: "list", path: `${version}/containers/json${query(url, ["all", "filters"])}` },
    };
  }

  const match = new RegExp(`^/containers/${ID}(?:/([a-z]+))?$`).exec(rest);
  if (match) {
    const [, id = "", action = ""] = match;
    const allowed = ACTIONS[action];
    if (allowed && allowed.method === method) {
      const suffix = action ? `/${action}` : "";
      return {
        ok: true,
        route: {
          kind: "container",
          id,
          path: `${version}/containers/${id}${suffix}${query(url, allowed.params)}`,
          upgrade: allowed.upgrade === true,
        },
      };
    }
  }
  return { ok: false, reason: `${method} ${rest} isn't a call the runner makes` };
}

function listFilterProblem(raw: string | null, label: string): string | null {
  let filters: unknown;
  try {
    filters = raw ? JSON.parse(raw) : null;
  } catch {
    return "unreadable filters";
  }
  const labels =
    filters && typeof filters === "object" && "label" in filters
      ? (filters as { label: unknown }).label
      : null;
  const keys = labels && typeof labels === "object" ? Object.keys(labels) : [];
  const ok =
    keys.length > 0 &&
    keys.every((key) => (label ? key === `${LABEL}=${label}` : key.startsWith(`${LABEL}=`)));
  return ok ? null : "a list must filter on the runner's label";
}

/** Whether an existing container is one the runner made (from GET /containers/{id}/json). */
export function ownsContainer(inspect: unknown, policy: Pick<Policy, "label">): boolean {
  const labels = (inspect as { Config?: { Labels?: Record<string, string> | null } } | null)?.Config
    ?.Labels;
  const value = labels?.[LABEL];
  if (typeof value !== "string") return false;
  return policy.label ? value === policy.label : value.length > 0;
}

type Obj = Record<string, unknown>;

// an object's keys mean something ({"host": {}} attaches the host network), so only {} is empty
function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === 0 || value === "")
    return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as Obj).length === 0;
  return false;
}

// HostConfig keys checked below; every other key must be empty
const HOST_CHECKED = new Set([
  "NetworkMode",
  "ReadonlyRootfs",
  "CapDrop",
  "SecurityOpt",
  "Mounts",
  "Tmpfs",
  "Memory",
  "MemorySwap",
  "NanoCpus",
  "PidsLimit",
  "Ulimits",
  "LogConfig",
  "Runtime",
  "IpcMode",
  "CgroupnsMode",
  "AutoRemove",
  "OomScoreAdj",
  "RestartPolicy",
  "ConsoleSize",
  "MaskedPaths",
  "ReadonlyPaths",
]);
// the CLI's way of saying "the daemon's default"
const HOST_DEFAULTS: Record<string, unknown> = { MemorySwappiness: -1 };
// Config keys checked below; every other key must be empty
const CONFIG_CHECKED = new Set([
  "Image",
  "User",
  "Labels",
  "Env",
  "Cmd",
  "Entrypoint",
  "WorkingDir",
  "Hostname",
  "Healthcheck",
  "HostConfig",
  "NetworkingConfig",
  "AttachStdin",
  "AttachStdout",
  "AttachStderr",
  "OpenStdin",
  "StdinOnce",
]);

function securityOptProblem(opts: unknown): string | null {
  const list = Array.isArray(opts) ? opts : [];
  if (!list.some((opt) => opt === "no-new-privileges" || opt === "no-new-privileges:true")) {
    return "no-new-privileges is required";
  }
  const other = list.find((opt) => opt !== "no-new-privileges" && opt !== "no-new-privileges:true");
  return other === undefined ? null : `security option "${String(other)}" isn't allowed`;
}

function mountProblems(mounts: unknown, workDir: string): string[] {
  if (!Array.isArray(mounts)) return [];
  const problems: string[] = [];
  for (const raw of mounts) {
    const mount = (raw ?? {}) as Obj;
    const source = typeof mount.Source === "string" ? mount.Source : "";
    const target = typeof mount.Target === "string" ? mount.Target : "";
    if (mount.Type !== "bind") problems.push(`a ${String(mount.Type)} mount isn't allowed`);
    if (!source.startsWith("/") || source.split("/").includes("..") || !isInside(workDir, source)) {
      problems.push(`mount source ${source} is outside ${workDir}`);
    } else if (source.replace(/\/+$/, "") === workDir.replace(/\/+$/, "")) {
      problems.push("the work folder itself can't be mounted");
    }
    if (!MOUNT_TARGET.test(target)) problems.push(`mount target ${target} isn't allowed`);
    const bind = (mount.BindOptions ?? {}) as Obj;
    if (bind.Propagation && bind.Propagation !== "rprivate") {
      problems.push("bind propagation must be rprivate");
    }
    for (const key of Object.keys(bind)) {
      if (key !== "Propagation" && !isEmpty(bind[key])) problems.push(`bind option ${key}`);
    }
    for (const key of ["VolumeOptions", "TmpfsOptions", "ImageOptions", "ClusterOptions"]) {
      if (!isEmpty(mount[key])) problems.push(`mount option ${key}`);
    }
  }
  return problems;
}

function tmpfsProblem(tmpfs: unknown): string | null {
  if (isEmpty(tmpfs)) return null;
  const entries = Object.entries((tmpfs ?? {}) as Obj);
  if (entries.length !== 1 || entries[0]?.[0] !== "/tmp") return "only /tmp may be a tmpfs";
  const options = String(entries[0][1]).split(",");
  if (!options.includes("nosuid") || !options.includes("nodev")) {
    return "/tmp must be nosuid and nodev";
  }
  if (!options.some((option) => /^size=\d+[km]?$/.test(option))) return "/tmp needs a size";
  return null;
}

function ulimitProblem(ulimits: unknown): string | null {
  const list = Array.isArray(ulimits) ? (ulimits as Obj[]) : [];
  const named = new Map(list.map((limit) => [String(limit.Name), limit]));
  for (const name of ["nofile", "nproc", "fsize"]) {
    const limit = named.get(name);
    if (!limit || !(Number(limit.Hard) > 0) || Number(limit.Soft) > Number(limit.Hard)) {
      return `ulimit ${name} must be set`;
    }
  }
  return null;
}

/** Problems with a container create body; empty means it may be created. */
export function checkCreate(body: unknown, policy: Policy): string[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return ["the body isn't an object"];
  const config = body as Obj;
  const host = (config.HostConfig ?? {}) as Obj;
  const problems: string[] = [];
  const need = (ok: boolean, problem: string) => {
    if (!ok) problems.push(problem);
  };

  for (const [key, value] of Object.entries(config)) {
    if (!CONFIG_CHECKED.has(key) && !isEmpty(value)) problems.push(`${key} isn't allowed`);
  }
  for (const [key, value] of Object.entries(host)) {
    if (HOST_CHECKED.has(key) || isEmpty(value) || HOST_DEFAULTS[key] === value) continue;
    problems.push(`HostConfig.${key} isn't allowed`);
  }

  const image = typeof config.Image === "string" ? config.Image : "";
  need(imageAllowed(image, policy.images), `image "${image}" isn't allowed`);
  need(config.User === SANDBOX_USER, `the user must be ${SANDBOX_USER}`);
  const labels = (config.Labels ?? {}) as Obj;
  need(
    typeof labels[LABEL] === "string" &&
      (policy.label ? labels[LABEL] === policy.label : labels[LABEL] !== ""),
    "the runner's label is missing",
  );
  const env = Array.isArray(config.Env) ? config.Env : [];
  need(
    env.every((entry) => typeof entry === "string" && /^HOME=\/tmp$/.test(entry)),
    "only HOME may be set",
  );
  const endpoints = ((config.NetworkingConfig ?? {}) as Obj).EndpointsConfig;
  need(
    isEmpty(endpoints) || Object.keys(endpoints as Obj).every((name) => name === "none"),
    "no network may be attached",
  );

  // an empty list (not null) unmasks /proc and /sys paths, as systempaths=unconfined does
  need(
    host.MaskedPaths == null && host.ReadonlyPaths == null,
    "the default masked paths must stay",
  );
  need(host.NetworkMode === "none", "the network must be none");
  need(host.ReadonlyRootfs === true, "the root filesystem must be read-only");
  const capDrop = Array.isArray(host.CapDrop) ? host.CapDrop.map(String) : [];
  need(
    capDrop.some((cap) => cap.toUpperCase() === "ALL"),
    "every capability must be dropped",
  );
  const security = securityOptProblem(host.SecurityOpt);
  if (security) problems.push(security);
  problems.push(...mountProblems(host.Mounts, policy.workDir));
  const tmpfs = tmpfsProblem(host.Tmpfs);
  if (tmpfs) problems.push(tmpfs);
  const memory = Number(host.Memory);
  need(
    memory > 0 && memory <= policy.maxMemoryMb * 1024 * 1024,
    "a memory limit within the host's is required",
  );
  need(Number(host.MemorySwap) === memory, "swap must equal the memory limit");
  const pids = Number(host.PidsLimit);
  need(pids > 0 && pids <= policy.maxPids, "a process limit within the host's is required");
  const cpus = Number(host.NanoCpus);
  need(cpus > 0 && cpus <= policy.maxCpus * 1e9, "a CPU limit within the host's is required");
  const ulimit = ulimitProblem(host.Ulimits);
  if (ulimit) problems.push(ulimit);
  need(((host.LogConfig ?? {}) as Obj).Type === "none", "logging must be off");
  need(
    (host.Runtime ?? "") === policy.runtime,
    policy.runtime ? `the runtime must be ${policy.runtime}` : "the runtime can't be chosen",
  );
  need(["", "private", "none"].includes(String(host.IpcMode ?? "")), "IPC must be private");
  need(
    ["", "private"].includes(String(host.CgroupnsMode ?? "")),
    "the cgroup namespace must be private",
  );
  need(Number(host.OomScoreAdj ?? 0) >= 0, "the OOM score can't be lowered");
  const restart = ((host.RestartPolicy ?? {}) as Obj).Name;
  need(["", "no", undefined].includes(restart as string | undefined), "no restart policy");
  return problems;
}
