import { describe, expect, test } from "vite-plus/test";
import type { JudgeQueueItem } from "../../src/queries/judging.ts";
import {
  afterSteps,
  judgingProgress,
  judgingSteps,
  nextToScore,
  queueNeighbours,
} from "../../src/queries/judging-flow.ts";

const item = (id: string, patch: Partial<JudgeQueueItem> = {}): JudgeQueueItem => ({
  submissionId: id,
  title: id,
  teamName: "Team",
  formTitle: "Project",
  roundId: "r1",
  roundName: "Judging",
  roundOrdinal: 1,
  table: null,
  trackIds: [],
  assigned: true,
  status: "assigned",
  scored: 0,
  flagged: false,
  demo: null,
  ...patch,
});

describe("judgingSteps", () => {
  test("scores assigned projects and skips absent ones", () => {
    const steps = judgingSteps({
      queue: [item("a"), item("b", { status: "skipped" }), item("c", { assigned: false })],
    });
    expect(steps.map((step) => step.submissionId)).toEqual(["a"]);
  });

  test("scores every project when nothing is assigned", () => {
    const steps = judgingSteps({
      queue: [item("a", { assigned: false }), item("b", { assigned: false })],
    });
    expect(steps.filter((step) => step.kind === "score")).toHaveLength(2);
    expect(steps.some((step) => step.kind === "browse")).toBe(false);
  });

  test("offers browsing only when the setting is on", () => {
    const queue = [item("a"), item("x", { assigned: false })];
    expect(judgingSteps({ queue }).some((step) => step.kind === "browse")).toBe(false);
    const on = judgingSteps({ queue, browseProjects: true });
    expect(afterSteps(on).map((step) => step.kind)).toEqual(["browse"]);
  });

  test("offers deliberation the judge is part of", () => {
    const queue = [item("a", { flagged: true }), item("x", { assigned: false, flagged: true })];
    const assigned = afterSteps(judgingSteps({ queue }));
    expect(assigned).toMatchObject([{ kind: "deliberate", submissionId: "a", count: 1 }]);
    const all = afterSteps(judgingSteps({ queue, deliberation: "all" }));
    expect(all[0]?.count).toBe(2);
    expect(afterSteps(judgingSteps({ queue, deliberation: "off" }))).toEqual([]);
  });
});

describe("progress and navigation", () => {
  const steps = judgingSteps({
    queue: [item("a", { status: "done" }), item("b"), item("c")],
  });

  test("counts required steps", () => {
    expect(judgingProgress(steps)).toEqual({ done: 1, total: 3, finished: false });
    const done = judgingSteps({ queue: [item("a", { status: "done" })] });
    expect(judgingProgress(done).finished).toBe(true);
  });

  test("finds the next unfinished project, wrapping around", () => {
    expect(nextToScore(steps, "b")?.submissionId).toBe("c");
    expect(nextToScore(steps, "c")?.submissionId).toBe("b");
    expect(nextToScore(steps, null)?.submissionId).toBe("b");
  });

  test("knows a project's neighbours", () => {
    expect(queueNeighbours(steps, "b")).toEqual({ index: 1, previous: "a", next: "c" });
    expect(queueNeighbours(steps, "z").index).toBe(-1);
  });
});
