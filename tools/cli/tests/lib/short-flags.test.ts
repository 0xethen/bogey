import { expect, test } from "vite-plus/test";
import { run } from "../../src/cli.ts";
import { expandShortFlags, withShortFlags } from "../../src/lib/short-flags.ts";

test("short flags become their long ones, bundled or not", () => {
  expect(expandShortFlags(["db", "repair", "-y", "-d", "postgres://x"])).toEqual([
    "db",
    "repair",
    "--yes",
    "--db-url",
    "postgres://x",
  ]);
  expect(expandShortFlags(["plugins", "add", "-yf"])).toEqual([
    "plugins",
    "add",
    "--yes",
    "--force",
  ]);
});

test("words that aren't known short flags reach the command as typed", () => {
  expect(expandShortFlags(["event", "--shift-days", "-3", "-x", "-yx", "--yes"])).toEqual([
    "event",
    "--shift-days",
    "-3",
    "-x",
    "-yx",
    "--yes",
  ]);
});

test("-h is --help, for the CLI and for each command", async () => {
  expect(await run(["-h"])).toEqual(await run(["--help"]));
  expect(await run(["doctor", "-h"])).toEqual(await run(["doctor", "--help"]));
});

test("a command's help names the short flags it takes", () => {
  expect(withShortFlags("bogey thing [--yes] [--db-url <url>]")).toContain(
    "Short flags: -y --yes, -d --db-url",
  );
  expect(withShortFlags("bogey thing <name>")).toBe("bogey thing <name>");
});
