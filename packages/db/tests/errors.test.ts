import { describe, expect, test, vi } from "vite-plus/test";
import {
  BogeyRequestError,
  classify,
  errorCode,
  fail,
  ok,
  retryPolicy,
  toFailure,
  unwrap,
  VERBOSE_ERRORS,
} from "../src/errors.ts";

function pgError(code: string) {
  return { code, message: 'relation "public.secret" does not exist', details: "", hint: "" };
}

describe("classify", () => {
  test("maps the SQLSTATEs Bogey's own functions raise", () => {
    expect(classify(pgError("42501"))).toBe("forbidden");
    expect(classify(pgError("P0002"))).toBe("not_found");
    expect(classify(pgError("23505"))).toBe("conflict");
    expect(classify(pgError("23514"))).toBe("invalid");
    expect(classify(pgError("22023"))).toBe("invalid");
  });

  test("maps PostgREST's own codes", () => {
    expect(classify(pgError("PGRST116"))).toBe("not_found");
    expect(classify(pgError("PGRST301"))).toBe("forbidden");
  });

  test("a request that never reached Postgres is unavailable, not unknown", () => {
    expect(classify(new TypeError("Failed to fetch"))).toBe("unavailable");
  });

  test("anything unmapped is unknown", () => {
    expect(classify(pgError("XX000"))).toBe("unknown");
    expect(classify(new Error("boom"))).toBe("unknown");
    expect(classify(null)).toBe("unknown");
  });
});

describe("toFailure", () => {
  test("never passes the raw database message through", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = toFailure(pgError("42501"), "test");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("forbidden");
    expect(result.error.message).not.toContain("public.secret");
  });

  test("logs the real cause so it isn't simply lost", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cause = pgError("23505");

    toFailure(cause, "reviewing a signup");

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("reviewing a signup"), cause);
  });

  test("an unmapped cause logs at error level, since it's a gap in the map", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    toFailure(pgError("XX000"), "test");

    expect(error).toHaveBeenCalled();
  });

  test("carries the real cause as detail when verbose errors are on", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = toFailure(
      { code: "XX000", message: "boom", details: "row 3", hint: "check it" },
      "saving a team",
    );

    expect(VERBOSE_ERRORS).toBe(true);
    if (result.ok) return;
    expect(result.error.message).not.toContain("boom");
    expect(result.error.detail).toBe("saving a team\n[XX000] boom\nDetails: row 3\nHint: check it");
  });

  test("only unavailable is marked retryable", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const offline = toFailure(new TypeError("Failed to fetch"), "test");
    const denied = toFailure(pgError("42501"), "test");

    expect(offline.ok === false && offline.error.retryable).toBe(true);
    expect(denied.ok === false && denied.error.retryable).toBe(false);
  });
});

describe("unwrap", () => {
  test("returns the value on success", () => {
    expect(unwrap(ok({ id: "abc" }))).toEqual({ id: "abc" });
  });

  test("throws an error the client can actually instanceof", () => {
    expect(() => unwrap(fail("forbidden", "nope"))).toThrow(BogeyRequestError);

    try {
      unwrap(fail("conflict", "already done"));
    } catch (error) {
      expect(error).toBeInstanceOf(BogeyRequestError);
      expect((error as BogeyRequestError).code).toBe("conflict");
      expect((error as BogeyRequestError).message).toBe("already done");
    }
  });
});

describe("errorCode", () => {
  test("reads the code off a BogeyRequestError rather than re-classifying it", () => {
    const error = new BogeyRequestError({
      code: "conflict",
      message: "already done",
      retryable: false,
    });
    expect(errorCode(error)).toBe("BOGEY_ERR_CONFLICT");
  });

  test("classifies a raw cause the same way toFailure would", () => {
    expect(errorCode(pgError("42501"))).toBe("BOGEY_ERR_FORBIDDEN");
    expect(errorCode(new TypeError("Failed to fetch"))).toBe("BOGEY_ERR_UNAVAILABLE");
  });

  test("never contains the raw cause — it's a fixed vocabulary, not a message", () => {
    const code = errorCode(pgError("42501"));
    expect(code).not.toContain("public.secret");
  });
});

describe("retryPolicy", () => {
  test("does not retry what can't succeed on a second attempt", () => {
    const denied = new BogeyRequestError({
      code: "forbidden",
      message: "no",
      retryable: false,
    });

    expect(retryPolicy(0, denied)).toBe(false);
  });

  test("retries an outage once, since each retry waits out another timeout", () => {
    const offline = new BogeyRequestError({
      code: "unavailable",
      message: "no",
      retryable: true,
    });

    expect(retryPolicy(0, offline)).toBe(true);
    expect(retryPolicy(1, offline)).toBe(false);
  });

  test("retries an unrecognized error a couple of times", () => {
    expect(retryPolicy(0, new Error("???"))).toBe(true);
    expect(retryPolicy(5, new Error("???"))).toBe(false);
  });
});
