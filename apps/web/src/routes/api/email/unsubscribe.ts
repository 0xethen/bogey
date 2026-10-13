import type {} from "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import { NOTIFICATION_KINDS, isNotificationKind } from "@bogey/config/notifications";
import {
  drainSecret,
  readUnsubscribeToken,
  unsubscribe,
} from "#/lib/server/email-outbox.server.ts";

const PAGE = (message: string) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5"><p>${message}</p>`;

const HTML = { "Content-Type": "text/html; charset=utf-8" };

async function handle(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const parsed = readUnsubscribeToken(await drainSecret(), token);
  if (!parsed) {
    return new Response(PAGE("This unsubscribe link isn't valid."), { status: 400, headers: HTML });
  }
  await unsubscribe(parsed.userId, parsed.kind);
  const what = isNotificationKind(parsed.kind)
    ? NOTIFICATION_KINDS[parsed.kind].label.toLowerCase()
    : "these";
  return new Response(
    PAGE(
      `You won't get emails for ${what} anymore. You can change this any time in Account → Notifications.`,
    ),
    { headers: HTML },
  );
}

export const Route = createFileRoute("/api/email/unsubscribe")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
