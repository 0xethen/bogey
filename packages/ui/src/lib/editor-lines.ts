import { RangeSet, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  GutterMarker,
  ViewPlugin,
  gutter,
  type ViewUpdate,
} from "@codemirror/view";

export interface LineMark {
  line: number;
  severity: "error" | "note";
  message: string;
}

class Dot extends GutterMarker {
  readonly severity: LineMark["severity"];
  readonly message: string;
  constructor(severity: LineMark["severity"], message: string) {
    super();
    this.severity = severity;
    this.message = message;
  }
  override eq(other: GutterMarker) {
    return (
      other instanceof Dot && other.severity === this.severity && other.message === this.message
    );
  }
  override toDOM() {
    const dot = document.createElement("span");
    dot.className = `cm-line-dot cm-line-dot-${this.severity}`;
    dot.title = this.message;
    dot.textContent = this.severity === "error" ? "!" : "•";
    return dot;
  }
}

const theme = EditorView.baseTheme({
  ".cm-line-error": { backgroundColor: "color-mix(in oklch, var(--destructive) 14%, transparent)" },
  ".cm-line-note": {
    backgroundColor: "color-mix(in oklch, var(--warning, orange) 14%, transparent)",
  },
  ".cm-line-gutter": { width: "1.25rem" },
  ".cm-line-dot": { display: "block", textAlign: "center", fontWeight: "600" },
  ".cm-line-dot-error": { color: "var(--destructive)" },
  ".cm-line-dot-note": { color: "var(--muted-fg)" },
});

export function lineMarks(marks: Tuple<LineMark>): Extension {
  const worst = (line: number) => {
    const here = marks.filter((mark) => mark.line === line);
    return here.find((mark) => mark.severity === "error") ?? here[0];
  };
  return [
    theme,
    EditorView.decorations.of((view) => {
      const doc = view.state.doc;
      const lines = [...new Set(marks.map((mark) => mark.line))]
        .filter((line) => line >= 1 && line <= doc.lines)
        .toSorted((a, b) => a - b);
      return Decoration.set(
        lines.map((line) =>
          Decoration.line({ class: `cm-line-${worst(line)?.severity ?? "note"}` }).range(
            doc.line(line).from,
          ),
        ),
      );
    }),
    gutter({
      class: "cm-line-gutter",
      markers: (view) => {
        const doc = view.state.doc;
        return RangeSet.of(
          [...new Set(marks.map((mark) => mark.line))]
            .filter((line) => line >= 1 && line <= doc.lines)
            .toSorted((a, b) => a - b)
            .flatMap((line) => {
              const mark = worst(line);
              return mark ? [new Dot(mark.severity, mark.message).range(doc.line(line).from)] : [];
            }),
        );
      },
    }),
  ];
}

export function revealLine(view: EditorView, line: number): void {
  const target = view.state.doc.line(Math.min(Math.max(line, 1), view.state.doc.lines));
  view.dispatch({
    selection: { anchor: target.from },
    effects: EditorView.scrollIntoView(target.from, { y: "center" }),
  });
  view.focus();
}

export type HighlightKind =
  | "column"
  | "string"
  | "pattern"
  | "keyword"
  | "action"
  | "arrow"
  | "comment"
  | "email"
  | "separator";

export interface HighlightRule {
  pattern: RegExp;
  kind: HighlightKind;
}

const highlightTheme = EditorView.baseTheme({
  ".cm-hl-column": { color: "var(--primary)", fontWeight: "600" },
  ".cm-hl-string": { color: "var(--success, seagreen)" },
  ".cm-hl-pattern": { color: "var(--warning, darkorange)" },
  ".cm-hl-keyword": { color: "var(--fg)", fontWeight: "600" },
  ".cm-hl-action": { color: "var(--primary)", fontStyle: "italic" },
  ".cm-hl-arrow": { color: "var(--muted-fg)", fontWeight: "700" },
  ".cm-hl-comment": { color: "var(--muted-fg)", fontStyle: "italic" },
  ".cm-hl-email": { color: "var(--primary)" },
  ".cm-hl-separator": { color: "var(--muted-fg)" },
});

function decorate(view: EditorView, rules: Tuple<HighlightRule>) {
  const marks: ReturnType<ReturnType<typeof Decoration.mark>["range"]>[] = [];
  const globals = rules.map(
    ({ pattern }) => new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`),
  );
  for (const { from, to } of view.visibleRanges) {
    for (let at = from; at <= to;) {
      const line = view.state.doc.lineAt(at);
      let i = 0;
      while (i < line.text.length) {
        let best: { index: number; length: number; kind: HighlightKind } | undefined;
        globals.forEach((regex, rule) => {
          regex.lastIndex = i;
          const found = regex.exec(line.text);
          if (!found || found[0].length === 0) return;
          if (!best || found.index < best.index) {
            best = { index: found.index, length: found[0].length, kind: rules[rule]!.kind };
          }
        });
        if (!best) break;
        marks.push(
          Decoration.mark({ class: `cm-hl-${best.kind}` }).range(
            line.from + best.index,
            line.from + best.index + best.length,
          ),
        );
        i = best.index + best.length;
      }
      at = line.to + 1;
    }
  }
  return Decoration.set(marks, true);
}

export function highlight(rules: Tuple<HighlightRule>): Extension {
  return [
    highlightTheme,
    ViewPlugin.fromClass(
      class {
        decorations;
        constructor(view: EditorView) {
          this.decorations = decorate(view, rules);
        }
        update(update: ViewUpdate) {
          if (update.docChanged || update.viewportChanged) {
            this.decorations = decorate(update.view, rules);
          }
        }
      },
      { decorations: (plugin) => plugin.decorations },
    ),
  ];
}
