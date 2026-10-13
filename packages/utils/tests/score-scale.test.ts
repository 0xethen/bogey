import { describe, expect, it } from "vite-plus/test";
import { scaleScores, type ScoreSample } from "../src/score-scale.ts";

const sample = (judgeId: string, value: number): ScoreSample => ({
  judgeId,
  roundId: "r",
  criterionId: "c",
  value,
  min: 0,
  max: 10,
});

describe("scaleScores", () => {
  it("maps the criterion's range to 0..1 and clamps", () => {
    const [low, mid, over] = scaleScores([sample("a", 0), sample("a", 5), sample("a", 12)], "none");
    expect(low).toEqual({ ranged: 0, adjusted: 0 });
    expect(mid).toEqual({ ranged: 0.5, adjusted: 0.5 });
    expect(over?.ranged).toBe(1);
  });

  it("stretches each judge's own lowest to highest under minmax", () => {
    const [a1, a2, b1, b2] = scaleScores(
      [sample("a", 2), sample("a", 4), sample("b", 6), sample("b", 10)],
      "minmax",
    );
    expect([a1?.adjusted, a2?.adjusted, b1?.adjusted, b2?.adjusted]).toEqual([0, 1, 0, 1]);
    expect(a1?.ranged).toBeCloseTo(0.2);
  });

  it("centres a judge's mean at one half under zscore, and a flat judge too", () => {
    const [x, y, flat] = scaleScores([sample("a", 4), sample("a", 6), sample("b", 7)], "zscore");
    expect(x?.adjusted).toBeCloseTo(0.4);
    expect(y?.adjusted).toBeCloseTo(0.6);
    expect(flat?.adjusted).toBe(0.5);
  });
});
