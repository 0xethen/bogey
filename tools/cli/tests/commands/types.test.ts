import { fileURLToPath } from "node:url";
import { expect, test, vi } from "vite-plus/test";
import { keepOnly, runTypes, type TypeGenResult } from "../../src/commands/types.ts";

const cliDir = fileURLToPath(new URL("../..", import.meta.url));

function stub(result: Partial<TypeGenResult>): TypeGenResult {
  return { status: 0, stdout: "", stderr: "", ...result };
}

test("a missing Supabase CLI reports an install hint", async () => {
  const result = await runTypes(cliDir, ["--local"], () => stub({ error: new Error("ENOENT") }));
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("could not run the Supabase CLI");
});

test("a failing CLI surfaces stderr", async () => {
  const result = await runTypes(cliDir, ["--local"], () =>
    stub({ status: 1, stderr: "failed to connect to postgres" }),
  );
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("failed to connect to postgres");
});

test("an unreachable MCP endpoint is reported", async () => {
  const result = await runTypes(
    cliDir,
    ["--mcp", "http://localhost:1/mcp"],
    undefined,
    async () => {
      throw new Error("connection refused");
    },
  );
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("connection refused");
});

test("keepOnly drops public entries the core schema does not create", () => {
  const source = [
    "export type Database = {",
    "  public: {",
    "    Tables: {",
    "      events: {",
    "        Row: { id: string }",
    "      }",
    "      challenges_problems: {",
    "        Row: { id: string }",
    "      }",
    "    }",
    "    Functions: {",
    "      challenges_seed_demo: { Args: { p_org: string }; Returns: undefined }",
    "      set_windows: { Args: never; Returns: undefined }",
    "    }",
    "    Enums: {",
    "      challenges_verdict:",
    '        | "AC"',
    '        | "WA"',
    '      event_kind: "hackathon" | "contest"',
    "    }",
    "  }",
    "}",
  ].join("\n");

  const out = keepOnly(source, new Set(["events", "set_windows", "event_kind"]));
  expect(out).not.toContain("challenges");
  expect(out).toContain("events: {");
  expect(out).toContain("set_windows");
  expect(out).toContain("event_kind");
  expect(out.split("\n").filter((line) => line === "      }").length).toBe(1);
});

test("keepOnly drops a wrapped array without leaving its closing bracket", () => {
  const source = [
    "export const Constants = {",
    "  public: {",
    "    Enums: {",
    '      slot_kind: ["everyone", "choose"],',
    "      challenges_verdict: [",
    '        "AC",',
    '        "WA",',
    "      ],",
    '      team_role: ["captain", "member"],',
    "    },",
    "  },",
    "} as const;",
  ].join("\n");

  const out = keepOnly(source, new Set(["slot_kind", "team_role"]));
  expect(out).not.toContain("challenges");
  expect(out).not.toContain("      ],");
  expect(out).toContain("slot_kind");
  expect(out).toContain("team_role");
});

test("a failure the CLI prints on stdout is shown", async () => {
  const result = await runTypes(cliDir, ["--db-url", "postgres://x"], () =>
    stub({ status: 1, stdout: "tls error (The server does not support SSL connections)" }),
  );
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("does not support SSL");
});

test("with nothing given it uses DATABASE_URL, and retries without TLS when the server has none", async () => {
  vi.stubEnv("DATABASE_URL", "postgres://u:p@db.tailnet:5432/postgres");
  const calls: string[][] = [];
  try {
    const result = await runTypes(
      cliDir,
      [],
      (args) => {
        calls.push(args);
        return calls.length === 1
          ? stub({ status: 1, stdout: "tls error (The server does not support SSL connections)" })
          : stub({ status: 1, stderr: "stop here" });
      },
      undefined,
      (source) => source,
      () => ({ status: 1, stdout: "", stderr: "" }),
    );
    expect(calls[0]).toEqual([
      "gen",
      "types",
      "typescript",
      "--db-url",
      "postgres://u:p@db.tailnet:5432/postgres",
    ]);
    expect(calls[1]?.at(-1)).toBe("postgres://u:p@db.tailnet:5432/postgres?sslmode=disable");
    expect(result.output).toContain("stop here");
  } finally {
    vi.unstubAllEnvs();
  }
});
