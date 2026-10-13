import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { resetUnreachable, timeoutFetch } from "../src/fetch.ts";

describe("timeoutFetch", () => {
  afterEach(() => {
    resetUnreachable();
    vi.unstubAllGlobals();
  });

  test("passes through a response that arrives in time", async () => {
    const response = new Response("ok");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );

    await expect(timeoutFetch(1000)("https://example.test")).resolves.toBe(response);
  });

  test("turns a timeout into the same shape a real network failure throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: unknown, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        });
      }),
    );

    const result = timeoutFetch(1)("https://example.test");

    await expect(result).rejects.toThrow(TypeError);
    await expect(result).rejects.toThrow("fetch failed");
  });

  test("leaves an unrelated fetch error alone", async () => {
    const boom = new TypeError("Failed to fetch");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw boom;
      }),
    );

    await expect(timeoutFetch(1000)("https://example.test")).rejects.toBe(boom);
  });

  test("still honors a caller-supplied signal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: unknown, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        });
      }),
    );

    const controller = new AbortController();
    const result = timeoutFetch(1000)("https://example.test", { signal: controller.signal });
    controller.abort(new DOMException("cancelled", "AbortError"));

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });

  test("after an origin can't be reached, its other requests fail at once", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchMock);
    const get = timeoutFetch(1000);

    await expect(get("https://db.test/a")).rejects.toThrow("fetch failed");
    await expect(get("https://db.test/b")).rejects.toThrow("fetch failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(get("https://other.test/")).rejects.toThrow("fetch failed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("a response clears the mark", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const get = timeoutFetch(1000);

    await expect(get("https://db.test/a")).rejects.toThrow();
    resetUnreachable();
    await expect(get("https://db.test/a")).resolves.toBeInstanceOf(Response);
    await expect(get("https://db.test/b")).resolves.toBeInstanceOf(Response);
  });
});
