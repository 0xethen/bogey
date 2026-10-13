import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import { definePlugin } from "../src/api.ts";
import {
  allSignals,
  CORE_SIGNALS,
  createPluginSignals,
  emitSignal,
  onSignal,
  type Signal,
  type SignalKeysOf,
} from "../src/signals.ts";

const META = {
  api: 1,
  version: "1.0.0",
  description: "A plugin.",
  author: { name: "Test" },
  source: { repository: "github:someone/plugins" },
} as const;

const quiz = definePlugin({
  key: "quiz",
  name: "Quiz",
  ...META,
  signals: [
    { key: "answered", label: "You answer a question" },
    { key: "won", label: "Your team wins" },
  ],
});

describe("signals", () => {
  test("listeners hear core's and plugins' signals until they stop", () => {
    const heard: Signal[] = [];
    const stop = onSignal((signal) => heard.push(signal));
    emitSignal("message.sent", "event-1");
    createPluginSignals(quiz).emit("won", null);
    stop();
    emitSignal("message.sent", "event-1");
    expect(heard).toEqual([
      { key: "message.sent", eventId: "event-1" },
      { key: "quiz.won", eventId: null },
    ]);
  });

  test("a listener that throws doesn't stop the others, or the code that emitted", () => {
    const heard: string[] = [];
    const stopBad = onSignal(() => {
      throw new Error("boom");
    });
    const stopGood = onSignal((signal) => heard.push(signal.key));
    expect(() => emitSignal("announcement.posted", "event-1")).not.toThrow();
    stopBad();
    stopGood();
    expect(heard).toEqual(["announcement.posted"]);
  });

  test("only declared names emit", () => {
    expectTypeOf<SignalKeysOf<typeof quiz>>().toEqualTypeOf<"answered" | "won">();
    // @ts-expect-error not declared
    createPluginSignals(quiz).emit("lost", null);
  });

  test("the list has core's, then each plugin's, namespaced", () => {
    const list = allSignals([quiz]);
    expect(list.slice(0, CORE_SIGNALS.length).every((signal) => signal.source === "core")).toBe(
      true,
    );
    expect(list.slice(CORE_SIGNALS.length)).toEqual([
      { key: "quiz.answered", label: "You answer a question", source: "quiz" },
      { key: "quiz.won", label: "Your team wins", source: "quiz" },
    ]);
  });

  test("declarations need unique, well-formed keys and a label", () => {
    const base = { key: "bad", name: "Bad", ...META } as const;
    expect(() => definePlugin({ ...base, signals: [{ key: "Solved", label: "x" }] })).toThrow(
      /signal "Solved"/,
    );
    expect(() =>
      definePlugin({
        ...base,
        signals: [
          { key: "solved", label: "x" },
          { key: "solved", label: "y" },
        ],
      }),
    ).toThrow(/unique/);
    expect(() => definePlugin({ ...base, signals: [{ key: "solved", label: " " }] })).toThrow(
      /needs a label/,
    );
  });
});
