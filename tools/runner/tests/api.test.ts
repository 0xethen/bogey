import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { createApi, parseClaim } from "../src/api.ts";

const language = {
  key: "python",
  image: "bogey-runner-python:3.13",
  source_file: "main.py",
  compile_cmd: null,
  run_cmd: "python3 main.py",
};

const payload = {
  judging_id: "j1",
  event_id: "e1",
  attempts: 2,
  solution: { id: "s1", source: "print(1)" },
  language,
  problem: {
    id: "p1",
    label: "A",
    time_limit_ms: 2000,
    memory_limit_mb: 256,
    output_limit_kb: 8192,
    checker: "tokens",
    checker_tolerance: null,
    checker_source: null,
    checker_language: null,
    points: "100.00",
    test_groups: { g1: { aggregation: "min", stopOnFail: true } },
  },
  scoring: "ioi",
  testcases: [{ id: "t1", ordinal: 1, is_sample: true, group_key: null, points: null }],
};

test("a claim is read into typed fields", () => {
  const claim = parseClaim(payload);
  assert.equal(claim.judgingId, "j1");
  assert.equal(claim.scoring, "ioi");
  assert.equal(claim.problem.points, 100, "numerics arrive as text");
  assert.deepEqual(claim.problem.test_groups, { g1: { aggregation: "min", stopOnFail: true } });
  assert.equal(claim.testcases[0]?.is_sample, true);
});

test("an unknown scoring is ICPC, and a malformed claim is refused", () => {
  assert.equal(parseClaim({ ...payload, scoring: undefined }).scoring, "icpc");
  assert.throws(() => parseClaim({ ...payload, solution: null }), /solution/);
  assert.throws(
    () => parseClaim({ ...payload, problem: { ...payload.problem, checker: "magic" } }),
    /checker/,
  );
  assert.throws(() => parseClaim({ ...payload, testcases: "none" }), /testcases/);
});

test("the API calls the plugin's functions with the service key and the runner's id", async () => {
  const seen: { url: string; body: string; auth: string | null }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    seen.push({
      url: String(input),
      body: String(init?.body ?? ""),
      auth: new Headers(init?.headers).get("authorization"),
    });
    return new Response(String(input).includes("claim") ? "null" : "true", { status: 200 });
  };
  const api = createApi(
    { supabaseUrl: "https://x.co", serviceKey: "svc", runnerId: "r1", leaseSeconds: 90 },
    fetcher,
  );
  assert.equal(await api.claim(), null);
  assert.equal(await api.heartbeat("j1"), true);
  assert.equal(
    await api.record("j1", {
      verdict: "AC",
      score: null,
      maxTimeMs: 5,
      maxMemoryKb: null,
      compileOutput: "",
      runs: [],
    }),
    true,
  );
  assert.equal(seen[0]?.url, "https://x.co/rest/v1/rpc/challenges_claim_judging");
  assert.deepEqual(JSON.parse(seen[0]?.body ?? ""), { p_runner: "r1", p_lease_seconds: 90 });
  assert.equal(seen[0]?.auth, "Bearer svc");
  assert.equal(JSON.parse(seen[2]?.body ?? "").p_verdict, "AC");
});

test("an error from the database is an error, with the path", async () => {
  const api = createApi(
    { supabaseUrl: "https://x.co", serviceKey: "svc", runnerId: "r1", leaseSeconds: 90 },
    async () => new Response('{"message":"no"}', { status: 401 }),
  );
  await assert.rejects(api.claim(), /challenges_claim_judging: HTTP 401/);
});

test("test data is read one test at a time", async () => {
  let asked = "";
  const api = createApi(
    { supabaseUrl: "https://x.co", serviceKey: "svc", runnerId: "r1", leaseSeconds: 90 },
    async (input) => {
      asked = String(input);
      return new Response(JSON.stringify([{ input: "1 2", answer: "3" }]), { status: 200 });
    },
  );
  assert.deepEqual(await api.testData("t 1"), { input: "1 2", answer: "3" });
  assert.match(asked, /challenges_testcases\?id=eq\.t%201&select=input,answer/);
});
