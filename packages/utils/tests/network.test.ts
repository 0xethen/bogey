import { expect, test } from "vite-plus/test";
import { collapseRanges } from "../src/network.ts";

test("keeps only ranges nothing else covers", () => {
  const announced = [
    "168.9.213.0/24",
    "168.9.212.0/23",
    "199.119.28.0/22",
    "199.119.31.0/24",
    "199.119.29.0/24",
    "199.119.30.0/24",
    "199.119.28.0/24",
    "168.9.212.0/24",
  ];
  expect(collapseRanges(announced)).toEqual(["168.9.212.0/23", "199.119.28.0/22"]);
});

test("handles single addresses, duplicates and IPv6", () => {
  expect(collapseRanges(["10.0.0.5", "10.0.0.0/8", "10.0.0.0/8"])).toEqual(["10.0.0.0/8"]);
  expect(collapseRanges(["2001:db8::/32", "2001:db8:1::/48", "::1"])).toEqual([
    "2001:db8::/32",
    "::1",
  ]);
  expect(collapseRanges(["10.0.0.0/8", "::/0"])).toEqual(["10.0.0.0/8", "::/0"]);
});

test("leaves text it can't read alone", () => {
  expect(collapseRanges(["AS46830", "10.0.0.0/8"])).toEqual(["AS46830", "10.0.0.0/8"]);
});
