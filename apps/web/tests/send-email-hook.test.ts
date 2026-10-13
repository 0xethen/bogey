import { EMAIL_KINDS } from "@bogey/config/email";
import { createHmac } from "node:crypto";
import { describe, expect, test } from "vite-plus/test";
import type { Json } from "@bogey/db/types";
import {
  confirmLink,
  emailContext,
  templateFor,
  HookError,
  renderAuthEmail,
  verifyHook,
} from "../src/lib/server/send-email.server.ts";

const key = Buffer.from("test-signing-key-32-bytes-long!!");
const secret = `v1,whsec_${key.toString("base64")}`;

function signed(body: string, at = Math.floor(Date.now() / 1000), signWith = key) {
  const signature = createHmac("sha256", signWith).update(`msg_1.${at}.${body}`).digest("base64");
  return new Headers({
    "webhook-id": "msg_1",
    "webhook-timestamp": String(at),
    "webhook-signature": `v1,${signature}`,
  });
}

describe("verifyHook", () => {
  test("accepts a correctly signed request", () => {
    expect(() => verifyHook('{"a":1}', signed('{"a":1}'), secret)).not.toThrow();
  });

  test("rejects a tampered body", () => {
    expect(() => verifyHook('{"a":2}', signed('{"a":1}'), secret)).toThrow("bad signature");
  });

  test("rejects the wrong key", () => {
    const other = signed('{"a":1}', undefined, Buffer.from("another-key-entirely-32-bytes!!!"));
    expect(() => verifyHook('{"a":1}', other, secret)).toThrow("bad signature");
  });

  test("rejects old requests, so a captured one can't be replayed later", () => {
    const old = signed('{"a":1}', Math.floor(Date.now() / 1000) - 600);
    expect(() => verifyHook('{"a":1}', old, secret)).toThrow("stale");
  });

  test("rejects missing headers", () => {
    expect(() => verifyHook("{}", new Headers(), secret)).toThrow("missing");
  });
});

test("sign-in links open the app's confirm page with the token hash", () => {
  expect(confirmLink("abc123", "magiclink", "http://localhost:3000/auth/confirm")).toBe(
    "http://localhost:3000/auth/confirm?token_hash=abc123&type=magiclink",
  );
  expect(() => confirmLink("abc123", "magiclink", "")).toThrow(HookError);
});

describe("what the hook renders", () => {
  const row = (scope: "instance" | "org", namespace: string, value: Json) => ({
    scope,
    org_id: scope === "org" ? "org-1" : null,
    namespace,
    value,
  });
  const org = { id: "org-1", name: "Acme Hack Club" };
  const values = { code: "482913", link: "https://acme.test/auth/confirm?x=1", email: "a@b.co" };

  test("uses Bogey's templates and layout when nothing is set", () => {
    const context = emailContext(null, []);
    const mail = renderAuthEmail(context, "signIn", { ...values, origin: "https://acme.test" });
    expect(mail.subject).toBe("Your Example Org sign-in link");
    expect(mail.html).toContain("482913");
    expect(mail.html).toContain("https://acme.test/auth/confirm?x=1");
    expect(mail.html).toContain("Sent by");
    expect(mail.text).toContain("482913");
  });

  test("an org's wording wins per kind, and the rest falls back to the instance", () => {
    const context = emailContext(org, [
      row("instance", "email", {
        templates: { signIn: { subject: "Instance {{code}}", body: "Instance body {{code}}" } },
      }),
      row("org", "email", {
        templates: { invite: { subject: "Org invite", body: "You're in {{link}}" } },
      }),
    ]);
    expect(templateFor(context, "signIn", EMAIL_KINDS.signIn).subject).toBe("Instance {{code}}");
    expect(templateFor(context, "invite", EMAIL_KINDS.invite).subject).toBe("Org invite");
    expect(templateFor(context, "emailChange", EMAIL_KINDS.emailChange).subject).toContain(
      "Confirm",
    );
  });

  test("the layout comes from the instance; an org's stored layout is ignored", () => {
    const context = emailContext(org, [
      row("instance", "email", { layout: "<main>{{content}}</main>" }),
      row("org", "email", { layout: "<p>phish {{content}}</p>" }),
    ]);
    const mail = renderAuthEmail(context, "signIn", { ...values, origin: "https://acme.test" });
    expect(mail.html).toContain("<main>");
    expect(mail.html).not.toContain("phish");
  });

  test("an org can't hide who sent the mail", () => {
    const context = emailContext(org, [
      row("org", "email", {
        templates: { signIn: { subject: "Hi", body: "Open {{link}} {{code}}" } },
      }),
    ]);
    const mail = renderAuthEmail(context, "signIn", { ...values, origin: "https://acme.test" });
    expect(mail.html).toContain("on behalf of Acme Hack Club");
    expect(mail.text).toContain("on behalf of Acme Hack Club");
  });

  test("the sender is the org's name unless set", () => {
    expect(emailContext(org, []).senderName).toBe("Acme Hack Club");
    expect(emailContext(org, [row("org", "email", { senderName: "Acme Team" })]).senderName).toBe(
      "Acme Team",
    );
  });

  test("the org's accent colors the button", () => {
    const context = emailContext(org, [row("org", "branding", { accent: "#ff3366" })]);
    const mail = renderAuthEmail(context, "signIn", { ...values, origin: "https://acme.test" });
    expect(mail.html).toContain("#ff3366");
  });
});
