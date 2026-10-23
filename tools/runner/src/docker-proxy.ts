// The Docker socket proxy: holds the host's socket so the runner doesn't, and passes on only the
// calls the runner makes (docs/self-hosting/runner-security.md). Started by src/proxy.ts.
import { lstat, realpath } from "node:fs/promises";
import { createServer, request, type IncomingMessage, type ServerResponse } from "node:http";
import { connect, type Socket } from "node:net";
import { checkCreate, ownsContainer, route, type Policy } from "./docker-policy.ts";

const MAX_BODY = 256 * 1024;

export interface ProxyOptions {
  socket: string;
  policy: Policy;
  log: (message: string) => void;
  /** also log every call let through, not only refusals */
  verbose?: boolean;
}

function upstream(
  socket: string,
  method: string,
  path: string,
  headers: IncomingMessage["headers"],
  body?: Buffer,
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const outgoing = { ...headers, host: "docker" };
    delete outgoing.connection;
    delete outgoing["transfer-encoding"];
    if (body) outgoing["content-length"] = String(body.length);
    const req = request({ socketPath: socket, method, path, headers: outgoing }, resolve);
    req.on("error", reject);
    req.end(body);
  });
}

async function readBody(req: IncomingMessage): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function owned(options: ProxyOptions, id: string): Promise<boolean> {
  const response = await upstream(options.socket, "GET", `/containers/${id}/json`, {});
  const text = await readBody(response);
  if (response.statusCode !== 200 || !text) return false;
  try {
    return ownsContainer(JSON.parse(text.toString("utf-8")), options.policy);
  } catch {
    return false;
  }
}

/** Every bind source must already be a real folder, with no link anywhere in its path. */
async function mountsReal(body: unknown): Promise<string | null> {
  const mounts = ((body as { HostConfig?: { Mounts?: unknown } }).HostConfig?.Mounts ?? []) as {
    Source?: string;
  }[];
  for (const mount of Array.isArray(mounts) ? mounts : []) {
    const source = String(mount.Source ?? "");
    try {
      const info = await lstat(source);
      if (!info.isDirectory() || (await realpath(source)) !== source.replace(/\/+$/, "")) {
        return `mount source ${source} isn't a plain folder`;
      }
    } catch {
      return `mount source ${source} doesn't exist`;
    }
  }
  return null;
}

function deny(res: ServerResponse, status: number, reason: string) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ message: `bogey docker proxy: ${reason}` }));
}

async function handle(options: ProxyOptions, req: IncomingMessage, res: ServerResponse) {
  const method = req.method ?? "GET";
  const decision = route(method, req.url ?? "/", options.policy);
  if (!decision.ok) {
    options.log(`denied ${method} ${req.url}: ${decision.reason}`);
    req.resume();
    return deny(res, 403, decision.reason);
  }
  const { route: r } = decision;
  let body: Buffer | undefined;
  let path = req.url ?? "/";
  if (r.kind === "create") {
    const raw = await readBody(req);
    if (!raw) return deny(res, 413, "the request is too large");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString("utf-8"));
    } catch {
      return deny(res, 400, "the body isn't JSON");
    }
    const problems = checkCreate(parsed, options.policy);
    const unreal = problems.length ? null : await mountsReal(parsed);
    if (unreal) problems.push(unreal);
    if (problems.length) {
      options.log(`denied a container: ${problems.join("; ")}`);
      return deny(res, 403, problems.join("; "));
    }
    body = raw;
    path = r.path;
  } else {
    req.resume();
    if (r.kind === "container") {
      if (!(await owned(options, r.id))) {
        options.log(`denied ${method} ${req.url}: not a runner's container`);
        return deny(res, 404, "no such container");
      }
      path = r.path;
    } else {
      path = r.path;
    }
  }
  if (options.verbose) options.log(`${method} ${path}`);
  const answer = await upstream(options.socket, method, path, req.headers, body);
  res.writeHead(answer.statusCode ?? 502, answer.headers);
  // `docker run` waits for the headers of /wait before it starts the container
  res.flushHeaders();
  answer.pipe(res);
}

// `docker run -i` attaches over a hijacked connection: check it, then pass bytes both ways
async function handleUpgrade(
  options: ProxyOptions,
  req: IncomingMessage,
  client: Socket,
  head: Buffer,
) {
  const method = req.method ?? "GET";
  const decision = route(method, req.url ?? "/", options.policy);
  const r = decision.ok ? decision.route : null;
  if (!r || r.kind !== "container" || !r.upgrade || !(await owned(options, r.id))) {
    options.log(`denied upgrade ${method} ${req.url}`);
    client.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    return;
  }
  if (options.verbose) options.log(`${method} ${r.path} (attached)`);
  const docker = connect(options.socket);
  const lines = [
    `${method} ${r.path} HTTP/1.1`,
    "Host: docker",
    "Connection: Upgrade",
    "Upgrade: tcp",
  ];
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const name = req.rawHeaders[i] ?? "";
    if (!/^(host|connection|upgrade)$/i.test(name)) lines.push(`${name}: ${req.rawHeaders[i + 1]}`);
  }
  docker.on("connect", () => {
    docker.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head.length) docker.write(head);
    docker.pipe(client);
    client.pipe(docker);
  });
  const close = () => {
    docker.destroy();
    client.destroy();
  };
  docker.on("error", close);
  client.on("error", close);
  docker.on("close", () => client.end());
  client.on("close", () => docker.end());
}

export function createProxy(options: ProxyOptions) {
  const server = createServer((req, res) => {
    handle(options, req, res).catch((error: unknown) => {
      options.log(`error: ${String(error)}`);
      if (!res.headersSent) deny(res, 502, "docker didn't answer");
      else res.destroy();
    });
  });
  server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
    handleUpgrade(options, req, socket, head).catch((error: unknown) => {
      options.log(`error: ${String(error)}`);
      socket.destroy();
    });
  });
  return server;
}
