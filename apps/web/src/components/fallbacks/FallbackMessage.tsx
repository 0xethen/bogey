import { useMatch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { orgQueryOptions } from "@bogey/db/tenant";
import { settingsQueryOptions } from "@bogey/db/queries/settings";
import { Markdown } from "@bogey/ui/components/markdown";

/** The organizers' message (branding.fallbackMessage) for the event or organization being viewed. */
function useFallbackMessage(): string | null {
  const eventId = useMatch({
    from: "/_authed/events/$slug",
    shouldThrow: false,
    select: (match) => (match.status === "success" ? match.context.event.id : undefined),
  });
  const org = useQuery(orgQueryOptions());
  const orgId = org.data?.id;
  const settings = useQuery({
    ...settingsQueryOptions({ orgId, eventId }, ["branding"]),
    enabled: !!orgId || !!eventId,
  });
  return settings.data?.branding.fallbackMessage?.trim() || null;
}

/** Shown under the text of the not-found and error pages; nothing when no message is set. */
export function FallbackMessage() {
  const message = useFallbackMessage();
  if (!message) return null;
  return <Markdown className="w-full text-sm text-muted-fg">{message}</Markdown>;
}
