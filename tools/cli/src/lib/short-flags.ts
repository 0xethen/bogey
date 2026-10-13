export const SHORT_FLAGS: Readonly<Record<string, string>> = {
  h: "--help",
  y: "--yes",
  n: "--dry-run",
  f: "--force",
  d: "--db-url",
  o: "--out",
  b: "--build",
  c: "--check",
  r: "--remote",
};

const SHORT = /^-([a-zA-Z]+)$/;

export function expandShortFlags(argv: Tuple<string>): string[] {
  return argv.flatMap((arg) => {
    const letters = SHORT.exec(arg)?.[1];
    if (!letters) return [arg];
    const long = [...letters].map((letter) => SHORT_FLAGS[letter]);
    return long.every((flag) => flag !== undefined) ? long : [arg];
  });
}

export function withShortFlags(usage: string): string {
  const shorts = Object.entries(SHORT_FLAGS)
    .filter(([, long]) => long !== "--help" && new RegExp(`${long}\\b`).test(usage))
    .map(([letter, long]) => `-${letter} ${long}`);
  return shorts.length ? `${usage}\n\nShort flags: ${shorts.join(", ")}` : usage;
}
