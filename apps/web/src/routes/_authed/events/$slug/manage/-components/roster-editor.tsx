import { useMemo } from "react";
import { CodeEditor, type EditorHandle } from "@bogey/ui/components/code-editor";
import {
  highlight,
  lineMarks,
  type HighlightRule,
  type LineMark,
} from "@bogey/ui/lib/editor-lines";

const ROSTER_HIGHLIGHT: Tuple<HighlightRule> = [
  { pattern: /"(?:[^"]|"")*"/, kind: "string" },
  { pattern: /[\w.+'-]+@[\w-]+(?:\.[\w-]+)+/, kind: "email" },
  { pattern: /[\t;,]/, kind: "separator" },
];

export function RosterEditor({
  id,
  label,
  value,
  onChange,
  onBlur,
  invalid,
  marks,
  onReady,
  placeholder,
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  invalid?: boolean;
  marks: Tuple<LineMark>;
  onReady: (handle: EditorHandle) => void;
  placeholder?: string | undefined;
}) {
  const key = JSON.stringify(marks);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the marks' contents, not their identity
  const extensions = useMemo(() => [highlight(ROSTER_HIGHLIGHT), lineMarks(marks)], [key]);
  return (
    <CodeEditor
      id={id}
      label={label}
      language="plain"
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      invalid={invalid}
      onReady={onReady}
      placeholder={placeholder}
      minHeight="9rem"
      extensions={extensions}
      settings={{ autocomplete: false, tabSize: 4, lineWrapping: false }}
    />
  );
}

export const RULES_HIGHLIGHT: Tuple<HighlightRule> = [
  { pattern: /#.*/, kind: "comment" },
  { pattern: /\[[^\]]*\]/, kind: "column" },
  { pattern: /"(?:[^"\\]|\\.)*"/, kind: "string" },
  { pattern: /\/(?:[^/\\]|\\.)+\//, kind: "pattern" },
  { pattern: /->|→/, kind: "arrow" },
  {
    pattern: /\b(?:is not empty|is empty|is not|is|contains|starts with|ends with|matches|and)\b/i,
    kind: "keyword",
  },
  { pattern: /\b(?:division|session|no team|team|role|skip)\b/i, kind: "action" },
  { pattern: /^\s*\*/, kind: "keyword" },
];
