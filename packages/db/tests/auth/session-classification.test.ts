import { expect, test } from "vite-plus/test";
import { AuthRetryableFetchError, AuthSessionMissingError } from "@supabase/supabase-js";
import { classifyUserResult } from "../../src/auth.ts";

test("a signed-in user is authenticated", () => {
  expect(classifyUserResult(null, true)).toBe("authenticated");
});

test("no session cookie is anonymous, not an outage", () => {
  expect(classifyUserResult(new AuthSessionMissingError(), false)).toBe("anonymous");
  expect(classifyUserResult(null, false)).toBe("anonymous");
});

test("an unreachable backend is unavailable, NOT anonymous", () => {
  const unreachable = new AuthRetryableFetchError("Failed to fetch", 0);

  expect(classifyUserResult(unreachable, false)).toBe("unavailable");
  expect(classifyUserResult(unreachable, true)).toBe("unavailable");
});

test("an ordinary auth rejection is still anonymous", () => {
  expect(classifyUserResult(new Error("invalid JWT"), false)).toBe("anonymous");
});
