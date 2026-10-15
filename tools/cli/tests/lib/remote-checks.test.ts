import { expect, test } from "vite-plus/test";
import { checkAuthConfig, projectRef, remoteChecks } from "../../src/lib/remote-checks.ts";

type Route = [match: string, status: number, body: unknown];

function fake(routes: Route[]): { fetcher: typeof fetch; seen: string[] } {
  const seen: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    seen.push(url);
    const route = routes.find(([match]) => url.includes(match));
    if (!route) return new Response("nope", { status: 404 });
    return new Response(JSON.stringify(route[2]), { status: route[1] });
  };
  return { fetcher, seen };
}

const healthy: Route[] = [
  [
    "/auth/v1/settings",
    200,
    { disable_signup: false, mailer_autoconfirm: false, external: { email: true } },
  ],
  ["/auth/v1/admin/users", 200, { users: [] }],
  ["/rest/v1/orgs", 200, [{ id: "o1" }]],
  ["/rest/v1/settings", 200, [{ namespace: "tenancy", value: { appUrl: "http://web:3000" } }]],
  ["/rest/v1/email_sends", 200, [{ sent_at: "2026-10-10T00:00:00Z" }]],
];
const input = { url: "https://abcdefghij.supabase.co", serviceKey: "svc" };

test("a healthy project has no issues, and says what it couldn't read without a token", async () => {
  const { fetcher } = fake(healthy);
  const report = await remoteChecks({ ...input, fetcher });
  expect(report.issues).toEqual([]);
  expect(report.notes.join(" ")).toMatch(/SUPABASE_ACCESS_TOKEN/);
});

test("signups off, autoconfirm on and a rejected service key are each reported", async () => {
  const { fetcher } = fake([
    [
      "/auth/v1/settings",
      200,
      { disable_signup: true, mailer_autoconfirm: true, external: { email: false } },
    ],
    ["/auth/v1/admin/users", 401, { message: "invalid JWT" }],
    ["/rest/v1/orgs", 200, []],
    ["/rest/v1/settings", 200, []],
    ["/rest/v1/email_sends", 200, []],
  ]);
  const { issues, notes } = await remoteChecks({ ...input, fetcher });
  const text = issues.map((issue) => issue.message).join("\n");
  expect(text).toMatch(/sign-ups disabled/);
  expect(text).toMatch(/auto-confirms/);
  expect(text).toMatch(/email provider is off/);
  expect(text).toMatch(/service key was refused/);
  expect(text).toMatch(/no organization yet/);
  expect(text).toMatch(/app address/);
  expect(notes.join(" ")).toMatch(/No email has gone through/);
});

test("a schema that isn't applied says so", async () => {
  const { fetcher } = fake([
    ["/auth/v1/settings", 200, { external: { email: true } }],
    ["/auth/v1/admin/users", 200, {}],
    ["/rest/v1/orgs", 404, { message: "Could not find the table 'public.orgs'" }],
  ]);
  const { issues } = await remoteChecks({ ...input, fetcher });
  expect(issues.map((issue) => issue.message).join("\n")).toMatch(/bogey db migrate/);
});

test("an unreachable Auth stops at that", async () => {
  const fetcher: typeof fetch = async () => {
    throw new Error("connect ECONNREFUSED");
  };
  const { issues } = await remoteChecks({ ...input, fetcher });
  expect(issues).toHaveLength(1);
  expect(issues[0]?.message).toMatch(/ECONNREFUSED/);
});

test("with a token it reads the dashboard's settings from the Management API", async () => {
  const { fetcher, seen } = fake([
    ...healthy,
    [
      "api.supabase.com/v1/projects/abcdefghij/config/auth",
      200,
      {
        hook_before_user_created_enabled: true,
        hook_before_user_created_uri: "pg-functions://postgres/private/before_user_created",
        hook_send_email_enabled: true,
        hook_send_email_uri: "https://hacks.example.org/api/auth/send-email",
        mailer_otp_length: 6,
        site_url: "https://hacks.example.org",
        uri_allow_list: "https://hacks.example.org/**",
        mfa_totp_enroll_enabled: true,
        mfa_totp_verify_enabled: true,
      },
    ],
  ]);
  const report = await remoteChecks({ ...input, accessToken: "sbp_x", fetcher });
  expect(seen.some((url) => new URL(url).hostname === "api.supabase.com")).toBe(true);
  expect(report.issues).toEqual([]);
  expect(report.notes.join(" ")).not.toMatch(/SUPABASE_ACCESS_TOKEN/);
});

test("the dashboard's settings are checked one by one", () => {
  const messages = checkAuthConfig({
    hook_before_user_created_enabled: false,
    hook_send_email_enabled: true,
    hook_send_email_uri: "https://x.example/other",
    mailer_otp_length: 8,
    site_url: "http://localhost:3000",
    uri_allow_list: "",
    mfa_totp_enroll_enabled: true,
    mfa_totp_verify_enabled: false,
  }).map((issue) => issue.message);
  expect(messages.join("\n")).toMatch(/Before User Created hook is off/);
  expect(messages.join("\n")).toMatch(/\/api\/auth\/send-email/);
  expect(messages.join("\n")).toMatch(/OTP length/);
  expect(messages.join("\n")).toMatch(/Site URL/);
  expect(messages.join("\n")).toMatch(/redirect URLs/);
  expect(messages.join("\n")).toMatch(/TOTP/);
});

test("the project reference comes from a Cloud URL only", () => {
  expect(projectRef("https://abcdefghij.supabase.co")).toBe("abcdefghij");
  expect(projectRef("https://db.example.org")).toBeNull();
  expect(projectRef("http://localhost:8000")).toBeNull();
});
