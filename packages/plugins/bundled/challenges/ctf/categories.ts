export function groupByCategory<T extends { category: string }>(
  challenges: readonly T[],
): Array<{ category: string; challenges: T[] }> {
  const groups = new Map<string, T[]>();
  for (const challenge of challenges) {
    groups.set(challenge.category, [...(groups.get(challenge.category) ?? []), challenge]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, list]) => ({ category, challenges: list }));
}

export type FlagResult = "correct" | "incorrect" | "solved";

export function isFlagResult(value: string): value is FlagResult {
  return value === "correct" || value === "incorrect" || value === "solved";
}

export function flagMessage(result: FlagResult): string {
  switch (result) {
    case "correct":
      return "Correct! Points added.";
    case "incorrect":
      return "Not the flag.";
    case "solved":
      return "Your team already solved this.";
  }
}
