import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { nowStore } from "@bogey/ui/hooks/now";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-01T09:00:00.400Z"));
});
afterEach(() => vi.useRealTimers());

test("one timer wakes every subscriber at each boundary", () => {
  const store = nowStore(1000);
  const a = vi.fn();
  const b = vi.fn();
  const stopA = store.subscribe(a);
  const stopB = store.subscribe(b);
  expect(vi.getTimerCount()).toBe(1);

  vi.advanceTimersByTime(700);
  expect(a).toHaveBeenCalledTimes(1);
  expect(b).toHaveBeenCalledTimes(1);
  expect(store.snapshot()).toBe(new Date("2026-10-01T09:00:01.000Z").getTime());

  stopA();
  stopB();
  expect(vi.getTimerCount()).toBe(0);
});

test("no timer runs without subscribers", () => {
  const store = nowStore(60_000);
  const stop = store.subscribe(() => {});
  stop();
  vi.advanceTimersByTime(120_000);
  expect(vi.getTimerCount()).toBe(0);
});
