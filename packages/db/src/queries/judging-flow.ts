import type { AssignmentStatus, JudgeQueueItem } from "./judging.ts";

// A judge's session as an ordered list of steps; add a builder to add a step.

export type JudgingStepKind = "score" | "deliberate" | "browse";

export interface JudgingStep {
  kind: JudgingStepKind;
  /** A score step's project, or the first project a later step opens. */
  submissionId: string | null;
  done: boolean;
  /** Steps after the queue are offered once it's finished, never required. */
  optional: boolean;
  /** How many projects the step covers. */
  count: number;
}

export interface JudgingFlowInput {
  queue: readonly JudgeQueueItem[];
  /** settings.judging.deliberation */
  deliberation?: "off" | "assigned" | "all";
  /** settings.judging.browseProjects */
  browseProjects?: boolean;
}

type StepBuilder = (input: JudgingFlowInput, queue: readonly JudgeQueueItem[]) => JudgingStep[];

/** A sheet's status: the assignment's, else done when the judge marked an unassigned project done. */
export function sheetStatus(
  assignment: AssignmentStatus | null | undefined,
  completed: boolean,
): AssignmentStatus | null {
  return assignment ?? (completed ? "done" : null);
}

/** The projects a judge is asked to score: their assignments, or every project when they have none. */
export function judgeQueue(queue: readonly JudgeQueueItem[]): JudgeQueueItem[] {
  const assigned = queue.filter((item) => item.assigned);
  return (assigned.length ? assigned : [...queue]).filter((item) => item.status !== "skipped");
}

/** Projects outside a judge's assignments they may still open. */
export function browsable(input: JudgingFlowInput): JudgeQueueItem[] {
  const hasAssignments = input.queue.some((item) => item.assigned);
  if (!hasAssignments) return [];
  return input.browseProjects === true ? input.queue.filter((item) => !item.assigned) : [];
}

const scoreSteps: StepBuilder = (_input, queue) =>
  queue.map((item) => ({
    kind: "score",
    submissionId: item.submissionId,
    done: item.status === "done",
    optional: false,
    count: 1,
  }));

const deliberateStep: StepBuilder = (input) => {
  const mode = input.deliberation ?? "assigned";
  if (mode === "off") return [];
  const flagged = input.queue.filter(
    (item) => item.flagged && (mode === "all" || item.assigned || item.scored > 0),
  );
  if (!flagged.length) return [];
  return [
    {
      kind: "deliberate",
      submissionId: flagged[0]!.submissionId,
      done: false,
      optional: true,
      count: flagged.length,
    },
  ];
};

const browseStep: StepBuilder = (input) => {
  const others = browsable(input);
  if (!others.length) return [];
  return [
    {
      kind: "browse",
      submissionId: others[0]!.submissionId,
      done: false,
      optional: true,
      count: others.length,
    },
  ];
};

export const JUDGING_STEP_BUILDERS: readonly StepBuilder[] = [
  scoreSteps,
  deliberateStep,
  browseStep,
];

export function judgingSteps(
  input: JudgingFlowInput,
  builders: readonly StepBuilder[] = JUDGING_STEP_BUILDERS,
): JudgingStep[] {
  const queue = judgeQueue(input.queue);
  return builders.flatMap((build) => build(input, queue));
}

export interface JudgingProgress {
  done: number;
  total: number;
  finished: boolean;
}

export function judgingProgress(steps: readonly JudgingStep[]): JudgingProgress {
  const required = steps.filter((step) => !step.optional);
  const done = required.filter((step) => step.done).length;
  return {
    done,
    total: required.length,
    finished: required.length > 0 && done === required.length,
  };
}

/** The next unfinished score step after a project, wrapping to the start. */
export function nextToScore(
  steps: readonly JudgingStep[],
  submissionId: string | null,
): JudgingStep | null {
  const scores = steps.filter((step) => step.kind === "score");
  const from = scores.findIndex((step) => step.submissionId === submissionId);
  const ordered = from < 0 ? scores : [...scores.slice(from + 1), ...scores.slice(0, from)];
  return ordered.find((step) => !step.done) ?? null;
}

/** The neighbours of a project in the judge's queue, for previous and next. */
export function queueNeighbours(
  steps: readonly JudgingStep[],
  submissionId: string,
): { index: number; previous: string | null; next: string | null } {
  const ids = steps.flatMap((step) => (step.kind === "score" ? [step.submissionId!] : []));
  const index = ids.indexOf(submissionId);
  if (index < 0) return { index, previous: null, next: null };
  return { index, previous: ids[index - 1] ?? null, next: ids[index + 1] ?? null };
}

export interface JudgeCounts {
  /** Projects assigned to the judge. */
  assigned: number;
  /** Every sheet the judge finished: assigned ones marked done, plus any they completed unassigned. */
  done: number;
  /** The part of `done` outside their assignments. */
  extra: number;
}

/** An organizer's per-judge counts, matching what the judge sees in their own queue. */
export function judgeCounts(
  assignments: readonly { submissionId: string; status: AssignmentStatus }[],
  completed: Iterable<string>,
): JudgeCounts {
  const assignedIds = new Set(assignments.map((row) => row.submissionId));
  const extra = new Set([...completed].filter((id) => !assignedIds.has(id))).size;
  const doneAssigned = assignments.filter((row) => row.status === "done").length;
  return { assigned: assignments.length, done: doneAssigned + extra, extra };
}

/** What a judge can do once their queue is finished. */
export function afterSteps(steps: readonly JudgingStep[]): JudgingStep[] {
  return steps.filter((step) => step.optional);
}
