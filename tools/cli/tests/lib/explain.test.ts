import { expect, test } from "vite-plus/test";
import { explain } from "../../src/lib/explain.ts";

test("a database without TLS is told to turn it off, not on", () => {
  const said = explain("tls error (The server does not support SSL connections)").join("\n");
  expect(said).toContain("sslmode=disable");
  expect(said).not.toContain("sslmode=require");
});

test("other encryption trouble is told to require it", () => {
  expect(explain("SSL SYSCALL error: EOF detected").join("\n")).toContain("sslmode=require");
});
