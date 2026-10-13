import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useHotkey } from "@tanstack/react-hotkeys";
import { IconArrowLeft, IconArrowsMaximize } from "@tabler/icons-react";
import { galleryQueryOptions } from "@bogey/db/queries/gallery";
import { Button } from "@bogey/ui/components/button";
import { msg, useT } from "#/lib/translate.tsx";

export const Route = createFileRoute("/gallery/$slug/present")({
  staticData: { title: msg("gallery.slideshow"), command: false },
  component: RouteComponent,
});

function RouteComponent() {
  const t = useT();
  const { slug } = Route.useParams();
  const { data: gallery } = useSuspenseQuery(galleryQueryOptions(slug));
  const projects = gallery?.projects ?? [];
  const [index, setIndex] = useState(0);
  const next = () => setIndex((current) => (current + 1) % Math.max(projects.length, 1));
  const back = () =>
    setIndex((current) => (current - 1 + projects.length) % Math.max(projects.length, 1));
  useHotkey("Space", next);
  useHotkey("ArrowRight", next);
  useHotkey("ArrowLeft", back);
  const project = projects[index];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg text-fg">
      <div className="flex items-center justify-between gap-2 p-3">
        <Button
          size="sm"
          variant="ghost"
          nativeButton={false}
          render={<Link to="/gallery/$slug" params={{ slug }} />}
        >
          <IconArrowLeft />
          {t("gallery.projects")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void document.documentElement.requestFullscreen()}
        >
          <IconArrowsMaximize />
          {t("results.fullScreen")}
        </Button>
      </div>
      <button
        type="button"
        onClick={next}
        aria-label={t("judging.nextProject")}
        className="flex flex-1 items-center justify-center p-8"
      >
        {project ? (
          <div className="flex max-w-4xl flex-col items-center gap-5 text-center" key={project.id}>
            <h1 className="font-heading text-6xl font-semibold">{project.title}</h1>
            {project.teamName && <p className="text-3xl">{project.teamName}</p>}
            {project.blurb && <p className="text-xl text-muted-fg">{project.blurb}</p>}
          </div>
        ) : (
          <p className="text-xl text-muted-fg">{t("gallery.none")}</p>
        )}
      </button>
      <p className="p-3 text-center text-sm text-muted-fg">
        {projects.length > 0 && t("gallery.at", { at: index + 1, total: projects.length })}
      </p>
    </div>
  );
}
