import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useHotkey } from "@tanstack/react-hotkeys";
import {
  IconArrowLeft,
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconChevronLeft,
  IconChevronRight,
  IconPlayerPause,
  IconPlayerPlay,
  IconReload,
  IconSettings,
} from "@tabler/icons-react";
import { galleryQueryOptions, type GalleryProject } from "@bogey/db/queries/gallery";
import { Button } from "@bogey/ui/components/button";
import {
  Drawer,
  DrawerContent,
  // DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@bogey/ui/components/drawer";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { Slider } from "@bogey/ui/components/slider";
import { Switch } from "@bogey/ui/components/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bogey/ui/components/tooltip";
import { cn } from "@bogey/ui/lib/utils";
import { availableSorts, GALLERY_SORTS, gallerySearch, sortProjects } from "#/lib/gallery.ts";
import { SHOW_DEFAULTS, useShuffleSeed, useSlideshowSettings } from "#/lib/slideshow.ts";
import { msg, useT } from "#/lib/translate.tsx";
import { WinnerBadges } from "#/routes/gallery/$slug/-components/project-card.tsx";

export const Route = createFileRoute("/gallery/$slug/present")({
  staticData: { title: msg("gallery.slideshow"), command: false },
  validateSearch: gallerySearch,
  component: RouteComponent,
});

function RouteComponent() {
  const t = useT();
  const { slug } = Route.useParams();
  const filter = Route.useSearch();
  const { data: gallery } = useSuspenseQuery(galleryQueryOptions(slug));
  const [settings, change] = useSlideshowSettings();
  const seed = useShuffleSeed();
  const [index, setIndex] = useState(0);
  // until play or pause is pressed, the autoplay setting decides
  const [started, setStarted] = useState<boolean | null>(null);
  const requested = started ?? settings.autoplay;
  const [open, setOpen] = useState(false);
  const [awake, setAwake] = useState(true);
  const [full, setFull] = useState(false);

  const projects = useMemo((): GalleryProject[] => {
    if (!gallery) return [];
    const sorts = availableSorts(gallery.settings, gallery.projects, { votes: new Map() });
    const wanted = settings.sort ?? filter.sort ?? gallery.settings.sort;
    const sort = sorts.includes(wanted) ? wanted : "newest";
    return sortProjects(
      gallery.projects.filter(
        (project) =>
          (!filter.form || project.formId === filter.form) &&
          (!filter.track || project.trackIds.includes(filter.track)) &&
          (!filter.division || project.divisionId === filter.division),
      ),
      sort,
      { engagement: new Map(), votes: new Map(), seed },
    );
  }, [gallery, filter.form, filter.track, filter.division, filter.sort, settings.sort, seed]);

  const last = projects.length - 1;
  const at = Math.min(index, Math.max(last, 0));
  const atEnd = at >= last;
  // reaching the last project without a loop stops the show
  const playing = requested && !(atEnd && !settings.loop);
  const project = projects[at];

  const go = useCallback(
    (to: number) => {
      if (projects.length === 0) return;
      setIndex(
        settings.loop
          ? (to + projects.length) % projects.length
          : Math.min(Math.max(to, 0), projects.length - 1),
      );
    },
    [projects.length, settings.loop],
  );
  const next = useCallback(() => go(at + 1), [go, at]);
  const back = useCallback(() => go(at - 1), [go, at]);
  const toggle = useCallback(() => {
    if (!playing && atEnd && !settings.loop) setIndex(0);
    setStarted(!playing);
  }, [playing, atEnd, settings.loop]);

  // advance while playing; without a loop it stops on the last project
  useEffect(() => {
    if (!playing || projects.length === 0) return;
    const timer = window.setTimeout(next, settings.seconds * 1000);
    return () => window.clearTimeout(timer);
  }, [playing, at, settings.seconds, projects.length, next]);

  // the controls fade out once the pointer and keys have been still
  useEffect(() => {
    if (!awake || open) return;
    const timer = window.setTimeout(() => setAwake(false), 3000);
    return () => window.clearTimeout(timer);
  }, [awake, open]);
  useEffect(() => {
    const wake = () => setAwake(true);
    window.addEventListener("pointermove", wake);
    window.addEventListener("keydown", wake);
    return () => {
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("keydown", wake);
    };
  }, []);
  useEffect(() => {
    const sync = () => setFull(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const fullscreen = () =>
    void (document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen());

  useHotkey("ArrowRight", next);
  useHotkey("ArrowLeft", back);
  useHotkey("Space", toggle);
  useHotkey("F", fullscreen);

  const chrome = cn(
    "transition-opacity duration-300 motion-reduce:transition-none",
    !awake && !open && "pointer-events-none opacity-0",
  );
  const sorts = gallery
    ? availableSorts(gallery.settings, gallery.projects, { votes: new Map() })
    : [];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg text-fg">
      <div
        className={cn(
          "absolute inset-x-0 top-0 z-10 flex items-center justify-between p-3",
          chrome,
        )}
      >
        <Tip label={t("gallery.backToProjects")}>
          <Button
            size="icon-sm"
            variant="ghost"
            nativeButton={false}
            aria-label={t("gallery.backToProjects")}
            render={<Link to="/gallery/$slug" params={{ slug }} search={filter} />}
          >
            <IconArrowLeft />
          </Button>
        </Tip>
        <Tip label={t("gallery.showSettings")}>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("gallery.showSettings")}
            onClick={() => setOpen(true)}
          >
            <IconSettings />
          </Button>
        </Tip>
      </div>

      <main
        className="flex flex-1 items-center justify-center overflow-y-auto p-8"
        aria-live="polite"
      >
        {project ? (
          <div
            key={project.id}
            className="flex max-w-4xl flex-col items-center gap-5 text-center animate-in fade-in duration-300 motion-reduce:animate-none"
          >
            {settings.banner && project.bannerUrl && (
              <img
                src={project.bannerUrl}
                alt=""
                className="max-h-[45vh] w-auto max-w-full rounded-2xl object-contain"
              />
            )}
            {settings.winners && <WinnerBadges project={project} className="justify-center" />}
            <h1 className="font-heading text-5xl font-semibold text-balance sm:text-6xl">
              {project.title}
            </h1>
            {settings.team && project.teamName && <p className="text-2xl">{project.teamName}</p>}
            {settings.blurb && project.blurb && (
              <p className="max-w-3xl text-lg text-muted-fg">{project.blurb}</p>
            )}
          </div>
        ) : (
          <p className="text-xl text-muted-fg">{t("gallery.none")}</p>
        )}
      </main>

      {settings.progress && playing && project && (
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-transparent" aria-hidden>
          <div
            key={`${project.id}-${settings.seconds}`}
            className="h-full origin-left bg-primary motion-reduce:hidden"
            style={{ animation: `bogey-progress ${settings.seconds}s linear forwards` }}
          />
        </div>
      )}
      <style>{"@keyframes bogey-progress{from{transform:scaleX(0)}to{transform:scaleX(1)}}"}</style>

      <div className={cn("absolute inset-x-0 bottom-4 z-10 flex justify-center", chrome)}>
        <div className="flex items-center gap-1 rounded-pill border border-border bg-card/90 px-2 py-1 shadow-sm backdrop-blur">
          <Tip label={t("gallery.previous")}>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t("gallery.previous")}
              disabled={!settings.loop && at === 0}
              onClick={back}
            >
              <IconChevronLeft />
            </Button>
          </Tip>
          <Tip
            label={
              playing
                ? t("gallery.pause")
                : atEnd && !settings.loop
                  ? t("gallery.replay")
                  : t("gallery.play")
            }
          >
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={playing ? t("gallery.pause") : t("gallery.play")}
              disabled={projects.length === 0}
              onClick={toggle}
            >
              {playing ? (
                <IconPlayerPause />
              ) : atEnd && !settings.loop && projects.length > 1 ? (
                <IconReload />
              ) : (
                <IconPlayerPlay />
              )}
            </Button>
          </Tip>
          <Tip label={t("judging.nextProject")}>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t("judging.nextProject")}
              disabled={!settings.loop && atEnd}
              onClick={next}
            >
              <IconChevronRight />
            </Button>
          </Tip>
          {settings.counter && projects.length > 0 && (
            <span className="px-2 text-sm text-muted-fg tabular-nums">
              {t("gallery.at", { at: at + 1, total: projects.length })}
            </span>
          )}
          <Tip label={full ? t("gallery.exitFullScreen") : t("results.fullScreen")}>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={full ? t("gallery.exitFullScreen") : t("results.fullScreen")}
              onClick={fullscreen}
            >
              {full ? <IconArrowsMinimize /> : <IconArrowsMaximize />}
            </Button>
          </Tip>
        </div>
      </div>

      <Drawer open={open} onOpenChange={setOpen} swipeDirection="right">
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{t("gallery.slideshowSettings")}</DrawerTitle>
            {/* <DrawerDescription>{t("gallery.slideshowSettingsHelp")}</DrawerDescription> */}
          </DrawerHeader>
          <div className="flex flex-col gap-5 overflow-y-auto p-4 pt-0">
            <Row label={t("gallery.showFor", { seconds: settings.seconds })}>
              <Slider
                min={3}
                max={60}
                step={1}
                value={[settings.seconds]}
                aria-label={t("gallery.showSeconds")}
                onValueChange={(value) =>
                  change({
                    seconds: Array.isArray(value) ? (value[0] ?? SHOW_DEFAULTS.seconds) : value,
                  })
                }
              />
            </Row>
            <Row label={t("gallery.order")}>
              <OptSelect
                ariaLabel={t("gallery.order")}
                value={settings.sort ?? filter.sort ?? gallery?.settings.sort ?? "newest"}
                options={GALLERY_SORTS.filter((each) => sorts.includes(each.key)).map((each) => ({
                  value: each.key,
                  label: t(each.label),
                }))}
                onChange={(sort) => {
                  change({ sort });
                  setIndex(0);
                }}
              />
            </Row>
            <Toggle
              label={t("gallery.loop")}
              checked={settings.loop}
              onChange={(loop) => change({ loop })}
            />
            <Toggle
              label={t("gallery.autoplay")}
              checked={settings.autoplay}
              onChange={(autoplay) => change({ autoplay })}
            />
            <p className="-mb-2 text-sm font-medium">{t("gallery.onSlides")}</p>
            <Toggle
              label={t("gallery.slideBanner")}
              checked={settings.banner}
              onChange={(banner) => change({ banner })}
            />
            <Toggle
              label={t("gallery.slideTeam")}
              checked={settings.team}
              onChange={(team) => change({ team })}
            />
            <Toggle
              label={t("gallery.slideBlurb")}
              checked={settings.blurb}
              onChange={(blurb) => change({ blurb })}
            />
            <Toggle
              label={t("gallery.slideWinners")}
              checked={settings.winners}
              onChange={(winners) => change({ winners })}
            />
            <Toggle
              label={t("gallery.slideCounter")}
              checked={settings.counter}
              onChange={(counter) => change({ counter })}
            />
            <Toggle
              label={t("gallery.slideProgress")}
              checked={settings.progress}
              onChange={(progress) => change({ progress })}
            />
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      {label}
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </label>
  );
}
