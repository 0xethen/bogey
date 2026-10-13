export interface Suggestable {
  name: string;
  subcommands?: Tuple<string>;
}

export function distance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, rows[i - 2]![j - 2]! + 1);
      }
      rows[i]![j] = best;
    }
  }
  return rows[a.length]![b.length]!;
}

function near(typed: string, word: string): boolean {
  if (typed.length >= 3 && word.startsWith(typed)) return true;
  return distance(typed, word) <= Math.max(1, Math.floor(word.length / 3));
}

function closest<T>(items: Tuple<T>, typed: string, word: (item: T) => string): T[] {
  const nearby = items.filter((item) => near(typed, word(item)));
  const best = Math.min(...nearby.map((item) => distance(typed, word(item))));
  return nearby
    .filter((item) => distance(typed, word(item)) <= best + 1)
    .toSorted((a, b) => distance(typed, word(a)) - distance(typed, word(b)));
}

export function suggestCommands(commands: Tuple<Suggestable>, name: string): string[] {
  const typed = name.toLowerCase();
  const subs = commands.flatMap((command) =>
    (command.subcommands ?? []).map((sub) => ({ command: command.name, sub })),
  );
  const exact = subs
    .filter(({ sub }) => sub === typed)
    .map(({ command, sub }) => `${command} ${sub}`);
  if (exact.length) return exact.slice(0, 3);
  const found = [
    ...closest(commands, typed, (command) => command.name).map((command) => command.name),
    ...closest(
      subs.filter(({ sub }) => sub !== typed),
      typed,
      ({ sub }) => sub,
    ).map(({ command, sub }) => `${command} ${sub}`),
  ];
  return [...new Set(found)].slice(0, 3);
}

export function unknownSubcommand(
  command: string,
  typed: string,
  subcommands: Tuple<string>,
): string {
  const close = closest(subcommands, typed.toLowerCase(), (sub) => sub).slice(0, 3);
  const unknown = `bogey ${command}: unknown subcommand "${typed}"`;
  if (close.length === 0) return `${unknown}. bogey ${command} --help lists them.`;
  if (close.length === 1) return `${unknown}. Did you mean bogey ${command} ${close[0]}?`;
  return [
    `${unknown}. Did you mean one of these?`,
    ...close.map((sub) => `  bogey ${command} ${sub}`),
  ].join("\n");
}
