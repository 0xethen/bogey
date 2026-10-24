import { useEffect, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useHotkey } from "@tanstack/react-hotkeys";
import {
  IconArrowLeft,
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconChevronLeft,
  IconPlayerPlay,
  IconPlayerTrackNext,
  IconRotateClockwise,
  IconSettings,
} from "@tabler/icons-react";
import { can, useCan } from "@bogey/db/permissions";
import { unwrap } from "@bogey/db/errors";
import { useLiveInvalidate } from "@bogey/db/realtime";
import {
  panelPresentationQueryOptions,
  setPanelNowFn,
  type PresentationSlot,
} from "@bogey/db/queries/demos";
import { formatTime } from "@bogey/utils/time";
import { Badge } from "@bogey/ui/components/badge";
import { Button } from "@bogey/ui/components/button";
import { Countdown } from "@bogey/ui/components/countdown";
import {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerSection,
  DrawerTitle,
} from "@bogey/ui/components/drawer";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@bogey/ui/components/empty";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Slider } from "@bogey/ui/components/slider";
import { Switch } from "@bogey/ui/components/switch";
import { useNow } from "@bogey/ui/hooks/now";
import { cn } from "@bogey/ui/lib/utils";
import {
  DEMO_SCREEN_DEFAULTS,
  useDemoScreenSettings,
  type DemoScreenSettings,
} from "#/lib/demo-screen.ts";
import { useViewerTimeFormat } from "#/lib/time.ts";
import { msg, useT } from "#/lib/translate.tsx";

// The screen a demo room puts up: who's presenting, their slot's timer, and who's next.
export const Route = createFileRoute("/_authed/events/$slug/demos/$panelId")({
  staticData: { title: msg("present.title"), command: false },
  beforeLoad: ({ context, params }) => {
    if (!can(context.access, "judging.score") && !can(context.access, "event.manage")) {
      throw Route.redirect({ to: "/events/$slug", params: { slug: params.slug }, replace: true });
    }
  },
  loader: ({ context, params }) =>
    context.query.query({ ...panelPresentationQueryOptions(params.panelId), staleTime: "static" }),
  component: RouteComponent,
});

function RouteComponent() {
  const t = useT();
  const { panelId } = Route.useParams();
  const { event } = Route.useRouteContext();
  const manages = useCan("event.manage");
  const options = panelPresentationQueryOptions(panelId);
  const { data: panel } = useSuspenseQuery({ ...options, refetchInterval: 15_000 });
  useLiveInvalidate("judging_panels", options.queryKey, { filter: `id=eq.${panelId}` });
  const queryClient = useQueryClient();
  const [settings, change] = useDemoScreenSettings();
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(false);
  const time = useViewerTimeFormat();
  const now = useNow(250);

  const setNow = useMutation({
    mutationFn: async (position: number | null) =>
      unwrap(await setPanelNowFn({ data: { panelId, position } })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: options.queryKey }),
  });

  useEffect(() => {
    const sync = () => setFull(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const fullscreen = () =>
    void (document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen());

  const total = panel.slots.length;
  const at = panel.nowPosition;
  const current = at === null ? null : (panel.slots.find((slot) => slot.position === at) ?? null);
  const done = at !== null && at >= total;
  const shown = current ?? (at === null ? (panel.slots[0] ?? null) : null);
  const upcoming = panel.slots.filter((slot) => slot.position > (at ?? -1));
  const busy = setNow.isPending || !panel.canAdvance;

  const advance = () => {
    if (busy || done || total === 0) return;
    setNow.mutate(at === null ? 0 : at + 1);
  };
  const back = () => {
    if (busy || at === null || at <= 0) return;
    setNow.mutate(Math.min(at, total) - 1);
  };
  const restart = () => {
    if (busy || current === null) return;
    setNow.mutate(current.position);
  };
  useHotkey("ArrowRight", advance);
  useHotkey("ArrowLeft", back);
  useHotkey("R", restart);
  useHotkey("F", fullscreen);

  const slotMs = panel.slotMinutes * 60_000;
  const started = panel.nowStartedAt ? Date.parse(panel.nowStartedAt) : null;
  const left =
    current && started !== null && now !== null ? slotMs - (now + panel.offset - started) : slotMs;
  const warn = settings.warnMinutes > 0 && left > 0 && left <= settings.warnMinutes * 60_000;
  const scheduled = (slot: PresentationSlot) =>
    panel.startsAt
      ? formatTime(new Date(Date.parse(panel.startsAt) + slot.position * slotMs), time)
      : null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg text-fg">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            size="icon-sm"
            variant="ghost"
            tooltip={t("present.back")}
            aria-label={t("present.back")}
            render={
              <Link
                to={manages ? "/events/$slug/manage/judging/demos" : "/events/$slug/judging"}
                params={{ slug: event.slug }}
              />
            }
            nativeButton={false}
          >
            <IconArrowLeft />
          </Button>
          <div className="min-w-0">
            <p className="truncate font-medium">
              {panel.name}
              {panel.location && <span className="text-muted-fg"> · {panel.location}</span>}
            </p>
            <p className="truncate text-xs text-muted-fg">
              {panel.roundName} · {t("demos.minutesEach", { count: panel.slotMinutes })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {now !== null && (
            <span className="mr-2 hidden font-mono text-sm text-muted-fg tabular-nums sm:inline">
              {formatTime(new Date(now + panel.offset), time)}
            </span>
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            tooltip={full ? t("gallery.exitFullScreen") : t("results.fullScreen")}
            aria-label={full ? t("gallery.exitFullScreen") : t("results.fullScreen")}
            onClick={fullscreen}
          >
            {full ? <IconArrowsMinimize /> : <IconArrowsMaximize />}
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            tooltip={t("present.settings")}
            aria-label={t("present.settings")}
            onClick={() => setOpen(true)}
          >
            <IconSettings />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 overflow-y-auto p-8">
          {total === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t("present.empty")}</EmptyTitle>
                <EmptyDescription>{t("present.emptyHelp")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : done ? (
            <p className="font-heading text-5xl font-semibold text-balance">
              {t("present.allDone")}
            </p>
          ) : shown ? (
            <>
              <Slide
                slot={shown}
                label={current ? t("present.nowPresenting") : t("present.upFirst")}
                total={total}
                time={settings.times ? scheduled(shown) : null}
                settings={settings}
              />
              {settings.timer && (
                <div className="flex flex-col items-center gap-1">
                  <Countdown
                    ms={left}
                    units={["minutes", "seconds"]}
                    className={cn(
                      "text-7xl font-semibold transition-colors sm:text-8xl",
                      warn && "text-warning",
                      left < 0 && "text-destructive",
                    )}
                  />
                  <span className="text-sm text-muted-fg">
                    {!current
                      ? t("present.waiting")
                      : left < 0
                        ? t("present.overtime")
                        : t("present.timeLeft")}
                  </span>
                  {current && (
                    <div className="mt-2 h-1 w-64 overflow-hidden rounded-pill bg-muted">
                      <div
                        className={cn(
                          "h-full origin-left bg-primary transition-transform duration-300 motion-reduce:transition-none",
                          warn && "bg-warning",
                          left < 0 && "bg-destructive",
                        )}
                        style={{
                          transform: `scaleX(${Math.min(1, Math.max(0, 1 - left / slotMs))})`,
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
            </>
          ) : null}
        </main>

        {(settings.queue || settings.judges) && total > 0 && (
          <aside className="flex max-h-[40vh] flex-col gap-6 overflow-y-auto border-t border-border p-5 lg:max-h-none lg:w-80 lg:border-t-0 lg:border-l">
            {settings.queue && upcoming.length > (current ? 0 : 1) && (
              <SideList title={t("present.upNext")}>
                {upcoming.slice(current ? 0 : 1, 8).map((slot) => (
                  <li key={slot.submissionId} className="flex items-baseline gap-3">
                    <span className="w-6 shrink-0 text-right font-mono text-xs text-muted-fg tabular-nums">
                      {slot.position + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{slot.title}</span>
                      <span className="block truncate text-xs text-muted-fg">
                        {[
                          slot.teamName,
                          settings.table && slot.table && t("present.table", { table: slot.table }),
                          settings.times && scheduled(slot),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </li>
                ))}
              </SideList>
            )}
            {settings.judges && panel.judges.length > 0 && (
              <SideList title={t("present.judges")}>
                {panel.judges.map((name) => (
                  <li key={name} className="truncate">
                    {name}
                  </li>
                ))}
              </SideList>
            )}
          </aside>
        )}
      </div>

      {panel.canAdvance && total > 0 && (
        <footer className="flex flex-col items-center gap-2 border-t border-border px-4 py-3">
          <ErrorAlert error={setNow.error} title={t("present.advanceFailed")} />
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="ghost"
              tooltip={t("present.previous")}
              aria-label={t("present.previous")}
              disabled={setNow.isPending || at === null || at <= 0}
              onClick={back}
            >
              <IconChevronLeft />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              tooltip={t("present.restart")}
              aria-label={t("present.restart")}
              disabled={setNow.isPending || current === null}
              onClick={restart}
            >
              <IconRotateClockwise />
            </Button>
            <Button disabled={setNow.isPending || done} onClick={advance}>
              {at === null ? <IconPlayerPlay /> : <IconPlayerTrackNext />}
              {at === null ? t("demos.start") : t("demos.next")}
            </Button>
          </div>
        </footer>
      )}

      <Drawer open={open} onOpenChange={setOpen} swipeDirection="right">
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{t("present.settings")}</DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <DrawerSection title={t("present.timer")}>
              <Toggle
                label={t("present.showTimer")}
                checked={settings.timer}
                onChange={(timer) => change({ timer })}
              />
              <div className="flex flex-col gap-2">
                <span className="text-sm">
                  {t("present.warnAt", { count: settings.warnMinutes })}
                </span>
                <Slider
                  min={0}
                  max={Math.min(10, panel.slotMinutes)}
                  step={1}
                  value={[settings.warnMinutes]}
                  aria-label={t("present.warnMinutes")}
                  onValueChange={(value) =>
                    change({
                      warnMinutes: Array.isArray(value)
                        ? (value[0] ?? DEMO_SCREEN_DEFAULTS.warnMinutes)
                        : value,
                    })
                  }
                />
              </div>
            </DrawerSection>
            <DrawerSection title={t("present.slide")}>
              <Toggle
                label={t("present.showMembers")}
                checked={settings.members}
                onChange={(members) => change({ members })}
              />
              <Toggle
                label={t("present.showDetails")}
                checked={settings.details}
                onChange={(details) => change({ details })}
              />
              <Toggle
                label={t("present.showTable")}
                checked={settings.table}
                onChange={(table) => change({ table })}
              />
              <Toggle
                label={t("present.showTimes")}
                checked={settings.times}
                onChange={(times) => change({ times })}
              />
            </DrawerSection>
            <DrawerSection title={t("present.screen")}>
              <Toggle
                label={t("present.showQueue")}
                checked={settings.queue}
                onChange={(queue) => change({ queue })}
              />
              <Toggle
                label={t("present.showJudges")}
                checked={settings.judges}
                onChange={(judges) => change({ judges })}
              />
            </DrawerSection>
          </DrawerBody>
          <DrawerFooter>
            <Button variant="ghost" onClick={() => change({ ...DEMO_SCREEN_DEFAULTS })}>
              {t("present.reset")}
            </Button>
            <DrawerClose render={<Button />}>{t("common.close")}</DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

function Slide({
  slot,
  label,
  total,
  time,
  settings,
}: {
  slot: PresentationSlot;
  label: string;
  total: number;
  time: string | null;
  settings: DemoScreenSettings;
}) {
  const t = useT();
  return (
    <div
      key={slot.submissionId}
      className="flex max-w-4xl flex-col items-center gap-4 text-center animate-in fade-in duration-300 motion-reduce:animate-none"
    >
      <p className="text-sm font-medium tracking-wide text-muted-fg uppercase">
        {label} · {t("present.position", { at: slot.position + 1, total })}
        {time && ` · ${time}`}
      </p>
      <h1 className="font-heading text-5xl font-semibold text-balance sm:text-6xl">{slot.title}</h1>
      <p className="text-2xl">
        {slot.teamName ?? <span className="text-muted-fg">{t("present.hidden")}</span>}
        {settings.table && slot.table && (
          <span className="text-muted-fg"> · {t("present.table", { table: slot.table })}</span>
        )}
      </p>
      {settings.members && slot.members.length > 0 && (
        <p className="max-w-3xl text-lg text-balance text-muted-fg">{slot.members.join(", ")}</p>
      )}
      {settings.details && (slot.division || slot.tracks.length > 0) && (
        <div className="flex flex-wrap justify-center gap-1.5">
          {slot.division && <Badge variant="secondary">{slot.division}</Badge>}
          {slot.tracks.map((track) => (
            <Badge key={track} variant="outline">
              {track}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function SideList({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-medium tracking-wide text-muted-fg uppercase">{title}</h2>
      <ol className="flex flex-col gap-3 text-sm">{children}</ol>
    </section>
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
