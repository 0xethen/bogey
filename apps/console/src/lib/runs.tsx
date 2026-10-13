import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type RunStatus = "running" | "ok" | "failed" | "stopped";

export interface Run {
  id: string;
  title: string;
  line: string;
  output: string;
  status: RunStatus;
  exitCode: string | null;
}

export type RunRequest =
  | {
      command: string;
      values?: Readonly<Record<string, string | boolean>>;
      step?: "preview" | "apply";
    }
  | { logs: string; lines: number };

export const HOME = "~home";
export const TERMINAL = "~terminal";

const EXIT = /\n\[exit (\S+)\]\n$/;

export function splitExit(text: string): { output: string; exitCode: string | null } {
  const match = EXIT.exec(text);
  return match
    ? { output: text.slice(0, match.index), exitCode: match[1] ?? null }
    : { output: text, exitCode: null };
}

interface Runs {
  runs: Tuple<Run>;
  active: string;
  start: (
    id: string,
    meta: { title: string; line: string },
    body: RunRequest,
    options?: { reveal?: boolean; once?: boolean },
  ) => Promise<RunStatus>;
  stop: (id: string) => void;
  dismiss: (id: string) => void;
  dismissDone: () => void;
  dismissAll: () => void;
  show: (id: string) => void;
}

const RunsContext = createContext<Runs | null>(null);

export function RunsProvider({ children }: { children: ReactNode }) {
  const [runs, setRuns] = useState<Tuple<Run>>([]);
  const [active, setActive] = useState<string>(HOME);
  const controllers = useRef(new Map<string, AbortController>());
  const latest = useRef(runs);
  useEffect(() => {
    latest.current = runs;
  }, [runs]);

  const start = useCallback<Runs["start"]>(async (id, meta, body, options = {}) => {
    if (
      options.once &&
      (controllers.current.has(id) || latest.current.some((run) => run.id === id))
    ) {
      return "running";
    }
    controllers.current.get(id)?.abort();
    const controller = new AbortController();
    controllers.current.set(id, controller);
    const write = (next: Pick<Run, "output" | "status" | "exitCode">, always = false) => {
      if (!always && controllers.current.get(id) !== controller) return;
      setRuns((current) => {
        const run: Run = { id, ...meta, ...next };
        return current.some((each) => each.id === id)
          ? current.map((each) => (each.id === id ? run : each))
          : [...current, run];
      });
    };
    write({ output: "", status: "running", exitCode: null });
    if (options.reveal !== false) setActive(id);
    let text = "";
    try {
      const response = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        write({
          output: await response.text(),
          status: "failed",
          exitCode: String(response.status),
        });
        return "failed";
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        write({ output: splitExit(text).output, status: "running", exitCode: null });
      }
      const { output, exitCode } = splitExit(text);
      const status = exitCode === "0" ? "ok" : "failed";
      write({ output, status, exitCode });
      return status;
    } catch (error) {
      if (controller.signal.aborted) {
        write({ output: splitExit(text).output, status: "stopped", exitCode: null });
        return "stopped";
      }
      const message = error instanceof Error ? error.message : String(error);
      write({
        output: `${text}\nThe console lost the command: ${message}`,
        status: "failed",
        exitCode: null,
      });
      return "failed";
    } finally {
      if (controllers.current.get(id) === controller) controllers.current.delete(id);
    }
  }, []);

  const stop = useCallback((id: string) => controllers.current.get(id)?.abort(), []);

  const dismiss = useCallback((id: string) => {
    controllers.current.get(id)?.abort();
    const left = latest.current.filter((run) => run.id !== id);
    setRuns((current) => current.filter((run) => run.id !== id));
    setActive((shown) => (shown === id ? (left.at(-1)?.id ?? HOME) : shown));
  }, []);

  /** Closes every tab that finished successfully; running, failed and stopped ones stay. */
  const dismissDone = useCallback(() => {
    const left = latest.current.filter((run) => run.status !== "ok");
    setRuns(left);
    setActive((shown) =>
      shown === HOME || shown === TERMINAL || left.some((run) => run.id === shown)
        ? shown
        : (left.at(-1)?.id ?? HOME),
    );
  }, []);

  /** Closes every run tab, aborting any still going. */
  const dismissAll = useCallback(() => {
    for (const controller of controllers.current.values()) controller.abort();
    setRuns([]);
    setActive((shown) => (shown === TERMINAL ? shown : HOME));
  }, []);

  const value = useMemo(
    () => ({ runs, active, start, stop, dismiss, dismissDone, dismissAll, show: setActive }),
    [runs, active, start, stop, dismiss, dismissDone, dismissAll],
  );
  return <RunsContext.Provider value={value}>{children}</RunsContext.Provider>;
}

export function useRuns(): Runs {
  const runs = useContext(RunsContext);
  if (!runs) throw new Error("useRuns needs a RunsProvider above it.");
  return runs;
}

export function useRun(id: string) {
  const { runs, start, stop, show } = useRuns();
  const run = runs.find((each) => each.id === id);
  return {
    run,
    running: run?.status === "running",
    start: (
      meta: { title: string; line: string },
      body: RunRequest,
      options?: { reveal?: boolean; once?: boolean },
    ) => start(id, meta, body, options),
    stop: () => stop(id),
    show: () => show(id),
  };
}
