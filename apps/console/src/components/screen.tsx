import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@bogey/ui/components/button";
import { Spinner } from "@bogey/ui/components/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@bogey/ui/components/tabs";
import { cn } from "@bogey/ui/lib/utils";
import {
  IconCheck,
  IconChecks,
  IconCopy,
  IconEraser,
  IconLayoutSidebar,
  IconLayoutSidebarFilled,
  IconPlayerStopFilled,
  IconPrompt,
  IconStackX,
  IconTerminal2,
  IconX,
} from "@tabler/icons-react";
import { HOME, TERMINAL, useRuns, type Run } from "#/lib/runs.tsx";
import { STATUS_LABELS } from "#/components/output.tsx";
import { Terminal } from "#/components/terminal.tsx";
import { TERMINAL_FLAG } from "#/lib/terminal-flag.ts";

// Bogey
const ART = String.raw`
██████╗  ██████╗  ██████╗ ███████╗██╗   ██╗
██╔══██╗██╔═══██╗██╔════╝ ██╔════╝╚██╗ ██╔╝
██████╔╝██║   ██║██║  ███╗█████╗   ╚████╔╝
██╔══██╗██║   ██║██║   ██║██╔══╝    ╚██╔╝
██████╔╝╚██████╔╝╚██████╔╝███████╗   ██║
╚═════╝  ╚═════╝  ╚═════╝ ╚══════╝   ╚═╝`.slice(1);

function StatusIcon({ run }: { run: Run }) {
  if (run.status === "running") return <Spinner className="size-3.5" />;
  if (run.status === "ok")
    return <IconCheck aria-label={STATUS_LABELS.ok} className="size-3.5 text-muted-fg" />;
  return (
    <span
      role="img"
      aria-label={STATUS_LABELS[run.status]}
      className={cn(
        "size-2 rounded-pill",
        run.status === "failed" ? "bg-destructive" : "bg-warning",
      )}
    />
  );
}

export interface CommandsToggle {
  open: boolean;
  toggle: () => void;
}

function CommandsButton({ open, toggle }: CommandsToggle) {
  const Icon = open ? IconLayoutSidebarFilled : IconLayoutSidebar;
  return (
    <button
      type="button"
      title="Command palette"
      aria-label="Command palette"
      aria-pressed={open}
      data-active={open || undefined}
      onMouseDown={(event) => event.preventDefault()}
      onClick={toggle}
      className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-fg transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none data-active:bg-fg/10 data-active:text-fg"
    >
      <Icon className="size-3.5" />
    </button>
  );
}

function ScreenTab({
  value,
  active,
  icon,
  children,
  onClose,
}: {
  value: string;
  active: boolean;
  icon: ReactNode;
  children: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div
      data-active={active || undefined}
      className="group flex shrink-0 items-center rounded-lg text-xs text-muted-fg hover:text-fg data-active:bg-fg/10 data-active:text-fg"
    >
      <TabsTrigger
        value={value}
        className={cn(
          "h-auto flex-none gap-1.5 rounded-lg py-1.5 pl-2.5 text-xs font-normal after:hidden focus-visible:ring-2 focus-visible:ring-ring/50",
          onClose ? "pr-0" : "pr-2.5",
        )}
      >
        {icon}
        {children}
      </TabsTrigger>
      {onClose && (
        <button
          type="button"
          aria-label={`Close ${typeof children === "string" ? children : "the tab"}`}
          onClick={onClose}
          className="mr-1.5 ml-0.5 rounded-md p-1"
        >
          <IconX className="size-3" />
        </button>
      )}
    </div>
  );
}

function Output({ run }: { run: Run }) {
  const ref = useRef<HTMLPreElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    stick.current = true;
  }, [run.id]);
  useLayoutEffect(() => {
    const screen = ref.current;
    if (screen && stick.current) screen.scrollTop = screen.scrollHeight;
  }, [run.output, run.id]);
  return (
    <pre
      ref={ref}
      onScroll={(event) => {
        const screen = event.currentTarget;
        stick.current = screen.scrollHeight - screen.scrollTop - screen.clientHeight < 24;
      }}
      className="scroll-fade min-h-0 flex-1 overflow-auto px-4 pt-3 pb-6 font-mono text-xs leading-relaxed whitespace-pre"
    >
      <span className="text-muted-fg select-none">$ </span>
      <span className="text-muted-fg">{run.line}</span>
      {"\n\n"}
      {run.output || (run.status === "running" ? "…" : "No output.")}
    </pre>
  );
}

function Tip({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="text-primary-lite select-none">
        ›
      </span>
      <span>{children}</span>
    </li>
  );
}

function Welcome({ terminal }: { terminal: boolean }) {
  return (
    <div className="scroll-fade min-h-0 flex-1 overflow-auto px-6 pt-10 pb-12 font-mono text-xs leading-relaxed">
      <div className="mx-auto flex w-fit max-w-full flex-col gap-8">
        <pre
          role="img"
          aria-label="Bogey"
          className="w-fit max-w-full overflow-hidden bg-linear-to-b from-primary-lite to-primary bg-clip-text text-[clamp(0.45rem,1.6vw,0.85rem)] leading-[1.1] text-transparent select-none"
        >
          {ART}
        </pre>
        <ul className="flex max-w-prose flex-col gap-2 text-muted-fg">
          <Tip>
            The panel on the left holds every command the console runs. Its tabs group them;{" "}
            <span className="text-fg">search</span> finds one across all tabs.
          </Tip>
          <Tip>
            Open a row for its options. Running it opens a tab up here with the live output;
            anything that changes something asks first.
          </Tip>
          <Tip>
            Drag the divider to resize the panel. Wide enough, its commands go to two columns.
          </Tip>
          <Tip>
            The status checks run when the page opens; their tabs appear above as they finish.
          </Tip>
          {terminal ? (
            <Tip>
              The <span className="text-fg">Terminal</span> tab lets you create and run any{" "}
              <span className="text-fg">bogey</span> command you type, prompts and all. It is
              enabled because <span className="text-warning">{TERMINAL_FLAG}</span> is set in .env.
            </Tip>
          ) : (
            <Tip>
              To type <span className="text-fg">bogey</span> commands here (prompts and all) set{" "}
              <span className="text-fg">{TERMINAL_FLAG}=1</span> in .env and restart the console.
            </Tip>
          )}
          <Tip>
            You might be looking for the{" "}
            <a href="http://localhost:3000/" className="text-fg underline underline-offset-3">
              Bogey web app
            </a>{" "}
            instead.
          </Tip>
        </ul>
      </div>
    </div>
  );
}

export function Screen({ terminal, commands }: { terminal: boolean; commands: CommandsToggle }) {
  const { runs, active, show, stop, dismiss, dismissDone, dismissAll } = useRuns();
  const [terminalBusy, setTerminalBusy] = useState(false);
  const clearTerminal = useRef<(() => void) | null>(null);
  const [copied, setCopied] = useState(false);
  const current = runs.find((run) => run.id === active);
  const hasDone = runs.some((run) => run.status === "ok");
  const onlyErrored = !hasDone && runs.length > 0 && runs.every((run) => run.status !== "running");
  const onTerminal = terminal && active === TERMINAL;

  const copy = async (output: string) => {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Tabs
      value={active}
      onValueChange={(value) => {
        if (typeof value === "string") show(value);
      }}
      className="dark h-full min-h-0 gap-0 bg-[color-mix(in_oklch,var(--background),black_45%)] text-fg"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 bg-fg/3 px-2">
        <CommandsButton {...commands} />
        <TabsList
          variant="line"
          className="scroll-fade-x min-w-0 flex-1 justify-start overflow-x-auto p-0 group-data-horizontal/tabs:h-auto"
        >
          <ScreenTab
            value={HOME}
            active={active === HOME}
            icon={<IconTerminal2 className="size-3.5" />}
          >
            About
          </ScreenTab>
          {terminal && (
            <ScreenTab
              value={TERMINAL}
              active={active === TERMINAL}
              icon={<IconPrompt className="size-3.5 text-warning" />}
            >
              Terminal
            </ScreenTab>
          )}
          {runs.map((run) => (
            <ScreenTab
              key={run.id}
              value={run.id}
              active={run.id === active}
              icon={<StatusIcon run={run} />}
              onClose={() => dismiss(run.id)}
            >
              {run.title}
            </ScreenTab>
          ))}
        </TabsList>
        {(current || hasDone || onlyErrored || onTerminal) && (
          <div className="flex shrink-0 items-center gap-0.5">
            {onTerminal && (
              <Button
                size="icon-sm"
                variant="ghost"
                title="Clear the console"
                aria-label="Clear the console"
                disabled={terminalBusy}
                onClick={() => clearTerminal.current?.()}
              >
                <IconEraser />
              </Button>
            )}
            {hasDone && (
              <Button
                size="icon-sm"
                variant="ghost"
                title="Close completed tabs"
                aria-label="Close completed tabs"
                onClick={dismissDone}
              >
                <IconChecks />
              </Button>
            )}
            {current &&
              (current.status === "running" ? (
                <Button size="xs" variant="secondary" onClick={() => stop(current.id)}>
                  <IconPlayerStopFilled data-icon="inline-start" />
                  Stop
                </Button>
              ) : (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Copy the output"
                  disabled={!current.output}
                  onClick={() => void copy(current.output)}
                >
                  {copied ? <IconCheck /> : <IconCopy />}
                </Button>
              ))}
            {current && (
              <Button
                size="icon-sm"
                variant="ghost"
                title="Close this tab"
                aria-label="Close this tab"
                onClick={() => dismiss(current.id)}
              >
                <IconX />
              </Button>
            )}
            {onlyErrored && (
              <Button
                size="icon-sm"
                variant="ghost"
                title="Close all tabs"
                aria-label="Close all tabs"
                onClick={dismissAll}
              >
                <IconStackX />
              </Button>
            )}
          </div>
        )}
      </div>
      <TabsContent value={HOME} className="flex min-h-0 flex-col">
        <Welcome terminal={terminal} />
      </TabsContent>
      {terminal && (
        <TabsContent value={TERMINAL} keepMounted className="flex min-h-0 flex-col">
          <Terminal
            active={active === TERMINAL}
            clearRef={clearTerminal}
            onBusyChange={setTerminalBusy}
          />
        </TabsContent>
      )}
      {runs.map((run) => (
        <TabsContent key={run.id} value={run.id} className="flex min-h-0 flex-col">
          <Output run={run} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
