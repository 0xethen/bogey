import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vite-plus/test";
import { checkCreate, ownsContainer, route, type Policy } from "../src/docker-policy.ts";

// what Docker 27's CLI sent for a test run built by dockerArgs, captured through the proxy
const captured: Record<string, unknown> = JSON.parse(
  readFileSync(new URL("./fixtures/docker-create.json", import.meta.url), "utf-8"),
);

const policy: Policy = {
  workDir: "/var/lib/bogey-runner/runner",
  images: ["bogey-runner-*"],
  runtime: "",
  label: "runner",
  maxMemoryMb: 2048,
  maxPids: 512,
  maxCpus: 2,
};

type Body = Record<string, unknown> & { HostConfig: Record<string, unknown> };
function body(change: (draft: Body) => void = () => {}): Body {
  const draft = structuredClone(captured) as Body;
  change(draft);
  return draft;
}

test("what the runner sends is allowed", () => {
  assert.deepEqual(checkCreate(body(), policy), []);
});

const refusals: [string, (draft: Body) => void, RegExp][] = [
  ["privileged", (d) => (d.HostConfig.Privileged = true), /Privileged/],
  ["a capability", (d) => (d.HostConfig.CapAdd = ["SYS_ADMIN"]), /CapAdd/],
  ["capabilities kept", (d) => (d.HostConfig.CapDrop = []), /capability/],
  ["the host network", (d) => (d.HostConfig.NetworkMode = "host"), /network/],
  [
    "a network attached by name",
    (d) => (d.NetworkingConfig = { EndpointsConfig: { host: {}, none: {} } }),
    /no network/,
  ],
  ["the host's processes", (d) => (d.HostConfig.PidMode = "host"), /PidMode/],
  ["the host's user namespace", (d) => (d.HostConfig.UsernsMode = "host"), /UsernsMode/],
  ["the host's IPC", (d) => (d.HostConfig.IpcMode = "host"), /IPC/],
  ["a writable root", (d) => (d.HostConfig.ReadonlyRootfs = false), /read-only/],
  ["root", (d) => (d.User = "0:0"), /user/],
  ["no user", (d) => delete d.User, /user/],
  ["another image", (d) => (d.Image = "alpine:3"), /image/],
  [
    "seccomp off",
    (d) => (d.HostConfig.SecurityOpt = ["no-new-privileges", "seccomp=unconfined"]),
    /seccomp/,
  ],
  ["new privileges", (d) => (d.HostConfig.SecurityOpt = []), /no-new-privileges/],
  ["unmasked /proc", (d) => (d.HostConfig.MaskedPaths = []), /masked/],
  ["a device", (d) => (d.HostConfig.Devices = [{ PathOnHost: "/dev/sda" }]), /Devices/],
  ["a GPU", (d) => (d.HostConfig.DeviceRequests = [{ Count: -1 }]), /DeviceRequests/],
  ["a -v bind", (d) => (d.HostConfig.Binds = ["/:/host"]), /Binds/],
  ["a sysctl", (d) => (d.HostConfig.Sysctls = { "kernel.x": "1" }), /Sysctls/],
  ["no memory limit", (d) => (d.HostConfig.Memory = 0), /memory/],
  ["too much memory", (d) => (d.HostConfig.Memory = 64 * 1024 ** 3), /memory/],
  ["swap", (d) => (d.HostConfig.MemorySwap = -1), /swap/],
  ["no process limit", (d) => (d.HostConfig.PidsLimit = 0), /process/],
  ["no CPU limit", (d) => (d.HostConfig.NanoCpus = 0), /CPU/],
  ["logging on", (d) => (d.HostConfig.LogConfig = { Type: "json-file" }), /logging/],
  ["a runtime", (d) => (d.HostConfig.Runtime = "runc"), /runtime/],
  ["no ulimits", (d) => (d.HostConfig.Ulimits = []), /ulimit/],
  ["the OOM killer spared", (d) => (d.HostConfig.OomScoreAdj = -1000), /OOM/],
  ["a restart policy", (d) => (d.HostConfig.RestartPolicy = { Name: "always" }), /restart/],
  ["another environment", (d) => (d.Env = ["HOME=/tmp", "LD_PRELOAD=/x"]), /HOME/],
  ["no label", (d) => (d.Labels = {}), /label/],
  ["another runner's label", (d) => (d.Labels = { "bogey-runner": "other" }), /label/],
  ["a volume", (d) => (d.Volumes = { "/data": {} }), /Volumes/],
  ["a tmpfs elsewhere", (d) => (d.HostConfig.Tmpfs = { "/etc": "rw" }), /tmpfs/],
  ["a suid /tmp", (d) => (d.HostConfig.Tmpfs = { "/tmp": "rw,size=1m" }), /nosuid/],
  ["an extra group", (d) => (d.HostConfig.GroupAdd = ["999"]), /GroupAdd/],
  ["another container's volumes", (d) => (d.HostConfig.VolumesFrom = ["db"]), /VolumesFrom/],
  ["a published port", (d) => (d.HostConfig.PortBindings = { "22/tcp": [{}] }), /PortBindings/],
  ["a cgroup parent", (d) => (d.HostConfig.CgroupParent = "/"), /CgroupParent/],
];

test("each way out of the sandbox is refused", () => {
  for (const [name, change, problem] of refusals) {
    const problems = checkCreate(body(change), policy);
    assert.ok(
      problems.some((text) => problem.test(text)),
      `${name}: ${problems.join("; ") || "allowed"}`,
    );
  }
});

function mounted(source: string, target = "/work", extra: Record<string, unknown> = {}) {
  return body((d) => {
    d.HostConfig.Mounts = [{ Type: "bind", Source: source, Target: target, ...extra }];
  });
}

test("mounts come only from the runner's own work folder", () => {
  assert.deepEqual(checkCreate(mounted("/var/lib/bogey-runner/runner/j-1"), policy), []);
  for (const source of [
    "/",
    "/etc",
    "/var/run/docker.sock",
    "/var/lib/bogey-runner/runner",
    "/var/lib/bogey-runner/runner/../other",
    "/var/lib/bogey-runner/runner2/j-1",
    "relative",
  ]) {
    assert.notDeepEqual(checkCreate(mounted(source), policy), [], source);
  }
  assert.notDeepEqual(
    checkCreate(mounted("/var/lib/bogey-runner/runner/j-1", "/"), policy),
    [],
    "not over the root",
  );
  assert.notDeepEqual(
    checkCreate(mounted("/var/lib/bogey-runner/runner/j-1", "/work", { Type: "volume" }), policy),
    [],
  );
  assert.notDeepEqual(
    checkCreate(
      mounted("/var/lib/bogey-runner/runner/j-1", "/work", {
        BindOptions: { Propagation: "rshared" },
      }),
      policy,
    ),
    [],
  );
});

test("with gVisor required, every container must use it", () => {
  const gvisor = { ...policy, runtime: "runsc" };
  assert.match(checkCreate(body(), gvisor).join(), /runsc/);
  assert.deepEqual(
    checkCreate(
      body((d) => (d.HostConfig.Runtime = "runsc")),
      gvisor,
    ),
    [],
  );
});

test("only the calls the runner makes are routed", () => {
  const ok = (method: string, url: string) => route(method, url, policy).ok;
  assert.ok(ok("HEAD", "/_ping"));
  assert.ok(ok("GET", "/v1.47/version"));
  assert.ok(ok("POST", "/v1.47/containers/create?name=bogey-runner-1-2"));
  assert.ok(ok("POST", "/v1.47/containers/abc123/attach?stream=1&stdin=1"));
  assert.ok(ok("POST", "/v1.47/containers/abc123/start"));
  assert.ok(ok("POST", "/v1.47/containers/abc123/wait?condition=removed"));
  assert.ok(ok("POST", "/v1.47/containers/bogey-runner-1-2/kill"));
  assert.ok(ok("DELETE", "/v1.47/containers/abc123?force=1"));
  assert.ok(
    ok(
      "GET",
      `/v1.47/containers/json?all=1&filters=${encodeURIComponent('{"label":{"bogey-runner=runner":true}}')}`,
    ),
  );

  for (const [method, url] of [
    ["POST", "/v1.47/containers/create"],
    ["POST", "/v1.47/containers/create?name=web"],
    ["GET", "/v1.47/containers/json?all=1"],
    [
      "GET",
      `/v1.47/containers/json?filters=${encodeURIComponent('{"label":{"bogey-runner=other":true}}')}`,
    ],
    ["POST", "/v1.47/containers/abc/exec"],
    ["GET", "/v1.47/containers/abc/json"],
    ["GET", "/v1.47/containers/abc/archive?path=/"],
    ["PUT", "/v1.47/containers/abc/archive?path=/"],
    ["POST", "/v1.47/containers/abc/update"],
    ["POST", "/v1.47/containers/prune"],
    ["POST", "/v1.47/images/create?fromImage=alpine"],
    ["POST", "/v1.47/build"],
    ["GET", "/v1.47/info"],
    ["POST", "/v1.47/networks/create"],
    ["POST", "/v1.47/volumes/create"],
    ["POST", "/v1.47/swarm/init"],
    ["POST", "/v1.47/plugins/pull"],
    ["POST", "/v1.47/containers/abc/../../build"],
    ["POST", "/v1.47/containers/%2e%2e/start"],
    ["POST", "//containers/abc/start"],
    ["GET", "/v1.47/containers/abc/start"],
  ]) {
    assert.ok(!ok(method ?? "", url ?? ""), `${method} ${url}`);
  }
});

test("passed-on queries keep only the parameters each call needs", () => {
  const decision = route("DELETE", "/v1.47/containers/abc?force=1&link=1", policy);
  assert.ok(decision.ok);
  assert.equal(
    decision.ok && "path" in decision.route ? decision.route.path : "",
    "/v1.47/containers/abc?force=1",
  );
});

test("a container is the runner's only by its label", () => {
  assert.ok(ownsContainer({ Config: { Labels: { "bogey-runner": "runner" } } }, policy));
  assert.ok(!ownsContainer({ Config: { Labels: { "bogey-runner": "other" } } }, policy));
  assert.ok(!ownsContainer({ Config: { Labels: {} } }, policy));
  assert.ok(!ownsContainer({ Config: { Labels: null } }, policy));
  assert.ok(!ownsContainer(null, policy));
});
