import { Link } from "@tanstack/react-router";
import { IconMessageCircle, IconTrophy } from "@tabler/icons-react";
import type { GalleryEngagement, GalleryProject, Gallery } from "@bogey/db/queries/gallery";
import { Badge } from "@bogey/ui/components/badge";
import { cn } from "@bogey/ui/lib/utils";
import { VoteButton } from "#/components/event/judging/vote-button.tsx";
import { bannerGradient, placeKey } from "#/lib/gallery.ts";
import { useT } from "#/lib/translate.tsx";
import { LikeButton } from "./likes.tsx";

const BANNER_SHAPE = {
  compact: "aspect-[16/6]",
  standard: "aspect-[16/9]",
  large: "aspect-[4/3]",
} as const satisfies Record<GalleryProject["cardSize"], string>;

export function WinnerBadges({
  project,
  className,
}: {
  project: GalleryProject;
  className?: string;
}) {
  const t = useT();
  if (project.wins.length === 0) return null;
  return (
    <span className={cn("flex flex-wrap gap-1", className)}>
      {project.wins.map((win) => {
        const place = placeKey(win.place);
        return (
          <Badge key={`${win.label}-${win.place}`} className="bg-warning text-warning-fg">
            <IconTrophy />
            {place ? `${t(place)} · ${win.label}` : win.label}
          </Badge>
        );
      })}
    </span>
  );
}

export function Banner({
  project,
  className,
}: {
  project: Pick<GalleryProject, "id" | "bannerUrl" | "cardSize">;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "relative w-full overflow-hidden bg-muted",
        BANNER_SHAPE[project.cardSize],
        className,
      )}
      style={project.bannerUrl ? undefined : { backgroundImage: bannerGradient(project.id) }}
    >
      {project.bannerUrl && (
        <img
          src={project.bannerUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
        />
      )}
    </div>
  );
}

export function ProjectCard({
  gallery,
  project,
  tracks,
  engagement,
}: {
  gallery: Gallery;
  project: GalleryProject;
  tracks: Tuple<{ id: string; name: string }>;
  engagement: GalleryEngagement | undefined;
}) {
  const t = useT();
  const { settings } = gallery;
  const banner = settings.banners;
  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-fg">
      <Link
        to="/gallery/$slug/$projectId"
        params={{ slug: gallery.event.slug, projectId: project.id }}
        className="group flex flex-col no-underline"
      >
        {banner && (
          <div className="relative">
            <Banner
              project={project}
              className="transition-transform duration-300 group-hover:scale-[1.02] motion-reduce:transition-none"
            />
            <WinnerBadges project={project} className="absolute top-2 left-2" />
          </div>
        )}
        <div className="flex flex-col gap-1.5 p-4">
          {!banner && <WinnerBadges project={project} />}
          {project.teamName && (
            <span className="text-xs font-medium text-muted-fg">{project.teamName}</span>
          )}
          <h3 className="font-heading text-base font-medium tracking-tight text-fg">
            {project.title}
          </h3>
          {project.blurb && (
            <p
              className={cn(
                "text-sm text-muted-fg",
                project.cardSize === "compact" ? "line-clamp-2" : "line-clamp-4",
              )}
            >
              {project.blurb}
            </p>
          )}
          {tracks.length > 0 && (
            <span className="flex flex-wrap gap-1.5 pt-1">
              {tracks.map((track) => (
                <Badge key={track.id} variant="secondary">
                  {track.name}
                </Badge>
              ))}
            </span>
          )}
        </div>
      </Link>
      <div className="mt-auto flex flex-wrap items-center gap-1 px-2 pb-2">
        <VoteButton eventId={gallery.event.id} submissionId={project.id} />
        {settings.likes && (
          <LikeButton
            eventId={gallery.event.id}
            submissionId={project.id}
            count={engagement?.likes ?? 0}
          />
        )}
        {settings.comments && (
          <Link
            to="/gallery/$slug/$projectId"
            params={{ slug: gallery.event.slug, projectId: project.id }}
            hash="comments-heading"
            aria-label={t("gallery.commentCount", { count: engagement?.comments ?? 0 })}
            className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm text-muted-fg no-underline hover:text-fg"
          >
            <IconMessageCircle className="size-4" />
            <span className="tabular-nums">{engagement?.comments ?? 0}</span>
          </Link>
        )}
      </div>
    </article>
  );
}
