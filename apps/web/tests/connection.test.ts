import { expect, test } from "vite-plus/test";
import { BogeyRequestError } from "@bogey/db/errors";
import { FAILURE_WINDOW_MS, clearsAt, isUnreachable, recentFailures } from "#/lib/connection.ts";

const failure = (code: "unavailable" | "forbidden" | "not_found") =>
  new BogeyRequestError({ code, message: code, retryable: code === "unavailable" });

test("only network failures count", () => {
  expect(isUnreachable(failure("unavailable"))).toBe(true);
  expect(isUnreachable(new TypeError("Failed to fetch"))).toBe(true);
  expect(isUnreachable(failure("forbidden"))).toBe(false);
  expect(isUnreachable(failure("not_found"))).toBe(false);
  expect(isUnreachable(new Error("boom"))).toBe(false);
});

test("one failure never shows the warning", () => {
  expect(clearsAt([1000])).toBeNull();
});

test("the warning clears a minute after the failures that raised it", () => {
  expect(clearsAt([1000, 5000])).toBe(1000 + FAILURE_WINDOW_MS);
  expect(clearsAt([1000, 5000, 9000])).toBe(5000 + FAILURE_WINDOW_MS);
  expect(recentFailures([1000, 5000], 1000 + FAILURE_WINDOW_MS)).toEqual([5000]);
});
