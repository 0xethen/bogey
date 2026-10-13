import { expect, test } from "vite-plus/test";
import { verifyAsset, verifyRelease } from "../../src/lib/attestation.ts";
import type { ProcessResult, Runner } from "../../src/lib/migrations.ts";

const repo = { owner: "ada", repo: "plugins" };

function fake(responses: Record<string, Partial<ProcessResult>>) {
  const calls: string[] = [];
  const run: Runner = (command, args) => {
    const line = [command, ...args].join(" ");
    calls.push(line);
    const match = Object.entries(responses).find(([prefix]) => line.startsWith(prefix));
    return { status: 0, stdout: "", stderr: "", ...match?.[1] };
  };
  return { run, calls };
}

test("an asset of an attested release is verified against that release", () => {
  const { run, calls } = fake({});
  const result = verifyAsset("/tmp/x.tgz", "demo-v1.0.0", repo, run);
  expect(result.assurance).toBe("release");
  expect(calls).toContain("gh release verify-asset demo-v1.0.0 /tmp/x.tgz --repo ada/plugins");
});

test("without a release attestation it falls back to build provenance", () => {
  const { run, calls } = fake({ "gh release verify-asset": { status: 1, stderr: "none" } });
  const result = verifyAsset("/tmp/x.tgz", "demo-v1.0.0", repo, run);
  expect(result.assurance).toBe("provenance");
  expect(calls).toContain("gh attestation verify /tmp/x.tgz --repo ada/plugins");
});

test("with neither it reports the first line of why", () => {
  const { run } = fake({
    "gh release verify-asset": { status: 1, stderr: "x" },
    "gh attestation verify": { status: 1, stderr: "\n  no attestations found for the file\nmore" },
  });
  const result = verifyAsset("/tmp/x.tgz", "demo-v1.0.0", repo, run);
  expect(result.assurance).toBe("none");
  expect(result.detail).toContain("no attestations found for the file");
});

test("without gh it says nothing was checked and asks nothing else", () => {
  const { run, calls } = fake({ "gh --version": { status: null } });
  expect(verifyAsset("/tmp/x.tgz", "t", repo, run).detail).toContain("nothing was checked");
  expect(verifyRelease("t", repo, run).assurance).toBe("none");
  expect(calls.every((call) => call === "gh --version")).toBe(true);
});

test("a release is verified by tag", () => {
  const { run, calls } = fake({});
  expect(verifyRelease("v2.0.0", repo, run).assurance).toBe("release");
  expect(calls).toContain("gh release verify v2.0.0 --repo ada/plugins");
});
