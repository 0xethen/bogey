import type {} from "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import { sameOrigin } from "#/server/access.ts";
import { commandArgs, findCommand, isLogService, type ParamValues } from "#/server/commands.ts";
import {
  cliInvocation,
  logInvocation,
  pluginKeys,
  streamProcess,
} from "#/server/process.server.ts";

function text(status: 400 | 403, message: string): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

const STREAM = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "no-store",
} as const;

function valuesOf(input: object): ParamValues {
  if (!("values" in input) || typeof input.values !== "object" || input.values === null) return {};
  return Object.fromEntries(
    Object.entries(input.values).filter(
      (entry): entry is [string, string | boolean] =>
        typeof entry[1] === "string" || typeof entry[1] === "boolean",
    ),
  );
}

export const Route = createFileRoute("/api/run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!sameOrigin(request)) return text(403, "Not from the console page.");
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return text(400, "Send JSON.");
        }
        const input = typeof body === "object" && body !== null ? body : {};
        if ("logs" in input) {
          if (!isLogService(input.logs))
            return text(400, "That service isn't one the console can read.");
          const lines = "lines" in input && typeof input.lines === "number" ? input.lines : 200;
          const { program, args, cwd } = logInvocation(input.logs, lines);
          return new Response(streamProcess(program, args, cwd), { headers: STREAM });
        }
        const command = "command" in input ? findCommand(input.command) : undefined;
        if (!command) return text(400, "That isn't a command the console runs.");
        const step = "step" in input && input.step === "preview" ? "preview" : "apply";
        const built = commandArgs(command, valuesOf(input), pluginKeys(), step);
        if ("problems" in built) return text(400, built.problems.join("\n"));
        const { program, args, cwd } = cliInvocation(built.args);
        return new Response(streamProcess(program, args, cwd), { headers: STREAM });
      },
    },
  },
});
