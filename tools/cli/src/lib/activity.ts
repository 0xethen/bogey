import { writeSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { bad, dim, good } from "./style.ts";

const SPINNER = `
const { workerData } = require("node:worker_threads");
const { writeSync } = require("node:fs");
const { fd, state, text, color } = workerData;
const flags = new Int32Array(state);
const bytes = new Uint8Array(text);
const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const decoder = new TextDecoder();
const began = Date.now();
let frame = 0;
Atomics.store(flags, 3, 1);
while (Atomics.load(flags, 0) === 0) {
  const label = decoder.decode(bytes.slice(0, Atomics.load(flags, 2)));
  const seconds = Math.floor((Date.now() - began) / 1000);
  const mark = frames[frame++ % frames.length];
  const time = seconds >= 2 ? " " + seconds + "s" : "";
  const line = color
    ? "\\u001b[36m" + mark + "\\u001b[39m " + label + "\\u001b[2m" + time + "\\u001b[22m"
    : mark + " " + label + time;
  try { writeSync(fd, "\\r\\u001b[2K" + line); } catch {}
  Atomics.wait(flags, 0, 0, 80);
}
try { writeSync(fd, "\\r\\u001b[2K"); } catch {}
Atomics.store(flags, 1, 1);
Atomics.notify(flags, 1);
`;

const STOP = 0;
const STOPPED = 1;
const LENGTH = 2;
const STARTED = 3;
const LABEL_BYTES = 1024;

interface Screen {
  fd: number;
  color: boolean;
  columns: () => number;
}

let screen: Screen | null = null;
let spinning: { label: string; stop: () => void; relabel: (label: string) => void } | null = null;

export function enableActivity(fd: number, color: boolean, columns: () => number): void {
  screen = { fd, color, columns };
}

function fit(label: string, columns: number): string {
  const room = Math.max(10, columns - 12);
  return label.length > room ? `${label.slice(0, room - 1)}…` : label;
}

function spin(on: Screen, label: string): NonNullable<typeof spinning> {
  const state = new SharedArrayBuffer(4 * 4);
  const text = new SharedArrayBuffer(LABEL_BYTES);
  const flags = new Int32Array(state);
  const bytes = new Uint8Array(text);
  const encoder = new TextEncoder();
  const relabel = (next: string) => {
    const encoded = encoder.encode(fit(next, on.columns())).slice(0, LABEL_BYTES);
    bytes.set(encoded);
    Atomics.store(flags, LENGTH, encoded.length);
  };
  relabel(label);
  const worker = new Worker(SPINNER, {
    eval: true,
    workerData: { fd: on.fd, state, text, color: on.color },
  });
  worker.unref();
  return {
    label,
    relabel,
    stop: () => {
      Atomics.store(flags, STOP, 1);
      Atomics.notify(flags, STOP);
      if (Atomics.load(flags, STARTED) === 1) Atomics.wait(flags, STOPPED, 0, 500);
      void worker.terminate();
      try {
        writeSync(on.fd, "\r\u001b[2K");
      } catch {}
    },
  };
}

function seconds(since: number): string {
  const elapsed = (performance.now() - since) / 1000;
  return elapsed < 0.5 ? "" : dim(` ${elapsed.toFixed(1)}s`);
}

function failed(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  if ("ok" in value) return value.ok === false;
  if ("exitCode" in value) return value.exitCode !== 0;
  if ("status" in value) return value.status !== 0;
  return false;
}

function settle<T>(value: T, done: (ok: boolean) => void): T {
  if (value instanceof Promise) {
    return value.then(
      (resolved: unknown) => {
        done(!failed(resolved));
        return resolved;
      },
      (error: unknown) => {
        done(false);
        throw error;
      },
    ) as T;
  }
  done(!failed(value));
  return value;
}

export function step<T>(label: string, work: () => T): T {
  const on = screen;
  if (!on) return work();
  if (spinning) return nested(spinning, label, work);
  const began = performance.now();
  const current = spin(on, label);
  spinning = current;
  const done = (ok: boolean) => {
    current.stop();
    spinning = null;
    writeSync(on.fd, `${ok ? good("✓") : bad("✗")} ${label}${seconds(began)}\n`);
  };
  try {
    return settle(work(), done);
  } catch (error) {
    done(false);
    throw error;
  }
}

export function busy<T>(label: string, work: () => T): T {
  const on = screen;
  if (!on) return work();
  if (spinning) return nested(spinning, label, work, true);
  const current = spin(on, label);
  spinning = current;
  const done = () => {
    current.stop();
    spinning = null;
  };
  try {
    return settle(work(), done);
  } catch (error) {
    done();
    throw error;
  }
}

function nested<T>(
  outer: NonNullable<typeof spinning>,
  label: string,
  work: () => T,
  generic = false,
): T {
  if (generic) return work();
  outer.relabel(`${outer.label} › ${label}`);
  const restore = () => outer.relabel(outer.label);
  try {
    return settle(work(), restore);
  } catch (error) {
    restore();
    throw error;
  }
}

export function stopActivity(): void {
  spinning?.stop();
  spinning = null;
}
