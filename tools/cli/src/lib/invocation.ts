import { basename, relative } from "node:path";
import type { Suggestable } from "./suggest.ts";

export function invocation(
  env: NodeJS.ProcessEnv = process.env,
  argv: Tuple<string> = process.argv,
  cwd: string = process.cwd(),
): string {
  // Set but empty means commands are typed bare, as in the console's Terminal.
  if (env.BOGEY_COMMAND !== undefined) return env.BOGEY_COMMAND;
  if (env.VP_RUN) return "vpr bogey";
  const script = argv[1];
  if (script && /^node(\.exe)?$/.test(basename(env._ ?? ""))) {
    return `node ${relative(cwd, script) || script}`;
  }
  return "bogey";
}

export function withInvocation(text: string, prefix: string, commands: Tuple<Suggestable>): string {
  if (prefix === "bogey") return text;
  const names = [...commands.map((entry) => entry.name), "<command>"]
    .map((name) => name.replace(/[\\<>]/g, "\\$&"))
    .join("|");
  const pattern = new RegExp(`(?<![\\w@/.-])bogey (?=(?:${names})(?![\\w:-]))`, "g");
  return text.replace(pattern, prefix ? `${prefix} ` : "");
}
