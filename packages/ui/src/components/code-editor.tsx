import { useRef, type MouseEvent } from "react";
import CodeMirror, { EditorView, keymap, type Extension } from "@uiw/react-codemirror";
import { acceptCompletion } from "@codemirror/autocomplete";
import { indentWithTab } from "@codemirror/commands";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import { cpp } from "@codemirror/lang-cpp";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { cn } from "@bogey/ui/lib/utils";
import { useExternalValue } from "../hooks/external.ts";
import { revealLine } from "../lib/editor-lines.ts";

export interface EditorHandle {
  jumpToLine: (line: number) => void;
}

export const EDITOR_LANGUAGES = ["python", "javascript", "cpp"] as const;
export type EditorLanguage = (typeof EDITOR_LANGUAGES)[number];

const LANGUAGE_EXTENSIONS: Record<EditorLanguage, () => Extension> = {
  python: python,
  javascript: () => javascript(),
  cpp: cpp,
};

export interface EditorSettings {
  autocomplete: boolean;
  tabSize: number;
  lineWrapping: boolean;
}

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  autocomplete: true,
  tabSize: 4,
  lineWrapping: false,
};

const tabKeymap = keymap.of([{ key: "Tab", run: acceptCompletion }, indentWithTab]);

function subscribeRootClass(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

const rootIsDark = () => document.documentElement.classList.contains("dark");

function useIsDark(): boolean {
  return useExternalValue(subscribeRootClass, rootIsDark, false);
}

const mix = (color: string, percent: number) =>
  `color-mix(in oklch, var(${color}) ${percent}%, transparent)`;

const editorStyles = {
  "&": {
    color: "var(--fg)",
    backgroundColor: "transparent",
    fontSize: "0.8rem",
    cursor: "text",
  },
  ".cm-content": {
    caretColor: "var(--fg)",
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    padding: "0.75rem 0",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--fg)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    { backgroundColor: mix("--primary", 25) },
  ".cm-activeLine": { backgroundColor: mix("--fg", 4) },
  ".cm-activeLineGutter": { backgroundColor: mix("--fg", 4), color: "var(--fg)" },
  ".cm-scroller": { alignItems: "stretch" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--muted-fg)",
    border: "none",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: mix("--fg", 8),
    color: "var(--muted-fg)",
    border: "none",
  },
  "&.cm-focused .cm-matchingBracket": {
    backgroundColor: mix("--primary", 20),
    outline: `1px solid ${mix("--primary", 50)}`,
  },
  "&.cm-focused .cm-nonmatchingBracket": { backgroundColor: mix("--destructive", 25) },
  ".cm-selectionMatch": { backgroundColor: mix("--primary", 12) },
  ".cm-searchMatch": {
    backgroundColor: mix("--warning", 25),
    outline: `1px solid ${mix("--warning", 50)}`,
  },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: mix("--warning", 45) },
  ".cm-panels": { backgroundColor: "var(--popover)", color: "var(--popover-fg)" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--border)" },
  ".cm-placeholder": { color: "var(--muted-fg)" },
  ".cm-tooltip": {
    cursor: "default",
    backgroundColor: "var(--popover)",
    color: "var(--popover-fg)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    overflow: "hidden",
  },
  ".cm-tooltip.cm-tooltip-autocomplete": { zIndex: 60 },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "var(--accent)",
    color: "var(--accent-fg)",
  },
  ".cm-completionDetail, .cm-completionInfo": { color: "var(--muted-fg)" },
  ".cm-completionMatchedText": { textDecoration: "none", color: "var(--primary-text)" },
  "&.cm-editor.cm-focused": { outline: "none" },
  ".cm-content:focus-visible": { outline: "none" },
} as const;

const lightTheme = EditorView.theme(editorStyles, { dark: false });
const darkTheme = EditorView.theme(editorStyles, { dark: true });

const bogeyHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword], color: "var(--primary-text)" },
    {
      tag: [tags.operatorKeyword, tags.definitionKeyword, tags.modifier],
      color: "var(--primary-text)",
    },
    { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--chart-2)" },
    { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--warning)" },
    { tag: [tags.comment, tags.meta], color: "var(--muted-fg)", fontStyle: "italic" },
    {
      tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
      color: "var(--fg)",
      fontWeight: "600",
    },
    { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--chart-3)" },
    { tag: [tags.definition(tags.variableName), tags.propertyName], color: "var(--fg)" },
    { tag: [tags.operator, tags.punctuation, tags.bracket], color: "var(--muted-fg)" },
    { tag: tags.invalid, color: "var(--destructive)" },
    { tag: tags.link, textDecoration: "underline" },
    { tag: tags.heading, fontWeight: "700" },
    { tag: tags.emphasis, fontStyle: "italic" },
    { tag: tags.strong, fontWeight: "700" },
  ]),
);

export function CodeEditor({
  value,
  onChange,
  language,
  readOnly = false,
  placeholder,
  minHeight = "16rem",
  className,
  extensions = [],
  settings = DEFAULT_EDITOR_SETTINGS,
  onReady,
  label,
  id,
  onBlur,
  invalid,
}: {
  value: string;
  onChange?: (value: string) => void;
  language: EditorLanguage | "plain";
  readOnly?: boolean;
  placeholder?: string;
  minHeight?: string;
  className?: string;
  extensions?: Extension[];
  settings?: EditorSettings;
  onReady?: (handle: EditorHandle) => void;
  label?: string;
  id?: string;
  onBlur?: () => void;
  invalid?: boolean;
}) {
  const dark = useIsDark();
  const view = useRef<EditorView | null>(null);

  // a click below the last line puts the caret at the end, wherever in the editor it lands
  const toEnd = (event: MouseEvent<HTMLDivElement>) => {
    const current = view.current;
    if (!current || event.button !== 0 || event.shiftKey) return;
    if (event.target instanceof Element && event.target.closest(".cm-tooltip, .cm-panels")) return;
    const end = current.state.doc.length;
    const last = current.coordsAtPos(end);
    if (!last || event.clientY <= last.bottom) return;
    event.preventDefault();
    current.focus();
    current.dispatch({ selection: { anchor: end }, scrollIntoView: true });
  };

  return (
    <div
      onMouseDownCapture={toEnd}
      className={cn(
        "cursor-text overflow-hidden rounded-2xl border border-transparent bg-input/50 transition-[color,box-shadow,background-color] focus-within:border-ring focus-within:focus-ring",
        invalid && "border-destructive",
        className,
      )}
    >
      <CodeMirror
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        placeholder={placeholder}
        minHeight={minHeight}
        theme={[dark ? darkTheme : lightTheme, bogeyHighlight]}
        id={id}
        onBlur={onBlur}
        onCreateEditor={(created) => {
          view.current = created;
          onReady?.({ jumpToLine: (line) => revealLine(created, line) });
        }}
        indentWithTab={false}
        basicSetup={{
          foldGutter: true,
          highlightActiveLine: !readOnly,
          autocompletion: settings.autocomplete,
          closeBrackets: settings.autocomplete,
          tabSize: settings.tabSize,
        }}
        extensions={[
          ...(language === "plain" ? [] : [LANGUAGE_EXTENSIONS[language]()]),
          ...(label ? [EditorView.contentAttributes.of({ "aria-label": label })] : []),
          tabKeymap,
          ...(settings.lineWrapping ? [EditorView.lineWrapping] : []),
          ...extensions,
        ]}
      />
    </div>
  );
}
