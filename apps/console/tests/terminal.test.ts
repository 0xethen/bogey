import { describe, expect, it } from "vite-plus/test";
import { splitLine } from "#/server/terminal.server.ts";

describe("splitLine", () => {
  it("drops a leading bogey and splits on spaces", () => {
    expect(splitLine("bogey  db status ")).toEqual({ args: ["db", "status"] });
    expect(splitLine("doctor --remote")).toEqual({ args: ["doctor", "--remote"] });
  });

  it("keeps quoted words together", () => {
    expect(splitLine(`org create --name "Acme Hack Club" --owner 'a@b.co'`)).toEqual({
      args: ["org", "create", "--name", "Acme Hack Club", "--owner", "a@b.co"],
    });
    expect(splitLine(`x "" y`)).toEqual({ args: ["x", "", "y"] });
  });

  it("refuses an unclosed quote", () => {
    expect(splitLine(`org create --name "Acme`)).toEqual({ error: 'Close the " quote.' });
  });
});
