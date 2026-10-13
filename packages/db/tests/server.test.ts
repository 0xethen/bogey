import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { createServerClient } from "../src/server.ts";

const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

test("the error names the missing variable and where to set it", () => {
  expect(() => createServerClient()).toThrow(/Missing SUPABASE_URL/);
  expect(() => createServerClient()).toThrow(/\.env at the repo root/);
});

test("the publishable key is required too", () => {
  process.env.SUPABASE_URL = "http://localhost:8000";
  expect(() => createServerClient()).toThrow(/Missing SUPABASE_PUBLISHABLE_KEY/);
});
