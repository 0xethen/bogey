import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { readEnv } from "../../src/lib/credentials.ts";

test(".env values read the way dotenv reads them", () => {
  const path = join(mkdtempSync(join(tmpdir(), "bogey-env-")), ".env");
  writeFileSync(
    path,
    [
      "﻿PLAIN=one",
      "export EXPORTED=two",
      'QUOTED="three # not a comment"',
      "COMMENTED=four # a comment",
      "HASH=fi#ve",
      "CRLF=six\r",
      "MISMATCHED=\"seven'",
      "# SKIPPED=eight",
      "EMPTY=",
    ].join("\n"),
  );
  expect(readEnv(path)).toEqual({
    PLAIN: "one",
    EXPORTED: "two",
    QUOTED: "three # not a comment",
    COMMENTED: "four",
    HASH: "fi#ve",
    CRLF: "six",
    MISMATCHED: "\"seven'",
    EMPTY: "",
  });
});
