import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { Event } from "@bogey/db/queries/events";
import { eventWindowsQueryOptions, isWindowOpen, windowByKey } from "@bogey/db/queries/windows";
import { Button } from "@bogey/ui/components/button";
import { IconLayoutGrid } from "@tabler/icons-react";

export function GalleryLink({ event }: { event: Event }) {
  const windows = useQuery(eventWindowsQueryOptions(event.id));
  const open =
    event.visibility === "public" && isWindowOpen(windowByKey(windows.data ?? [], "gallery"));
  if (!open) return null;
  return (
    <Button
      size="sm"
      variant="outline"
      nativeButton={false}
      render={<Link to="/gallery/$slug" params={{ slug: String(event.slug) }} />}
    >
      <IconLayoutGrid />
      Project gallery
    </Button>
  );
}
