function compareCore(a: string, b: string): number {
  const left = a.split(".").map((piece) => Number.parseInt(piece, 10) || 0);
  const right = b.split(".").map((piece) => Number.parseInt(piece, 10) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

function withoutBuild(version: string): string {
  return version.split("+")[0] ?? "";
}

/** SemVer order, prereleases included: 2.0.0-rc.1 < 2.0.0 < 2.0.1. Build metadata is ignored. */
export function compareSemver(a: string, b: string): number {
  const [coreA = "", preA] = withoutBuild(a).split(/-(.*)/s, 2);
  const [coreB = "", preB] = withoutBuild(b).split(/-(.*)/s, 2);
  const byCore = compareCore(coreA, coreB);
  if (byCore !== 0) return byCore;
  if (preA === undefined || preB === undefined) {
    return preA === preB ? 0 : preA === undefined ? 1 : -1;
  }
  const partsA = preA.split(".");
  const partsB = preB.split(".");
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const x = partsA[i];
    const y = partsB[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const numeric = /^\d+$/.test(x) && /^\d+$/.test(y);
    const order = numeric ? Number(x) - Number(y) : x.localeCompare(y);
    if (order !== 0) return order > 0 ? 1 : -1;
  }
  return 0;
}

const CONSTRAINT = /^(>=|<=|>|<|=)?\s*v?(\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?)$/;

/**
 * Whether `version` is in `range`, written the way GitHub security advisories write
 * affected versions: `>= 2.0.0, < 2.0.3`, `< 2.0.3`, `= 2.0.1`, or a bare `2.0.1`.
 * Comma-separated constraints must all hold; `||` separates alternatives.
 * Returns null when the range can't be read.
 */
export function inVersionRange(version: string, range: string): boolean | null {
  const alternatives = range.split("||").map((alternative) =>
    alternative
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );
  if (alternatives.some((constraints) => constraints.length === 0)) return null;
  let matched = false;
  for (const constraints of alternatives) {
    let holds = true;
    for (const constraint of constraints) {
      const match = CONSTRAINT.exec(constraint);
      if (!match) return null;
      const [, operator = "=", bound = ""] = match;
      const order = compareSemver(version, bound);
      const ok =
        operator === ">="
          ? order >= 0
          : operator === ">"
            ? order > 0
            : operator === "<="
              ? order <= 0
              : operator === "<"
                ? order < 0
                : order === 0;
      if (!ok) holds = false;
    }
    if (holds) matched = true;
  }
  return matched;
}
