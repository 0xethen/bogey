import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { dockerArgs, imageAllowed, type ExecSpec } from "../src/sandbox.ts";

const spec: ExecSpec = {
  image: "bogey-runner-python:3.13",
  command: "./main",
  cwd: "/work",
  mounts: [{ host: "/var/lib/bogey-runner/r/j-1", container: "/work", writable: false }],
  stdin: "",
  timeMs: 1000,
  memoryMb: 64,
  cpus: 0.5,
  pids: 32,
  maxOutputBytes: 100,
  tmpfsMb: 16,
  fileSizeMb: 2,
};
const options = { label: "lab", runtime: "", nproc: 512, images: ["bogey-runner-*"] };

const args = (extra: Partial<ExecSpec> = {}, opts: Partial<typeof options> = {}) =>
  dockerArgs("n", { ...options, ...opts }, { ...spec, ...extra });
const values = (list: string[], flag: string) =>
  list.flatMap((arg, index) => (arg === flag ? [list[index + 1]] : []));
const pair = (list: string[], flag: string) => values(list, flag)[0];

test("a container has no network, a read-only root, no capabilities and an unprivileged user", () => {
  const list = args();
  assert.equal(pair(list, "--network"), "none");
  assert.ok(list.includes("--read-only"));
  assert.equal(pair(list, "--cap-drop"), "ALL");
  assert.deepEqual(values(list, "--security-opt"), ["no-new-privileges"], "seccomp stays default");
  assert.equal(pair(list, "--user"), "65534:65534");
  assert.equal(pair(list, "--memory"), "64m");
  assert.equal(pair(list, "--memory-swap"), "64m", "no swap to hide a memory limit behind");
  assert.equal(pair(list, "--pids-limit"), "32");
  assert.equal(pair(list, "--pull"), "never", "an image is never fetched at judge time");
  assert.equal(pair(list, "--log-driver"), "none", "output never lands in the daemon's logs");
  assert.equal(pair(list, "--ipc"), "private");
  assert.equal(pair(list, "--label"), "bogey-runner=lab");
  assert.ok(!list.includes("--privileged"));
  assert.deepEqual(list.slice(-3), ["bogey-runner-python:3.13", "-c", "./main"]);
  assert.equal(pair(list, "--entrypoint"), "/bin/sh", "the image's entrypoint is never used");
});

test("files, processes, open files and core dumps are capped", () => {
  const list = values(args(), "--ulimit");
  assert.ok(list.includes(`fsize=${2 * 1024 * 1024}:${2 * 1024 * 1024}`));
  assert.ok(list.includes("nproc=512:512"));
  assert.ok(list.includes("nofile=1024:1024"));
  assert.ok(list.includes("core=0:0"));
});

test("/tmp is small, nosuid and nodev, and noexec except when compiling", () => {
  assert.equal(pair(args(), "--tmpfs"), "/tmp:rw,nosuid,nodev,noexec,size=16m");
  assert.equal(pair(args({ execTmp: true }), "--tmpfs"), "/tmp:rw,nosuid,nodev,exec,size=16m");
});

test("mounts are explicit binds, read-only unless asked, with private propagation", () => {
  const list = args({
    mounts: [
      { host: "/w/r/j-1", container: "/work", writable: false },
      { host: "/w/r/o-1", container: "/io", writable: true },
    ],
  });
  assert.deepEqual(values(list, "--mount"), [
    "type=bind,src=/w/r/j-1,dst=/work,readonly,bind-propagation=rprivate",
    "type=bind,src=/w/r/o-1,dst=/io,bind-propagation=rprivate",
  ]);
  assert.ok(!list.includes("-v"));
});

test("a mount path that could smuggle options or escape is refused", () => {
  for (const host of ["/w/a,dst=/etc", "/w/../etc", "relative", "/w/a b"]) {
    assert.throws(
      () => args({ mounts: [{ host, container: "/work", writable: false }] }),
      /plain absolute path/,
      host,
    );
  }
  assert.throws(() => args({ cwd: "/work/../.." }), /plain absolute path/);
});

test("only allowed images run", () => {
  assert.throws(() => args({ image: "alpine:3" }), /BOGEY_RUNNER_IMAGES/);
  assert.throws(() => args({ image: "bogey-runner-x --privileged" }), /BOGEY_RUNNER_IMAGES/);
  assert.ok(imageAllowed("bogey-runner-go:1.24", ["bogey-runner-*"]));
  assert.ok(
    imageAllowed(`bogey-runner-go:1.24@sha256:${"a".repeat(64)}`, ["bogey-runner-*"]),
    "a digest-pinned name is fine",
  );
  assert.ok(!imageAllowed("bogey-runner-go:1.24", ["bogey-runner-go:1.23"]));
  assert.ok(imageAllowed("exact:1", ["exact:1"]));
});

test("a runtime such as gVisor is passed on when set", () => {
  assert.equal(pair(args({}, { runtime: "runsc" }), "--runtime"), "runsc");
  assert.ok(!args().includes("--runtime"));
});
