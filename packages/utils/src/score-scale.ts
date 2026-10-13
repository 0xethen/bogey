export type Normalize = "none" | "minmax" | "zscore";

export interface ScoreSample {
  judgeId: string;
  roundId: string;
  criterionId: string;
  value: number;
  min: number;
  max: number;
}

export interface ScaledScore {
  ranged: number;
  adjusted: number;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function scaleScores(samples: Tuple<ScoreSample>, mode: Normalize): ScaledScore[] {
  const groups = new Map<string, number[]>();
  for (const sample of samples) {
    const key = `${sample.judgeId}|${sample.roundId}|${sample.criterionId}`;
    const values = groups.get(key);
    if (values) values.push(sample.value);
    else groups.set(key, [sample.value]);
  }
  const stats = new Map<string, { mean: number; sd: number; lo: number; hi: number }>();
  for (const [key, values] of groups) {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    stats.set(key, {
      mean,
      sd: Math.sqrt(variance),
      lo: Math.min(...values),
      hi: Math.max(...values),
    });
  }
  return samples.map((sample) => {
    const span = sample.max - sample.min;
    const ranged = clamp(span === 0 ? 0 : (sample.value - sample.min) / span);
    const spread = stats.get(`${sample.judgeId}|${sample.roundId}|${sample.criterionId}`);
    if (!spread || mode === "none") return { ranged, adjusted: ranged };
    if (mode === "minmax") {
      const flat = spread.hi === spread.lo;
      return {
        ranged,
        adjusted: clamp(flat ? 0.5 : (sample.value - spread.lo) / (spread.hi - spread.lo)),
      };
    }
    const z = spread.sd === 0 ? 0 : (sample.value - spread.mean) / spread.sd;
    return { ranged, adjusted: clamp(0.5 + 0.1 * z) };
  });
}
