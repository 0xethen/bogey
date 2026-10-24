import { describe, expect, test } from "vite-plus/test";
import { createClient } from "@supabase/supabase-js";
import {
  ExportError,
  IN_CHUNK,
  readAll,
  readAllIn,
} from "../src/lib/server/export-reads.server.ts";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// a client that answers every request with no rows and remembers the URLs it was asked for
function recordingClient() {
  const urls: string[] = [];
  const client = createClient("http://db.test", "key", {
    auth: { persistSession: false },
    global: {
      fetch: async (input) => {
        urls.push(input instanceof Request ? input.url : String(input));
        return new Response("[]", { headers: { "Content-Type": "application/json" } });
      },
    },
  });
  return { client, urls };
}

describe("readAllIn", () => {
  test("a big roster's ids are asked for in chunks short enough for the gateway", async () => {
    const { client, urls } = recordingClient();
    const ids = Array.from({ length: 292 }, (_, n) => uuid(n));
    await readAllIn(ids, (chunk, from, to) =>
      client.from("profiles").select("id, display_name").in("id", chunk).range(from, to),
    );
    expect(urls).toHaveLength(Math.ceil(292 / IN_CHUNK));
    // nginx and Kong refuse request lines past 8 KB
    for (const url of urls) expect(url.length).toBeLessThan(8000);
    const asked = urls.flatMap((url) =>
      decodeURIComponent(new URL(url).searchParams.get("id") ?? "")
        .replace(/^in\.\(|\)$/g, "")
        .split(","),
    );
    expect(new Set(asked)).toEqual(new Set(ids));
  });

  test("rows from every chunk come back together, without repeated ids", async () => {
    const asked: string[][] = [];
    const rows = await readAllIn(["a", "b", "a", "c"], async (chunk) => {
      asked.push(chunk);
      return { data: chunk.map((id) => ({ id })), error: null };
    });
    expect(asked).toEqual([["a", "b", "c"]]);
    expect(rows).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);
  });

  test("no ids, no requests", async () => {
    let calls = 0;
    await readAllIn([], async () => {
      calls += 1;
      return { data: [], error: null };
    });
    expect(calls).toBe(0);
  });
});

describe("readAll", () => {
  test("keeps reading while pages come back full", async () => {
    const ranges: [number, number][] = [];
    const rows = await readAll(async (from, to) => {
      ranges.push([from, to]);
      return {
        data: Array.from({ length: from === 0 ? 1000 : 3 }, (_, n) => from + n),
        error: null,
      };
    });
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(rows).toHaveLength(1003);
  });

  test("a failed page is an export error", async () => {
    await expect(
      readAll(async () => ({ data: null, error: { message: "URI too long" } })),
    ).rejects.toBeInstanceOf(ExportError);
  });
});
