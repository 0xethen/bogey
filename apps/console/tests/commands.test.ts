import { describe, expect, it } from "vite-plus/test";
import { COMMANDS as CLI } from "bogey-cli/src/commands.ts";
import { COMMANDS, commandArgs, findCommand, NOT_IN_CONSOLE } from "#/server/commands.ts";

describe("the console's commands", () => {
  it("only names CLI commands and subcommands that exist", () => {
    for (const command of COMMANDS) {
      const [name, sub] = command.cli;
      const cli = CLI.find((each) => each.name === name);
      expect(cli, command.id).toBeDefined();
      if (cli?.subcommands) expect(cli.subcommands, command.id).toContain(sub);
    }
  });

  it("covers every CLI command, or says why not", () => {
    const covered = (words: Tuple<string>) =>
      NOT_IN_CONSOLE[words.join(" ")] !== undefined ||
      COMMANDS.some((command) => words.every((word, index) => command.cli[index] === word));
    const missing = CLI.flatMap((command) =>
      NOT_IN_CONSOLE[command.name] !== undefined
        ? []
        : command.subcommands
          ? command.subcommands
              .filter((sub) => !covered([command.name, sub]))
              .map((sub) => `${command.name} ${sub}`)
          : covered([command.name])
            ? []
            : [command.name],
    );
    expect(missing).toEqual([]);
  });

  it("has unique ids", () => {
    expect(new Set(COMMANDS.map((command) => command.id)).size).toBe(COMMANDS.length);
  });
});

describe("commandArgs", () => {
  const plugins = ["challenges"];

  it("puts positional values before flags, then the step's arguments", () => {
    const command = findCommand("plugins-remove");
    if (!command) throw new Error("no plugins-remove");
    expect(commandArgs(command, { key: "challenges" }, plugins, "preview")).toEqual({
      args: ["plugins", "remove", "challenges", "--dry-run"],
    });
    expect(commandArgs(command, { key: "challenges" }, plugins, "apply")).toEqual({
      args: ["plugins", "remove", "challenges", "--yes"],
    });
  });

  it("passes switches only when on and skips empty optional values", () => {
    const command = findCommand("restart");
    if (!command) throw new Error("no restart");
    expect(commandArgs(command, { service: "", build: false }, plugins)).toEqual({
      args: ["restart"],
    });
    expect(commandArgs(command, { service: "web", build: true }, plugins)).toEqual({
      args: ["restart", "web", "--build"],
    });
  });

  it("refuses values that could be read as flags or aren't on the list", () => {
    const login = findCommand("login");
    const enable = findCommand("plugins-enable");
    const restart = findCommand("restart");
    if (!login || !enable || !restart) throw new Error("missing commands");
    expect(commandArgs(login, { email: "--create" }, plugins)).toHaveProperty("problems");
    expect(commandArgs(login, {}, plugins)).toHaveProperty("problems");
    expect(commandArgs(enable, { key: "not-here" }, plugins)).toHaveProperty("problems");
    expect(commandArgs(restart, { service: "db" }, plugins)).toHaveProperty("problems");
  });

  it("keeps folders inside plain paths", () => {
    const backup = findCommand("backup");
    if (!backup) throw new Error("no backup");
    expect(commandArgs(backup, { out: "backups/today" }, plugins)).toEqual({
      args: ["backup", "--out", "backups/today"],
    });
    expect(commandArgs(backup, { out: "../elsewhere" }, plugins)).toHaveProperty("problems");
    expect(commandArgs(backup, { out: "-rf" }, plugins)).toHaveProperty("problems");
  });
});
