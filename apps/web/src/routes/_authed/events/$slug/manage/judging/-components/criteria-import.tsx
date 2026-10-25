import { useCallback, useMemo, useRef, useState } from "react";
import {
  readGuidancePaste,
  type GuidanceProblem,
  type ImportedCriterion,
} from "@bogey/utils/guidance";
import { tableToText } from "@bogey/utils/roster";
import { Badge } from "@bogey/ui/components/badge";
import { Button } from "@bogey/ui/components/button";
import { CodeEditor, type EditorHandle } from "@bogey/ui/components/code-editor";
import { Field, FieldDescription, FieldLabel } from "@bogey/ui/components/field";
import { FileDrop } from "@bogey/ui/components/file-drop";
import {
  highlight,
  lineMarks,
  type HighlightRule,
  type LineMark,
} from "@bogey/ui/lib/editor-lines";
import { IconPlus } from "@tabler/icons-react";
import { useT, type T } from "#/lib/translate.tsx";
import { LineButton } from "../../-components/line-refs.tsx";

const ACCEPT = ".csv,.tsv,.txt,.md,.xlsx";
const RANGE = String.raw`\d{1,3}(?:\s*(?:-|–|—|to)\s*\d{1,3})?`;

const RUBRIC_HIGHLIGHT: Tuple<HighlightRule> = [
  {
    pattern: /^\s*(?:row|criterion|criteria|category|part|section)\s+(?:[a-z]|\d+|[ivx]+)\b.*/i,
    kind: "comment",
  },
  { pattern: /^\s*#{1,6}\s.*/, kind: "keyword" },
  {
    pattern: new RegExp(
      String.raw`^\s*(?:[-*•]\s+)?${RANGE}\s*(?:(?:points?|pts?)\b\.?|[.:)])`,
      "i",
    ),
    kind: "column",
  },
  { pattern: /\t/, kind: "separator" },
];

export interface ImportOutcome {
  updated: number;
  added: number;
  full: boolean;
}

function problemText(problem: GuidanceProblem, t: T): string {
  switch (problem.kind) {
    case "empty":
      return t("criteriaImport.empty");
    case "noBands":
      return t("criteriaImport.noBands");
    case "badRange":
      return t("criteriaImport.badRange", { line: problem.line, text: problem.text });
    case "noLabel":
      return t("criteriaImport.noLabel", { line: problem.line });
    case "badWeight":
      return t("criteriaImport.badWeight", { line: problem.line, text: problem.text });
    case "tooMany":
      return t("criteriaImport.tooMany", { line: problem.line, label: problem.label });
  }
}

async function fileText(file: File): Promise<string> {
  if (!/\.xlsx$/i.test(file.name)) return file.text();
  const { readSheet } = await import("read-excel-file/browser");
  const rows = await readSheet(file);
  return tableToText(
    rows.map((row) =>
      row.map((cell) =>
        cell === null ? "" : cell instanceof Date ? cell.toISOString() : String(cell),
      ),
    ),
  );
}

/** Paste a rubric or a table (or drop a file into the editor), check what it reads as, then merge it. */
export function CriteriaImport({
  existing,
  onImport,
}: {
  existing: Tuple<string>;
  onImport: (found: Tuple<ImportedCriterion>) => ImportOutcome;
}) {
  const t = useT();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const editor = useRef<EditorHandle | null>(null);
  const jump = useCallback((line: number) => editor.current?.jumpToLine(line), []);

  const read = useMemo(() => (text.trim() ? readGuidancePaste(text) : null), [text]);
  const problems = (read?.problems ?? []).map((problem) => ({
    line: "line" in problem ? problem.line : undefined,
    message: problemText(problem, t),
  }));
  const marks: LineMark[] = problems.flatMap((problem) =>
    problem.line
      ? [{ line: problem.line, severity: "error" as const, message: problem.message }]
      : [],
  );
  const markKey = JSON.stringify(marks);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the marks' contents, not their identity
  const extensions = useMemo(() => [highlight(RUBRIC_HIGHLIGHT), lineMarks(marks)], [markKey]);
  const taken = new Set(existing.map((label) => label.trim().toLowerCase()));
  const found = read?.criteria ?? [];

  const load = async (file: File) => {
    setReading(true);
    setReadError(null);
    try {
      setText(await fileText(file));
      setFileName(file.name);
      setOutcome(null);
    } catch (error) {
      setReadError(
        t("criteriaImport.readFailed", {
          name: file.name,
          error: error instanceof Error ? `: ${error.message}` : "",
        }),
      );
    } finally {
      setReading(false);
    }
  };

  const clear = () => {
    setText("");
    setFileName(null);
    setReadError(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <FileDrop
        files={fileName ? [{ id: fileName, name: fileName, sizeBytes: 0 }] : []}
        accept={ACCEPT}
        multiple={false}
        busy={reading}
        invalid={!!readError}
        onAdd={(files) => {
          const [file] = files;
          if (file) void load(file);
        }}
        onRemove={clear}
      />
      {readError && <p className="text-sm text-destructive">{readError}</p>}
      <Field>
        <FieldLabel htmlFor="criteria-import">{t("criteriaImport.paste")}</FieldLabel>
        <CodeEditor
          id="criteria-import"
          label={t("criteriaImport.pasteLabel")}
          language="plain"
          value={text}
          onChange={(next) => {
            setText(next);
            setOutcome(null);
          }}
          onReady={(handle) => {
            editor.current = handle;
          }}
          placeholder={"Row A\nImpact\n0 points.\nEx: Doesn't solve the prompt.\n1 point.\nEx: ..."}
          minHeight="9rem"
          className="max-h-[min(32rem,60vh)] overflow-y-auto"
          extensions={extensions}
          settings={{ autocomplete: false, tabSize: 4, lineWrapping: true }}
        />
        <FieldDescription className="whitespace-pre-line">
          {t("criteriaImport.pasteHelp")}
        </FieldDescription>
      </Field>

      {problems.length > 0 && (
        <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto rounded-2xl border border-destructive/40 px-4 py-2.5 text-sm text-destructive">
          {problems.map((problem) => (
            <li key={`${problem.line}:${problem.message}`}>
              {problem.line ? (
                <LineButton line={problem.line} onJump={jump}>
                  {problem.message}
                </LineButton>
              ) : (
                problem.message
              )}
            </li>
          ))}
        </ul>
      )}

      {found.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium" role="status">
            {t("criteriaImport.found", { count: found.length })}
          </p>
          <ul className="flex flex-col divide-y divide-border text-sm">
            {found.map((criterion) => {
              const low = Math.min(...criterion.guidance.map((band) => band.min));
              const high = Math.max(...criterion.guidance.map((band) => band.max));
              return (
                <li
                  key={criterion.line}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
                >
                  <LineButton line={criterion.line} onJump={jump}>
                    <span className="font-medium">{criterion.label}</span>
                  </LineButton>
                  <span className="text-muted-fg tabular-nums">
                    {criterion.guidance.length
                      ? `${t("criteriaImport.bands", { count: criterion.guidance.length })} · ${low}–${high}`
                      : t("criteriaImport.noScores")}
                  </span>
                  {taken.has(criterion.label.toLowerCase()) && (
                    <Badge variant="outline">{t("criteriaImport.updates")}</Badge>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={found.length === 0}
          onClick={() => {
            setOutcome(onImport(found));
            clear();
          }}
        >
          <IconPlus />
          {t("criteriaImport.add")}
        </Button>
        {outcome && (
          <p role="status" className="text-sm text-muted-fg">
            {t("criteriaImport.done", { updated: outcome.updated, added: outcome.added })}
            {outcome.full && ` ${t("manageJudging.atMostCriteria")}`}
          </p>
        )}
      </div>
    </div>
  );
}
