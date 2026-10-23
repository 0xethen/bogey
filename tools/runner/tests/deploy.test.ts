// What the deploy files promise about keeping the web app, the database and the runner apart
// (docs/self-hosting/runner-security.md). Plain text checks; the files are small and regular.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "vite-plus/test";

const repo = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, repo), "utf-8");

function services(compose: string): Map<string, string> {
  const body = compose.split(/^services:\n/m)[1]?.split(/^\S/m)[0] ?? "";
  const found = new Map<string, string>();
  for (const block of body.split(/^(?= {2}[a-z][\w-]*:\n)/m)) {
    const name = /^ {2}([a-z][\w-]*):/.exec(block)?.[1];
    if (name) found.set(name, block);
  }
  return found;
}

const runnerCompose = read("deploy/all-in-one/compose.runner.yml");
const mainCompose = read("deploy/all-in-one/compose.yml");
const runnerServices = services(runnerCompose);
const mainServices = services(mainCompose);
const networksOf = (block: string) =>
  /networks: \[([^\]]*)\]/
    .exec(block)?.[1]
    ?.split(",")
    .map((name) => name.trim()) ?? [];

test("the runner holds no service key and no Docker socket, and reaches only its gateway and proxy", () => {
  const runner = runnerServices.get("runner") ?? "";
  assert.ok(runner, "compose.runner.yml has a runner");
  assert.doesNotMatch(runnerCompose, /SERVICE_ROLE|SERVICE_KEY|JWT_SECRET|POSTGRES_PASSWORD/);
  assert.doesNotMatch(runner, /docker\.sock/);
  assert.deepEqual(networksOf(runner), ["runner-api", "runner-docker"]);
  assert.match(runner, /BOGEY_RUNNER_KEY/);
  assert.match(runner, /SUPABASE_URL: http:\/\/runner-gateway:8000/);
  assert.match(runner, /DOCKER_HOST: tcp:\/\/docker-proxy:2375/);
  assert.match(runner, /read_only: true/);
  assert.match(runner, /cap_drop: \[ALL\]/);
  assert.match(runner, /no-new-privileges:true/);
});

test("only docker-proxy has the Docker socket, on a network only the runner shares", () => {
  const withSocket = [...runnerServices, ...mainServices]
    .filter(([, block]) => /docker\.sock/.test(block))
    .map(([name]) => name);
  assert.deepEqual(withSocket, ["docker-proxy"]);
  const proxy = runnerServices.get("docker-proxy") ?? "";
  assert.deepEqual(networksOf(proxy), ["runner-docker"]);
  assert.match(proxy, /src\/proxy\.ts/);
  assert.match(proxy, /:ro\n/, "it reads the work folder, never writes it");
  assert.match(runnerCompose, /runner-api:\n {4}internal: true/);
  assert.match(runnerCompose, /runner-docker:\n {4}internal: true/);
});

test("the gateway passes on only the runner's functions, with no other role", () => {
  const gateway = runnerServices.get("runner-gateway") ?? "";
  assert.match(gateway, /image: caddy:2@sha256:[a-f0-9]{64}/);
  assert.deepEqual(networksOf(gateway), ["runner-api", "backend"]);
  const caddyfile = read("deploy/all-in-one/Caddyfile.runner");
  assert.match(caddyfile, /path_regexp \^\/rest\/v1\/rpc\/challenges_runner_\(/);
  assert.match(caddyfile, /request_header -Authorization/);
  assert.match(caddyfile, /request_header -Apikey/);
  assert.match(caddyfile, /handle \{\n\t\trespond 403/);
  assert.doesNotMatch(caddyfile, /kong|auth:9999|storage:5000/);
});

test("no runner service shares a volume with the web app", () => {
  const web = mainServices.get("web") ?? "";
  const mounts = (block: string) =>
    [...block.matchAll(/^ {6}- ([^:\n]+):/gm)].map((match) => match[1] ?? "");
  const webMounts = mounts(web);
  for (const [name, block] of runnerServices) {
    for (const mount of mounts(block)) {
      assert.ok(!webMounts.includes(mount), `${name} and web both mount ${mount}`);
    }
  }
});

test("Caddy reaches only the gateway and the app; the database is on the backend only", () => {
  assert.deepEqual(networksOf(mainServices.get("db") ?? ""), ["backend"]);
  assert.deepEqual(networksOf(mainServices.get("kong") ?? ""), ["backend", "edge"]);
  const caddy = mainServices.get("caddy") ?? "";
  assert.match(caddy, /networks:\n {6}edge:/);
  assert.doesNotMatch(caddy, /backend/);
});

test("the web image carries nothing of the runner", () => {
  const dockerfile = read("Dockerfile");
  const final = dockerfile.split(/^FROM /m).at(-1) ?? "";
  assert.doesNotMatch(final, /tools\/runner|docker-cli|docker\.sock|\/usr\/local\/bin\/docker/);
});

test("the runner's images start from bases pinned by digest", () => {
  const files = [
    "tools/runner/Dockerfile",
    ...readdirSync(new URL("tools/runner/images/", repo), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `tools/runner/images/${entry.name}/Dockerfile`),
  ];
  for (const file of files) {
    for (const line of read(file).match(/^FROM .*/gm) ?? []) {
      assert.match(line, /@sha256:[a-f0-9]{64}/, `${file}: ${line}`);
    }
  }
});
