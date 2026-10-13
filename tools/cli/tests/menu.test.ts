import { expect, test } from "vite-plus/test";
import type { CliResult } from "../src/cli.ts";
import { argvFor, MENU, runMenu } from "../src/menu.ts";
import { scripted } from "./support/prompter.ts";

function menu(answers: Array<string | boolean>) {
  const { prompter, asked, said } = scripted(answers);
  const ran: string[][] = [];
  const shown: CliResult[] = [];
  const io = {
    prompter,
    prefix: "vpr bogey",
    run: async (argv: string[]) => {
      ran.push(argv);
      return { exitCode: 0, output: `ran ${argv.join(" ")}` };
    },
    show: (result: CliResult) => shown.push(result),
  };
  return { io, asked, said, ran, shown };
}

test("it quits on Quit, and on Esc", async () => {
  const quit = menu(["Quit"]);
  await runMenu(quit.io);
  expect(quit.ran).toEqual([]);
  const escaped = menu([]);
  await runMenu(escaped.io);
  expect(escaped.ran).toEqual([]);
});

test("a choice runs its command and shows what it said", async () => {
  const { io, ran, shown } = menu(["Check this instance", false]);
  await runMenu(io);
  expect(ran).toEqual([["doctor"]]);
  expect(shown).toEqual([{ exitCode: 0, output: "ran doctor" }]);
});

test("each choice shows the command it runs, as the person typed it", async () => {
  let hints: Array<string | undefined> = [];
  const { io } = menu([]);
  const select = io.prompter.select;
  io.prompter.select = (question) => {
    hints = question.options.map((option) => option.hint);
    return select(question);
  };
  await runMenu(io);
  expect(hints).toContain("vpr bogey doctor");
  expect(hints).toContain("vpr bogey org create");
  expect(hints).toContain("vpr bogey backup ...");
});

test("after a command it asks whether to go back to the menu, and quits by default", async () => {
  const { io, ran, asked } = menu(["Check this instance", true, "Check this instance", false]);
  await runMenu(io);
  expect(ran).toEqual([["doctor"], ["doctor"]]);
  expect(asked.filter((message) => message === "Back to the main menu?")).toHaveLength(2);
});

test("commands that ask for themselves run bare", async () => {
  const { io, ran } = menu(["Create the first organization", false]);
  await runMenu(io);
  expect(ran).toEqual([["org", "init"]]);
});

test("questions become flags, and a blank optional one is left out", async () => {
  const { io, ran } = menu(["Back up", "postgres://x", true, "Back up", "", false]);
  await runMenu(io);
  expect(ran).toEqual([["backup", "--db-url", "postgres://x"], ["backup"]]);
});

test("a plugin spec is positional", async () => {
  const { io, ran } = menu(["Install a plugin", "github:a/b/c@1.0.0", false]);
  await runMenu(io);
  expect(ran).toEqual([["plugins", "add", "github:a/b/c@1.0.0"]]);
});

test("stopping the app asks first", async () => {
  const declined = menu(["Stop the app", false, "Quit"]);
  await runMenu(declined.io);
  expect(declined.ran).toEqual([]);
  const confirmed = menu(["Stop the app", true, false]);
  await runMenu(confirmed.io);
  expect(confirmed.ran).toEqual([["stop"]]);
});

test("argvFor builds the argument list on its own", async () => {
  const entry = MENU.find((candidate) => candidate.label === "Upgrade Bogey");
  if (!entry) throw new Error("no upgrade entry");
  expect(await argvFor(entry, { text: async () => "postgres://x" })).toEqual([
    "upgrade",
    "--db-url",
    "postgres://x",
  ]);
});
