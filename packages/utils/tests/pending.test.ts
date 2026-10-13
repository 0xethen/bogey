import { expect, test } from "vite-plus/test";
import { dequeue, parseQueue, queue } from "../src/pending.ts";

const isNumber = (value: unknown): value is number => typeof value === "number";

test("queuing a key again replaces the older entry", () => {
  const first = queue([], "a", 1, 10);
  const second = queue(queue(first, "b", 2, 11), "a", 3, 12);
  expect(second).toEqual([
    { key: "b", savedAt: 11, value: 2 },
    { key: "a", savedAt: 12, value: 3 },
  ]);
});

test("removing an entry leaves the rest", () => {
  const list = queue(queue([], "a", 1, 1), "b", 2, 2);
  expect(dequeue(list, "a")).toEqual([{ key: "b", savedAt: 2, value: 2 }]);
});

test("reading a saved queue drops what is malformed", () => {
  const text = JSON.stringify([
    { key: "a", savedAt: 1, value: 5 },
    { key: "b", savedAt: 2, value: "five" },
    { key: 7, savedAt: 3, value: 1 },
    "junk",
  ]);
  expect(parseQueue(text, isNumber)).toEqual([{ key: "a", savedAt: 1, value: 5 }]);
  expect(parseQueue("not json", isNumber)).toEqual([]);
  expect(parseQueue(null, isNumber)).toEqual([]);
  expect(parseQueue('{"a":1}', isNumber)).toEqual([]);
});
