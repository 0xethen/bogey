import type {} from "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import {
  HookError,
  sendAuthEmail,
  verifyHook,
  type SendEmailPayload,
} from "#/lib/server/send-email.server.ts";

export const Route = createFileRoute("/api/auth/send-email")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.SEND_EMAIL_HOOK_SECRET;
        const body = await request.text();
        try {
          if (!secret) throw new HookError("SEND_EMAIL_HOOK_SECRET is not set", 500);
          verifyHook(body, request.headers, secret);
          const payload: SendEmailPayload = JSON.parse(body);
          await sendAuthEmail(payload);
          return Response.json({});
        } catch (error) {
          const status = error instanceof HookError ? error.status : 500;
          const message = error instanceof Error ? error.message : "couldn't send the email";
          console.error("[bogey] send-email hook:", message);
          const shown =
            error instanceof HookError && error.userMessage
              ? error.userMessage
              : "We couldn't send the email. Try again in a moment.";
          return Response.json({ error: { http_code: status, message: shown } }, { status });
        }
      },
    },
  },
});
