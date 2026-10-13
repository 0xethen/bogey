import { createHmac } from "node:crypto";
import { expect, test } from "vite-plus/test";
import {
  readUnsubscribeToken,
  unsubscribeToken,
  verifyDrainSignature,
} from "../src/lib/server/email-outbox.server.ts";

const SECRET = "a".repeat(64);
const USER = "5b3e6f0a-7c0e-4d4e-9d34-5d1b1a1a1a1a";

function signed(timestamp: string, secret = SECRET) {
  const headers = new Headers({
    "x-bogey-timestamp": timestamp,
    "x-bogey-signature": createHmac("sha256", secret).update(timestamp).digest("hex"),
  });
  return headers;
}

test("accepts the database's signature over a fresh timestamp", () => {
  const now = Date.now();
  expect(verifyDrainSignature(signed(String(Math.floor(now / 1000))), SECRET, now)).toBe(true);
});

test("refuses a wrong secret, a stale timestamp and missing headers", () => {
  const now = Date.now();
  const stamp = String(Math.floor(now / 1000));
  expect(verifyDrainSignature(signed(stamp, "b".repeat(64)), SECRET, now)).toBe(false);
  expect(verifyDrainSignature(signed(String(Math.floor(now / 1000) - 600)), SECRET, now)).toBe(
    false,
  );
  expect(verifyDrainSignature(new Headers(), SECRET, now)).toBe(false);
});

test("an unsubscribe token round-trips the person and the kind", () => {
  const token = unsubscribeToken(SECRET, USER, "judging.assigned");
  expect(readUnsubscribeToken(SECRET, token)).toEqual({ userId: USER, kind: "judging.assigned" });
});

test("an unsubscribe token can't be changed or reused with another secret", () => {
  const token = unsubscribeToken(SECRET, USER, "judging.assigned");
  const [user, , signature] = token.split(".");
  const other = Buffer.from("results.published").toString("base64url");
  expect(readUnsubscribeToken(SECRET, `${user}.${other}.${signature}`)).toBeNull();
  expect(readUnsubscribeToken("c".repeat(64), token)).toBeNull();
  expect(readUnsubscribeToken(SECRET, "nonsense")).toBeNull();
});
