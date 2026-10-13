import { expect, test } from "vite-plus/test";
import { invocation, withInvocation } from "../../src/lib/invocation.ts";
import { present } from "../../src/lib/present.ts";
import { setColor } from "../../src/lib/style.ts";

const COMMANDS = [
  { name: "org" },
  { name: "login" },
  { name: "plugins" },
  { name: "db", subcommands: ["migrate", "status"] },
];

test("it says what the person typed", () => {
  const argv = ["/usr/bin/node", "/repo/tools/cli/src/bin.ts"];
  expect(invocation({ VP_RUN: "1" }, argv, "/repo")).toBe("vpr bogey");
  expect(invocation({ _: "/usr/bin/node" }, argv, "/repo")).toBe("node tools/cli/src/bin.ts");
  expect(invocation({ _: "/usr/local/bin/bogey" }, argv, "/repo")).toBe("bogey");
  expect(invocation({}, argv, "/repo")).toBe("bogey");
  expect(invocation({ VP_RUN: "1", BOGEY_COMMAND: "" }, argv, "/repo")).toBe("");
});

test("directions follow it; program names and other words don't", () => {
  const text = [
    "Sign in: bogey login you@acme.org",
    "Run `bogey db migrate` first.",
    "bogey plugins: no plugin called x",
    "this bogey didn't load it",
    "@bogey/utils",
  ].join("\n");
  expect(withInvocation(text, "vpr bogey", COMMANDS).split("\n")).toEqual([
    "Sign in: vpr bogey login you@acme.org",
    "Run `vpr bogey db migrate` first.",
    "bogey plugins: no plugin called x",
    "this bogey didn't load it",
    "@bogey/utils",
  ]);
  expect(withInvocation(text, "bogey", COMMANDS)).toBe(text);
  expect(withInvocation(text, "", COMMANDS).split("\n").slice(0, 3)).toEqual([
    "Sign in: login you@acme.org",
    "Run `db migrate` first.",
    "bogey plugins: no plugin called x",
  ]);
});

test("presenting leaves the words alone without color", () => {
  setColor(false);
  const output = "✓ Done.\nSign in: bogey login a@b.co";
  expect(present({ exitCode: 0, output }, "vpr bogey", COMMANDS)).toBe(
    "✓ Done.\nSign in: vpr bogey login a@b.co",
  );
});

test("presenting colors directions, marks and failures", () => {
  setColor(true);
  const shown = present(
    { exitCode: 1, output: "It failed.\n  ✗ one\nRun bogey db migrate" },
    "bogey",
    COMMANDS,
  );
  setColor(false);
  const [first, second, third] = shown.split("\n");
  expect(first).toContain("\u001b[31mIt failed.");
  expect(second).toContain("\u001b[31m✗");
  expect(third).toContain("\u001b[36mbogey db migrate\u001b[39m");
});

test("a long failure ends with what failed, and hints for errors it recognizes", () => {
  setColor(false);
  const output = [
    "Missing:",
    "  + table public.votes",
    "",
    "Repair failed and was rolled back. The error:",
    'psql:<stdin>:9: ERROR:  column "round_id" of relation "scores" contains null values',
  ].join("\n");
  const lines = present(
    { exitCode: 1, output },
    "vpr bogey",
    [...COMMANDS, { name: "repair" }],
    "repair",
  ).split("\n");
  expect(lines.at(-1)).toBe("✗ vpr bogey repair failed.");
  expect(lines.some((line) => line.startsWith("hint: A NOT NULL column"))).toBe(true);
});

test("the documented alias names itself", () => {
  expect(
    invocation({ BOGEY_COMMAND: "bogey", _: "/opt/homebrew/bin/node" }, ["node", "bin.ts"]),
  ).toBe("bogey");
});
