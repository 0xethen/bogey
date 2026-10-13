import { describe, expect, test } from "vite-plus/test";
import { checkSelfHostedHookWiring } from "../../src/lib/checks.ts";

describe("checkSelfHostedHookWiring", () => {
  const WIRED = {
    GOTRUE_SITE_URL: "http://localhost:3000",
    GOTRUE_HOOK_BEFORE_USER_CREATED_ENABLED: "true",
    GOTRUE_HOOK_BEFORE_USER_CREATED_URI: "pg-functions://postgres/private/before_user_created",
  };

  test("a correctly wired self-hosted stack reports nothing", () => {
    expect(checkSelfHostedHookWiring(WIRED)).toEqual([]);
  });

  test("an env with no GoTrue vars is not a self-hosted stack, so it stays quiet", () => {
    expect(checkSelfHostedHookWiring({ PATH: "/usr/bin" })).toEqual([]);
  });

  test("a missing hook is reported — this is the open-signup case", () => {
    const { GOTRUE_HOOK_BEFORE_USER_CREATED_ENABLED: _, ...withoutHook } = WIRED;

    const issues = checkSelfHostedHookWiring(withoutHook);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toMatch(/anyone can sign up/);
  });

  test("a hook pointed somewhere else is reported", () => {
    const issues = checkSelfHostedHookWiring({
      ...WIRED,
      GOTRUE_HOOK_BEFORE_USER_CREATED_URI: "pg-functions://postgres/public/something_else",
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toMatch(/before_user_created/);
  });

  test("disabling signup outright is reported, because it stops the hook running", () => {
    const issues = checkSelfHostedHookWiring({ ...WIRED, GOTRUE_DISABLE_SIGNUP: "true" });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toMatch(/real gate/);
  });
});
