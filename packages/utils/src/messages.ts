export type Messages = Readonly<Record<string, string>>;

type Ident<N extends string> = N extends ""
  ? never
  : N extends `${string}${" " | "#" | "{" | "}" | "," | "\\"}${string}`
    ? never
    : N;
type NameOf<R extends string> = R extends `${infer A}}${string}`
  ? A extends `${infer B},${string}`
    ? Ident<B>
    : Ident<A>
  : never;
type Names<S extends string> = S extends `${string}{${infer Rest}`
  ? NameOf<Rest> | Names<Rest>
  : never;

export type ParamArgs<S extends string> = [Names<S>] extends [never]
  ? []
  : [params: { [K in Names<S>]: string | number }];

type Node =
  | { type: "text"; text: string }
  | { type: "param"; name: string }
  | { type: "plural"; name: string; options: Map<string, Node[]> };

function parseNodes(
  source: string,
  start: number,
  nested: boolean,
): { nodes: Node[]; end: number } {
  const nodes: Node[] = [];
  let text = "";
  let at = start;
  const flush = () => {
    if (text) nodes.push({ type: "text", text });
    text = "";
  };
  while (at < source.length) {
    const char = source[at]!;
    if (char === "\\" && (source[at + 1] === "{" || source[at + 1] === "}")) {
      text += source[at + 1];
      at += 2;
    } else if (char === "}") {
      if (nested) break;
      text += char;
      at += 1;
    } else if (char === "{") {
      flush();
      const close = findClose(source, at);
      const body = source.slice(at + 1, close);
      nodes.push(parseSlot(body));
      at = close + 1;
    } else {
      text += char;
      at += 1;
    }
  }
  flush();
  return { nodes, end: at };
}

function findClose(source: string, open: number): number {
  let depth = 0;
  for (let at = open; at < source.length; at += 1) {
    if (source[at] === "\\") at += 1;
    else if (source[at] === "{") depth += 1;
    else if (source[at] === "}") {
      depth -= 1;
      if (depth === 0) return at;
    }
  }
  return source.length;
}

function parseSlot(body: string): Node {
  const comma = body.indexOf(",");
  if (comma === -1) return { type: "param", name: body.trim() };
  const name = body.slice(0, comma).trim();
  const rest = body.slice(comma + 1);
  const second = rest.indexOf(",");
  if (second === -1 || rest.slice(0, second).trim() !== "plural") return { type: "param", name };
  const options = new Map<string, Node[]>();
  const choices = rest.slice(second + 1);
  let at = 0;
  while (at < choices.length) {
    while (at < choices.length && /\s/.test(choices[at]!)) at += 1;
    const brace = choices.indexOf("{", at);
    if (brace === -1) break;
    const category = choices.slice(at, brace).trim();
    const parsed = parseNodes(choices, brace + 1, true);
    options.set(category, parsed.nodes);
    at = parsed.end + 1;
  }
  return { type: "plural", name, options };
}

const cache = new Map<string, Node[]>();

function nodesOf(message: string): Node[] {
  let nodes = cache.get(message);
  if (!nodes) {
    nodes = parseNodes(message, 0, false).nodes;
    cache.set(message, nodes);
  }
  return nodes;
}

type Values = Readonly<Record<string, string | number>>;

function render(nodes: readonly Node[], values: Values, locale: string, count?: number): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text") {
      out +=
        count === undefined
          ? node.text
          : node.text.replaceAll("#", new Intl.NumberFormat(locale).format(count));
    } else if (node.type === "param") {
      const value = values[node.name];
      out +=
        value === undefined
          ? `{${node.name}}`
          : typeof value === "number"
            ? new Intl.NumberFormat(locale).format(value)
            : value;
    } else {
      const value = values[node.name];
      const number = typeof value === "number" ? value : Number(value);
      const category = Number.isNaN(number) ? "other" : new Intl.PluralRules(locale).select(number);
      const chosen =
        node.options.get(`=${number}`) ??
        node.options.get(category) ??
        node.options.get("other") ??
        [];
      out += render(chosen, values, locale, Number.isNaN(number) ? undefined : number);
    }
  }
  return out;
}

export function formatMessage(message: string, values: Values = {}, locale = "en"): string {
  return render(nodesOf(message), values, locale);
}

function collect(nodes: readonly Node[], into: Set<string>): void {
  for (const node of nodes) {
    if (node.type === "param") into.add(node.name);
    else if (node.type === "plural") {
      into.add(node.name);
      for (const option of node.options.values()) collect(option, into);
    }
  }
}

export function messageParams(message: string): string[] {
  const names = new Set<string>();
  collect(nodesOf(message), names);
  return [...names].sort();
}

export type Missing = "english" | "key" | "language";

export interface TranslatorOptions {
  locale: string;
  overlay: Messages;
  missing?: Missing;
  fallback?: Messages;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function createTranslator<const M extends Messages>(source: M, options: TranslatorOptions) {
  const { locale, overlay, missing = "english", fallback = {} } = options;
  return function t<K extends keyof M & string>(key: K, ...args: ParamArgs<M[K]>): string {
    const message =
      text(overlay[key]) ??
      (missing === "key"
        ? undefined
        : missing === "language"
          ? (text(fallback[key]) ?? text(source[key]))
          : (text(source[key]) ?? text(fallback[key])));
    if (message === undefined) return key;
    try {
      return formatMessage(message, args[0] ?? {}, locale);
    } catch {
      return message;
    }
  };
}

export type Say = (
  key: string,
  english: string,
  values?: Readonly<Record<string, string | number>>,
) => string;

export const sayEnglish: Say = (_key, english, values = {}) => formatMessage(english, values);
