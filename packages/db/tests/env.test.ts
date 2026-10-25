import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { authCookieName, publicSupabaseUrl, serverSupabaseUrl } from "../src/env.ts";

const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_INTERNAL_URL"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.SUPABASE_URL = "https://bogey.example.org";
  delete process.env.SUPABASE_INTERNAL_URL;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

test("without an internal URL the server uses the public one", () => {
  expect(serverSupabaseUrl()).toBe("https://bogey.example.org");
  expect(publicSupabaseUrl("http://kong:8000/storage/v1/x")).toBe("http://kong:8000/storage/v1/x");
});

test("with one, the server uses it and links go back to the public URL", () => {
  process.env.SUPABASE_INTERNAL_URL = "http://kong:8000/";
  expect(serverSupabaseUrl()).toBe("http://kong:8000/");
  expect(publicSupabaseUrl("http://kong:8000/storage/v1/object/sign/a?token=t")).toBe(
    "https://bogey.example.org/storage/v1/object/sign/a?token=t",
  );
  expect(publicSupabaseUrl("https://elsewhere.test/x")).toBe("https://elsewhere.test/x");
});

test("the auth cookie is named after the public host either way", () => {
  process.env.SUPABASE_INTERNAL_URL = "http://127.0.0.1";
  expect(authCookieName()).toBe("sb-bogey-auth-token");
});
