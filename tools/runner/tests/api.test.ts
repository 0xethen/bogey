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

const KEY = `bogey_runner_${"a".repeat(43)}`;
const keyed = {
  supabaseUrl: "https://x.co",
  credential: { kind: "key" as const, runnerKey: KEY, apiKey: "anon" },
  runnerId: "r1",
  leaseSeconds: 90,
};
const legacy = {
  ...keyed,
  credential: { kind: "service" as const, serviceKey: "svc" },
};

interface Seen {
  url: string;
  body: string;
  headers: Headers;
}

function recording(answer: (url: string) => string) {
  const seen: Seen[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    seen.push({
      url: String(input),
      body: String(init?.body ?? ""),
      headers: new Headers(init?.headers),
    });
    return new Response(answer(String(input)), { status: 200 });
  };
  return { seen, fetcher };
}

test("with a runner key the API calls only the runner's functions, and never sends a service key", async () => {
  const { seen, fetcher } = recording((url) => (url.includes("claim") ? "null" : "true"));
  const api = createApi(keyed, fetcher);
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
  await api.requeue("j1", "x");
  await api.release("j1");
  assert.deepEqual(
    seen.map((call) => call.url.replace("https://x.co/rest/v1/rpc/", "")),
    [
      "challenges_runner_claim",
      "challenges_runner_heartbeat",
      "challenges_runner_record",
      "challenges_runner_requeue",
      "challenges_runner_release",
    ],
  );
  assert.deepEqual(JSON.parse(seen[0]?.body ?? ""), { p_runner: "r1", p_lease_seconds: 90 });
  for (const call of seen) {
    assert.equal(call.headers.get("x-bogey-runner-key"), KEY);
    assert.equal(call.headers.get("apikey"), "anon", "the anon key only passes the gateway");
    assert.equal(call.headers.get("authorization"), null);
  }
  assert.equal(JSON.parse(seen[2]?.body ?? "").p_verdict, "AC");
  assert.equal("p_groups" in JSON.parse(seen[2]?.body ?? ""), false, "no groups, no p_groups");
});

test("a claim says whether to run every test, and a record sends each group's points", async () => {
  assert.equal(parseClaim(payload).runAll, false);
  assert.equal(parseClaim({ ...payload, run_all: true }).runAll, true);
  const { seen, fetcher } = recording(() => "true");
  const api = createApi(keyed, fetcher);
  await api.record("j1", {
    verdict: "WA",
    score: 30,
    groupScores: { g1: 30, g2: 0 },
    maxTimeMs: 5,
    maxMemoryKb: null,
    compileOutput: "",
    runs: [],
  });
  assert.deepEqual(JSON.parse(seen[0]?.body ?? "").p_groups, { g1: 30, g2: 0 });
});

test("with a runner key, test data comes from the judging it holds", async () => {
  const { seen, fetcher } = recording(() => JSON.stringify({ input: "1 2", answer: "3" }));
  const api = createApi(keyed, fetcher);
  assert.deepEqual(await api.testData("j1", "t1"), { input: "1 2", answer: "3" });
  assert.equal(seen[0]?.url, "https://x.co/rest/v1/rpc/challenges_runner_test_data");
  assert.deepEqual(JSON.parse(seen[0]?.body ?? ""), {
    p_judging: "j1",
    p_runner: "r1",
    p_testcase: "t1",
  });
});

test("behind the runner gateway no API key is sent at all", async () => {
  const { seen, fetcher } = recording(() => "null");
  await createApi({ ...keyed, credential: { ...keyed.credential, apiKey: null } }, fetcher).claim();
  assert.equal(seen[0]?.headers.get("apikey"), null);
});

test("the old service key still works, through the old functions", async () => {
  const { seen, fetcher } = recording((url) =>
    url.includes("testcases") ? JSON.stringify([{ input: "1 2", answer: "3" }]) : "null",
  );
  const api = createApi(legacy, fetcher);
  await api.claim();
  assert.equal(seen[0]?.url, "https://x.co/rest/v1/rpc/challenges_claim_judging");
  assert.equal(seen[0]?.headers.get("authorization"), "Bearer svc");
  assert.deepEqual(await api.testData("j1", "t 1"), { input: "1 2", answer: "3" });
  assert.match(seen[1]?.url ?? "", /challenges_testcases\?id=eq\.t%201&select=input,answer/);
});

test("an error from the database is an error, with the path", async () => {
  const api = createApi(keyed, async () => new Response('{"message":"no"}', { status: 403 }));
  await assert.rejects(api.claim(), /challenges_runner_claim: HTTP 403/);
});
