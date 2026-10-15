import {
  Suspense,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Await, createFileRoute } from "@tanstack/react-router";
import { Badge } from "@bogey/ui/components/badge";
import { cn } from "@bogey/ui/lib/utils";
import {
  useResizableLayout,
  type ResizablePanelHandle,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@bogey/ui/components/resizable";
import { useMediaQuery } from "@bogey/ui/hooks/media";
import {
  IconAlertTriangle,
  IconLock,
  IconShieldExclamation,
  IconSparkles,
  IconTerminal2,
} from "@tabler/icons-react";
import { consoleInfo, consoleRelease } from "#/server/info.ts";
import { CommandPanel } from "#/components/command-panel.tsx";
import { Screen, type CommandsToggle } from "#/components/screen.tsx";
import { RunsProvider } from "#/lib/runs.tsx";
import { TERMINAL_FLAG } from "#/lib/terminal-flag.ts";

export const Route = createFileRoute("/")({
  loader: async () => ({ ...(await consoleInfo()), release: consoleRelease() }),
  component: Console,
});

const PANEL_WIDTH = 34;
const SLIDE_DELAY_MS = 1200;
const SLIDE_MS = 600;
const TOGGLE_MS = 300;
const COMMANDS = "commands";
const SCREEN = "screen";

function WithCommands({
  open,
  toggle,
  children,
}: CommandsToggle & { children: (commands: CommandsToggle) => ReactNode }) {
  return children({ open, toggle });
}

/**
 * The commands panel slides in once after load, unless the person closed it (dragged it shut).
 * It remembers its width; only layouts from dragging are saved, so the intro never is.
 * The button in the screen's tab row opens and closes it with the same ease-in-out slide.
 */
function Panels({
  orientation,
  commands,
  screen,
}: {
  orientation: "horizontal" | "vertical";
  commands: ReactNode;
  screen: (commands: CommandsToggle) => ReactNode;
}) {
  const { defaultLayout, onLayoutChanged } = useResizableLayout({
    id: `bogey-console-${orientation}`,
    storage: localStorage,
    onlySaveAfterUserInteractions: true,
  });
  const panel = useRef<ResizablePanelHandle | null>(null);
  const [saved] = useState(defaultLayout);
  const [slide] = useState(() => saved === undefined || (saved[COMMANDS] ?? 0) > 0);
  const [sliding, setSliding] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const narrow = orientation === "vertical";

  useEffect(() => {
    if (!slide) return;
    const target = saved?.[COMMANDS] ?? PANEL_WIDTH;
    const begin = setTimeout(() => {
      setSliding(SLIDE_MS);
      panel.current?.resize(`${target}%`);
    }, SLIDE_DELAY_MS);
    const done = setTimeout(() => setSliding(null), SLIDE_DELAY_MS + SLIDE_MS);
    return () => {
      clearTimeout(begin);
      clearTimeout(done);
    };
  }, [slide, saved]);

  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(settle.current), []);
  const toggle = () => {
    const handle = panel.current;
    if (!handle) return;
    clearTimeout(settle.current);
    setSliding(TOGGLE_MS);
    if (open) handle.collapse();
    else handle.expand();
    settle.current = setTimeout(() => setSliding(null), TOGGLE_MS);
  };

  return (
    <ResizablePanelGroup
      orientation={orientation}
      defaultLayout={slide ? { [COMMANDS]: 0, [SCREEN]: 100 } : saved}
      onLayoutChanged={onLayoutChanged}
      className={cn(
        "min-h-0 flex-1",
        sliding !== null &&
          "*:data-panel:transition-[flex-grow] *:data-panel:duration-(--slide) *:data-panel:ease-in-out motion-reduce:*:data-panel:transition-none",
      )}
      style={sliding === null ? undefined : ({ "--slide": `${sliding}ms` } as CSSProperties)}
    >
      <ResizablePanel
        id={COMMANDS}
        panelRef={panel}
        collapsible
        collapsedSize={0}
        defaultSize={`${PANEL_WIDTH}%`}
        minSize={narrow ? 160 : 320}
        onResize={(size) => setOpen(size.asPercentage > 0)}
      >
        {commands}
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel id={SCREEN} minSize={narrow ? 200 : 360}>
        <WithCommands open={open} toggle={toggle}>
          {screen}
        </WithCommands>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

type ReleaseCheck = Awaited<ReturnType<typeof consoleRelease>>;

function ReleaseBadges({ check }: { check: ReleaseCheck }) {
  if (!check) return null;
  const advisory = check.advisories[0];
  if (advisory) {
    const more = check.advisories.length - 1;
    return (
      <Badge
        variant="destructive"
        render={<a href={advisory.url} target="_blank" rel="noreferrer noopener" />}
        title={check.advisories.map((each) => `${each.id}: ${each.summary}`).join("\n")}
      >
        <IconShieldExclamation data-icon="inline-start" />
        {advisory.patched
          ? `Security fix in v${advisory.patched}`
          : `Security issue in v${check.current}`}
        {more > 0 && ` (+${more})`}
      </Badge>
    );
  }
  if (!check.newer || !check.latest) return null;
  return (
    <Badge
      variant="outline"
      render={<a href={check.url} target="_blank" rel="noreferrer noopener" />}
      title={`What changed in Bogey ${check.latest}`}
    >
      <IconSparkles data-icon="inline-start" />v{check.latest} is out
    </Badge>
  );
}

function Console() {
  const { version, root, plugins, terminal, release } = Route.useLoaderData();
  const narrow = useMediaQuery("(max-width: 767px)");
  const orientation = narrow ? "vertical" : "horizontal";
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  return (
    <RunsProvider>
      <div className="flex h-dvh flex-col">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-border px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-2xl bg-linear-to-t from-primary to-primary-lite text-primary-fg">
              <IconTerminal2 className="size-5" />
            </div>
            <div className="flex flex-col gap-1">
              <h1 className="font-heading text-lg leading-none font-semibold">Console</h1>
              {/* <p className="text-sm text-muted-fg">Visual dashboard for the Bogey CLI.</p> */}
            </div>
          </div>
          <div className="flex min-w-0 flex-col items-end gap-1 text-end">
            <div className="flex flex-wrap items-center justify-end gap-2">
              {terminal && (
                <Badge variant="destructive" title={`${TERMINAL_FLAG} is set in .env.`}>
                  <IconAlertTriangle data-icon="inline-start" />
                  Terminal on
                </Badge>
              )}
              <Suspense fallback={null}>
                <Await promise={release}>{(check) => <ReleaseBadges check={check} />}</Await>
              </Suspense>
              {version && (
                <Badge variant="secondary" title={`Bogey ${version}`}>
                  v{version}
                </Badge>
              )}
              <Badge variant="outline" title="Only this machine can open the console.">
                <IconLock data-icon="inline-start" />
                127.0.0.1
              </Badge>
            </div>
            <span className="max-w-full truncate text-xs text-muted-fg">{root}</span>
          </div>
        </header>

        {mounted && (
          <Panels
            key={orientation}
            orientation={orientation}
            commands={<CommandPanel plugins={plugins} />}
            screen={(commands) => <Screen terminal={terminal} commands={commands} />}
          />
        )}
      </div>
    </RunsProvider>
  );
}
