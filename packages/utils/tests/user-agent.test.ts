import { expect, test } from "vite-plus/test";
import { describeUserAgent } from "../src/user-agent.ts";

test("names common browsers and systems", () => {
  expect(
    describeUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    ),
  ).toEqual({ browser: "Chrome", os: "macOS", mobile: false });
  expect(
    describeUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    ),
  ).toEqual({ browser: "Safari", os: "iOS", mobile: true });
  expect(
    describeUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
    ).browser,
  ).toBe("Edge");
  expect(
    describeUserAgent("Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0"),
  ).toEqual({ browser: "Firefox", os: "Linux", mobile: false });
});

test("knows nothing about nothing", () => {
  expect(describeUserAgent(null)).toEqual({ browser: null, os: null, mobile: false });
});
