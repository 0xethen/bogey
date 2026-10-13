import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { createAdminClient } from "../src/admin.ts";

const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.SUPABASE_URL = "http://localhost:8000";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_abc123";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

test("createAdminClient throws when the service role key is missing", () => {
  expect(() => createAdminClient()).toThrow("Missing SUPABASE_SERVICE_ROLE_KEY");
});

test("a publishable key masquerading as the service role key is refused", () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_publishable_other";
  expect(() => createAdminClient()).toThrow(/publishable \(anon\) key/);
});

test("a service role key equal to the publishable key is refused", () => {
  process.env.SUPABASE_PUBLISHABLE_KEY = "eyJhbGciOiJIUzI1NiJ9.anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiJ9.anon";
  expect(() => createAdminClient()).toThrow(/publishable \(anon\) key/);
});

test("a genuine secret key is accepted", () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_xyz789";
  expect(() => createAdminClient()).not.toThrow();
});
