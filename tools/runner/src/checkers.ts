function lines(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .trimEnd()
    .split("\n")
    .map((line) => line.trimEnd());
}

export function exactMatch(actual: string, expected: string): boolean {
  const a = lines(actual);
  const b = lines(expected);
  return a.length === b.length && a.every((line, index) => line === b[index]);
}

function tokens(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

export function tokenMatch(actual: string, expected: string): boolean {
  const a = tokens(actual);
  const b = tokens(expected);
  return a.length === b.length && a.every((token, index) => token === b[index]);
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

export function closeEnough(actual: number, expected: number, tolerance: number): boolean {
  if (actual === expected) return true;
  const difference = Math.abs(actual - expected);
  return difference <= tolerance || difference <= tolerance * Math.abs(expected);
}

export function floatMatch(actual: string, expected: string, tolerance: number): boolean {
  const a = tokens(actual);
  const b = tokens(expected);
  if (a.length !== b.length) return false;
  return a.every((token, index) => {
    const want = b[index];
    if (want === undefined) return false;
    if (NUMBER.test(token) && NUMBER.test(want))
      return closeEnough(Number(token), Number(want), tolerance);
    return token === want;
  });
}

export type BuiltinChecker = "exact" | "tokens" | "float";

export function builtinMatch(
  checker: BuiltinChecker,
  actual: string,
  expected: string,
  tolerance: number | null,
): boolean {
  switch (checker) {
    case "exact":
      return exactMatch(actual, expected);
    case "tokens":
      return tokenMatch(actual, expected);
    case "float":
      return floatMatch(actual, expected, tolerance ?? 1e-6);
  }
}
