import type { PluginManifest } from "./types.ts";

export interface Signal {
  key: string;
  eventId: string | null;
}

export interface SignalDeclaration {
  key: string;
  label: string;
  source: string;
}

export const CORE_SIGNALS = [
  { key: "announcement.posted", label: "An announcement is posted" },
  { key: "announcement.urgent", label: "An urgent announcement is posted" },
  { key: "announcement.sent", label: "You post an announcement" },
  { key: "message.sent", label: "You send a message" },
  { key: "conversation.started", label: "You start a conversation" },
  { key: "notification.received", label: "You get a notification" },
] as const;

export type CoreSignalKey = (typeof CORE_SIGNALS)[number]["key"];

export type SignalKeysOf<M extends PluginManifest> =
  M["signals"] extends Tuple<infer S>
    ? S extends { key: infer K extends string }
      ? K
      : never
    : never;

type Listener = (signal: Signal) => void;
const listeners = new Set<Listener>();

function dispatch(signal: Signal) {
  for (const listener of listeners) {
    try {
      listener(signal);
    } catch (error) {
      console.error(`[bogey] a listener for signal "${signal.key}" failed`, error);
    }
  }
}

export function emitSignal(key: CoreSignalKey, eventId: string | null): void {
  if (listeners.size > 0) dispatch({ key, eventId });
}

export function onSignal(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function createPluginSignals<const M extends PluginManifest>(manifest: M) {
  return {
    emit(key: SignalKeysOf<M>, eventId: string | null): void {
      if (listeners.size > 0) dispatch({ key: `${manifest.key}.${key}`, eventId });
    },
  };
}

export function allSignals(installed: Tuple<PluginManifest>): Tuple<SignalDeclaration> {
  return [
    ...CORE_SIGNALS.map((signal) => ({ ...signal, source: "core" })),
    ...installed.flatMap((manifest) =>
      (manifest.signals ?? []).map((signal) => ({
        key: `${manifest.key}.${signal.key}`,
        label: signal.label,
        source: manifest.key,
      })),
    ),
  ];
}
