import { expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { run } from "../src/cli.ts";
import type { Runner } from "../src/lib/migrations.ts";
import { scripted } from "./support/prompter.ts";

test("run with no command prints usage and exits 0", async () => {
  const result = await run([]);
  expect(result.exitCode).toBe(0);
  expect(result.output).toContain("bogey");
});

const tagged =
  (tags: string[]): Runner =>
  (_command, args) =>
    args.includes("ls-remote") || args.includes("tag")
      ? { status: 0, stdout: tags.map((tag) => `abc\trefs/tags/${tag}`).join("\n"), stderr: "" }
      : { status: 1, stdout: "", stderr: "" };

const version = () =>
  (
    JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf-8")) as {
      version: string;
    }
  ).version;

test("an unknown command exits 1 without the whole usage", async () => {
  const result = await run(["not-a-real-command"], process.cwd(), null, tagged([]));
  expect(result.exitCode).toBe(1);
  expect(result.output).toBe(
    'bogey: unknown command "not-a-real-command". bogey --help lists the commands.',
  );
});

test("a subcommand typed without its command suggests the command, keeping its arguments", async () => {
  const result = await run(["migrate", "--dry-run"], process.cwd(), null, tagged([]));
  expect(result.output).toContain("Did you mean one of these?");
  expect(result.output).toContain("bogey db migrate --dry-run");
  expect(result.output).toContain("bogey plugins migrate --dry-run");
});

test("a misspelled command suggests the one it's close to", async () => {
  const result = await run(["upgarde"], process.cwd(), null, tagged([]));
  expect(result.output).toBe('bogey: unknown command "upgarde". Did you mean bogey upgrade?');
});

test("with nothing close, a newer release is mentioned", async () => {
  const result = await run(["frobnicate"], process.cwd(), null, tagged(["v999.0.0"]));
  expect(result.output).toContain(`This Bogey is ${version()} and the latest is 999.0.0`);
  expect(result.output).toContain("bogey upgrade brings it up to date.");
});

test("with someone to ask, it offers to upgrade", async () => {
  const { prompter, asked } = scripted([false]);
  const result = await run(["frobnicate"], process.cwd(), prompter, tagged(["v999.0.0"]));
  expect(asked).toEqual(["Upgrade to 999.0.0 now?"]);
  expect(result.exitCode).toBe(1);
});

test("an unknown db subcommand suggests the close one", async () => {
  const result = await run(["db", "migrat"], process.cwd(), null, tagged([]));
  expect(result.output).toBe(
    'bogey db: unknown subcommand "migrat". Did you mean bogey db migrate?',
  );
});

test("--help after a subcommand explains it instead of running it", async () => {
  const ran: string[][] = [];
  const runner: Runner = (_command, args) => {
    ran.push(args);
    return { status: 0, stdout: "", stderr: "" };
  };
  for (const argv of [
    ["plugins", "migrate", "--help"],
    ["db", "repair", "-h"],
  ]) {
    const result = await run(argv, process.cwd(), null, runner);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain(`bogey ${argv[0]}`);
  }
  expect(ran).toEqual([]);
});
