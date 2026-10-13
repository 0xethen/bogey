import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createServerFn } from "@tanstack/react-start";
import { pluginKeys } from "#/server/process.server.ts";
import { terminalEnabled } from "#/server/terminal.server.ts";

export const consoleInfo = createServerFn({ method: "GET" }).handler(() => {
  const root = process.env.BOGEY_ROOT ?? process.cwd();
  let version: string | null = null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
    if (typeof parsed === "object" && parsed !== null && "version" in parsed) {
      version = typeof parsed.version === "string" ? parsed.version : null;
    }
  } catch {
    version = null;
  }
  return { version, root, plugins: pluginKeys(), terminal: terminalEnabled() };
});
