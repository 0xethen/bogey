import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { builtinMatch, closeEnough, exactMatch, floatMatch, tokenMatch } from "../src/checkers.ts";

test("exact ignores trailing whitespace on lines and at the end, nothing else", () => {
  assert.equal(exactMatch("1 2\n3\n", "1 2\n3"), true);
  assert.equal(exactMatch("1 2  \r\n3\r\n\r\n", "1 2\n3\n"), true);
  assert.equal(exactMatch("1  2\n", "1 2\n"), false);
  assert.equal(exactMatch(" 1 2\n", "1 2\n"), false);
  assert.equal(exactMatch("1\n\n2\n", "1\n2\n"), false);
});

test("tokens ignore all whitespace between words", () => {
  assert.equal(tokenMatch("1  2\n3", "1 2 3"), true);
  assert.equal(tokenMatch("1 2", "1 2 3"), false);
  assert.equal(tokenMatch("Yes", "yes"), false);
});

test("float accepts numbers within an absolute or relative tolerance", () => {
  assert.equal(floatMatch("3.14159265", "3.1415927", 1e-6), true);
  assert.equal(floatMatch("3.15", "3.14", 1e-6), false);
  assert.equal(
    floatMatch("1000000.5", "1000000.0", 1e-6),
    true,
    "relative: 0.5 is within 1e-6 of a million",
  );
  assert.equal(floatMatch("0.0000004", "0", 1e-6), true, "absolute near zero");
  assert.equal(floatMatch("1e3", "1000", 1e-9), true);
  assert.equal(floatMatch("abc 1.0", "abc 1.0000001", 1e-6), true);
  assert.equal(floatMatch("abc 1.0", "abd 1.0", 1e-6), false, "words must be equal");
  assert.equal(floatMatch("1.0", "1.0 2.0", 1e-6), false);
});

test("closeEnough is symmetric about equal values and strict outside", () => {
  assert.equal(closeEnough(5, 5, 0), true);
  assert.equal(closeEnough(5.001, 5, 1e-6), false);
});

test("builtinMatch dispatches, with a default tolerance for float", () => {
  assert.equal(builtinMatch("exact", "a\n", "a", null), true);
  assert.equal(builtinMatch("tokens", "a   b", "a b", null), true);
  assert.equal(builtinMatch("float", "1.0000001", "1", null), true);
});
