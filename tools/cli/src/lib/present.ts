import { explain } from "./explain.ts";
import { withInvocation } from "./invocation.ts";
import { accent, bad, bold, dim, good, warn } from "./style.ts";
import type { Suggestable } from "./suggest.ts";
import type { CliResult } from "../cli.ts";

export function present(
  result: CliResult,
  prefix: string,
  commands: Tuple<Suggestable>,
  command?: string,
): string {
  const failed = result.exitCode !== 0;
  const hints = failed ? explain(result.output) : [];
  const lines = result.output.split("\n");
  const ending = [
    ...(hints.length ? ["", ...hints.map((hint) => `hint: ${hint}`)] : []),
    ...(failed && command && lines.length > 4 ? ["", `✗ bogey ${command} failed.`] : []),
  ];
  const names = commands.map((entry) => entry.name).join("|");
  const text = withInvocation([...lines, ...ending].join("\n"), prefix, commands);
  const words = commands.map((entry) =>
    entry.subcommands?.length
      ? `${escape(entry.name)}(?: (?:${entry.subcommands.map(escape).join("|")})(?![\\w:-]))?`
      : escape(entry.name),
  );
  // Without a prefix, directions are bare command names, which are too common as words to color.
  const direction = new RegExp(
    `${prefix ? `${escape(prefix)} ` : "(?!)"}(?:${words.join("|")}|<command>)(?![\\w:-])`,
    "g",
  );
  const listed = new RegExp(`(?<=^  )(${names})(?=\\s{2,})`);
  const banner = lines.length + ending.length - 1;
  return text
    .split("\n")
    .map((line, index) => {
      if (failed && index === banner && ending.length && line.startsWith("✗")) {
        return bold(bad(line));
      }
      const heading = /^[A-Z][\w ]{0,40}:$/.test(line);
      if (index === 0 && failed && !heading) return bad(line);
      if (failed && /^(psql:\S*\s)?(ERROR|FATAL|error):/.test(line.trim())) return bad(line);
      const marked = line
        .replace(/✓/g, good("✓"))
        .replace(/✗/g, bad("✗"))
        .replace(/^(\s+)\+ /, (_, space: string) => `${space}${good("+")} `)
        .replace(/^(\s+)! /, (_, space: string) => `${space}${warn("!")} `)
        .replace(
          /^(\s+)(in:|LINE \d+:)/,
          (_, space: string, word: string) => `${space}${dim(word)}`,
        )
        .replace(
          /^(\s*)(warning|note|hint):/i,
          (_, space: string, word: string) => `${space}${warn(`${word}:`)}`,
        )
        .replace(direction, (match) => accent(match));
      if (listed.test(line)) return line.replace(listed, (_, name: string) => accent(name));
      return heading ? bold(marked) : marked;
    })
    .join("\n");
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
