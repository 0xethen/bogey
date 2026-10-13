import type {} from "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import { sameOrigin } from "#/server/access.ts";
import {
  splitLine,
  startTerminal,
  TERMINAL_FLAG,
  terminalEnabled,
  writeTerminal,
} from "#/server/terminal.server.ts";

function text(status: 200 | 400 | 403 | 404, message: string): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export const Route = createFileRoute("/api/terminal")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!sameOrigin(request)) return text(403, "Not from the console page.");
        if (!terminalEnabled()) return text(403, `The terminal is off. Set ${TERMINAL_FLAG}=1.`);
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return text(400, "Send JSON.");
        }
        const input = typeof body === "object" && body !== null ? body : {};
        if ("session" in input && typeof input.session === "string") {
          const data = "data" in input && typeof input.data === "string" ? input.data : "";
          return writeTerminal(input.session, data)
            ? text(200, "")
            : text(404, "That command has finished.");
        }
        if (!("line" in input) || typeof input.line !== "string")
          return text(400, "Send a line to run.");
        const split = splitLine(input.line);
        if ("error" in split) return text(400, split.error);
        const { id, stream } = startTerminal(split.args, {
          cols: "cols" in input && typeof input.cols === "number" ? input.cols : 80,
          rows: "rows" in input && typeof input.rows === "number" ? input.rows : 24,
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Terminal-Session": id,
          },
        });
      },
    },
  },
});
