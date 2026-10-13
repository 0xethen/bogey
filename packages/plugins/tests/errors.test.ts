import { describe, expect, test } from "vite-plus/test";
import { BogeyRequestError } from "@bogey/db/errors";
import { describeError } from "../src/errors.ts";

describe("describeError", () => {
  test("is just the safe message when verbose is off", () => {
    const error = new BogeyRequestError({ code: "forbidden", message: "no", retryable: false });
    expect(describeError(error, false)).toBe("no");
  });

  test("appends the stable code when verbose is on", () => {
    const error = new BogeyRequestError({ code: "forbidden", message: "no", retryable: false });
    expect(describeError(error, true)).toBe("no\nBOGEY_ERR_FORBIDDEN");
  });

  test("handles a cause that was never a BogeyRequestError", () => {
    expect(describeError(new Error("boom"), false)).toBe("boom");
    expect(describeError(new Error("boom"), true)).toBe("boom\nBOGEY_ERR_UNKNOWN");
  });
});
