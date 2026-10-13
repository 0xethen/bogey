import { useRef, useState, type ComponentProps, type ReactNode } from "react";
import { useUiText } from "../lib/ui-text.ts";
import { useHotkey } from "@tanstack/react-hotkeys";
import {
  IconBold,
  IconEye,
  IconEyeOff,
  IconItalic,
  IconLink,
  IconMarkdown,
  IconPaperclip,
  IconPencil,
} from "@tabler/icons-react";
import {
  activeFormats,
  applyEdit,
  formatMarkdown,
  insertMarkdown,
  type MarkdownFormat,
  type TextEdit,
} from "@bogey/utils/markdown";
import { cn } from "@bogey/ui/lib/utils";
import { FieldLabel } from "./field.tsx";
import { Markdown } from "./markdown.tsx";
import { Tabs, TabsList, TabsTrigger } from "./tabs.tsx";
import { Toolbar, ToolbarButton, ToolbarGroup, ToolbarSeparator } from "./toolbar.tsx";

export type MarkdownMode = "write" | "preview";

export function useMarkdownMode() {
  return useState<MarkdownMode>("write");
}

export function MarkdownLabel({
  htmlFor,
  required,
  mode,
  onModeChange,
  actions,
  children,
}: {
  htmlFor: string;
  required?: boolean;
  mode?: MarkdownMode;
  onModeChange?: (mode: MarkdownMode) => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const t = useUiText();
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1.5">
        <FieldLabel htmlFor={htmlFor} required={required}>
          {children}
        </FieldLabel>
        <IconMarkdown className="size-4 text-muted-fg" title={t("ui.markdownField")} />
      </div>
      <div className="flex items-center gap-2">
        {actions}
        {mode && onModeChange && <MarkdownModeSwitch mode={mode} onModeChange={onModeChange} />}
      </div>
    </div>
  );
}

const FORMATS: Tuple<{
  format: MarkdownFormat;
  label: "ui.bold" | "ui.italic" | "ui.spoiler" | "ui.link";
  keys: string;
  icon: ReactNode;
}> = [
  { format: "bold", label: "ui.bold", keys: "Mod+B", icon: <IconBold /> },
  { format: "italic", label: "ui.italic", keys: "Mod+I", icon: <IconItalic /> },
  { format: "spoiler", label: "ui.spoiler", keys: "Mod+\\", icon: <IconEyeOff /> },
  { format: "link", label: "ui.link", keys: "Mod+K", icon: <IconLink /> },
];

export function MarkdownEditor({
  mode = "write",
  value,
  onValueChange,
  onAttach,
  trailing,
  size = "default",
  className,
  rows = 6,
  onSelect,
  ...props
}: Omit<ComponentProps<"textarea">, "value" | "onChange"> & {
  mode?: MarkdownMode;
  value: string;
  onValueChange: (value: string) => void;
  onAttach?: () => Promise<string | undefined>;
  trailing?: ReactNode;
  size?: "default" | "lg";
}) {
  const t = useUiText();
  const ref = useRef<HTMLTextAreaElement>(null);
  const writing = mode === "write";
  const [active, setActive] = useState<ReadonlySet<MarkdownFormat>>(new Set());

  const syncActive = (el: HTMLTextAreaElement) =>
    setActive(activeFormats(el.value, el.selectionStart, el.selectionEnd));

  const apply = (edit: TextEdit) => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(edit.from, edit.to);
    if (document.execCommand("insertText", false, edit.text)) {
      el.setSelectionRange(edit.start, edit.end);
      return;
    }
    onValueChange(applyEdit(el.value, edit));
    requestAnimationFrame(() => el.setSelectionRange(edit.start, edit.end));
  };
  const format = (kind: MarkdownFormat) => {
    const el = ref.current;
    if (el) apply(formatMarkdown(el.value, el.selectionStart, el.selectionEnd, kind));
  };
  const attach = async () => {
    const el = ref.current;
    if (!el || !onAttach) return;
    const [start, end] = [el.selectionStart, el.selectionEnd];
    const text = await onAttach();
    if (text) apply(insertMarkdown(start, end, text));
  };

  const hotkey = (name: string) => ({
    target: ref,
    enabled: writing,
    preventDefault: true,
    stopPropagation: true,
    meta: { name, description: t("ui.inMarkdown"), group: t("ui.textGroup") },
  });
  useHotkey("Mod+B", () => format("bold"), hotkey(t("ui.bold")));
  useHotkey("Mod+I", () => format("italic"), hotkey(t("ui.italic")));
  useHotkey("Mod+\\", () => format("spoiler"), hotkey(t("ui.spoiler")));
  useHotkey("Mod+K", () => format("link"), hotkey(t("ui.link")));

  return (
    <div
      data-slot="markdown-editor"
      className={cn(
        "flex flex-col rounded-2xl border border-transparent bg-input/50 transition-[border-color] has-[textarea:focus-visible]:border-ring has-aria-invalid:border-destructive",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-1.5 py-1">
        <Toolbar aria-label={t("ui.formatting")} aria-controls={props.id}>
          <ToolbarGroup role="group" aria-label={t("ui.textFormatting")}>
            {FORMATS.map((item) => (
              <ToolbarButton
                key={item.format}
                aria-label={t(item.label)}
                title={`${t(item.label)} (${item.keys.replace("Mod", "Ctrl/⌘")})`}
                disabled={!writing}
                focusableWhenDisabled={false}
                aria-pressed={writing && active.has(item.format)}
                data-pressed={writing && active.has(item.format) ? "" : undefined}
                onClick={() => format(item.format)}
              >
                {item.icon}
              </ToolbarButton>
            ))}
          </ToolbarGroup>
          {onAttach && (
            <>
              <ToolbarSeparator orientation="vertical" />
              <ToolbarButton
                aria-label={t("ui.attach")}
                title={t("ui.attach")}
                disabled={!writing}
                focusableWhenDisabled={false}
                onClick={() => void attach()}
              >
                <IconPaperclip />
              </ToolbarButton>
            </>
          )}
        </Toolbar>
        {trailing}
      </div>
      {writing ? (
        <textarea
          ref={ref}
          value={value}
          rows={rows}
          onChange={(event) => {
            onValueChange(event.target.value);
            syncActive(event.target);
          }}
          onSelect={(event) => {
            syncActive(event.currentTarget);
            onSelect?.(event);
          }}
          className={cn(
            "field-sizing-content w-full resize-none bg-transparent px-3 py-3 font-mono text-sm outline-none placeholder:text-muted-fg focus-visible:outline-none",
            size === "lg" ? "min-h-64 md:min-h-80" : "min-h-24",
          )}
          {...props}
        />
      ) : (
        <div className={cn("px-3 py-3", size === "lg" ? "min-h-64 md:min-h-80" : "min-h-24")}>
          {value.trim() ? (
            <Markdown>{value}</Markdown>
          ) : (
            <p className="text-sm text-muted-fg">{t("ui.empty")}</p>
          )}
        </div>
      )}
    </div>
  );
}

export function MarkdownModeSwitch({
  mode,
  onModeChange,
}: {
  mode: MarkdownMode;
  onModeChange: (mode: MarkdownMode) => void;
}) {
  const t = useUiText();
  return (
    <Tabs value={mode} onValueChange={(next: MarkdownMode) => onModeChange(next)} className="gap-0">
      <TabsList variant="switch" aria-label={t("ui.markdownView")}>
        <TabsTrigger value="write" aria-label={t("ui.write")}>
          <IconPencil className="sm:hidden" />
          <span className="max-sm:hidden">{t("ui.write")}</span>
        </TabsTrigger>
        <TabsTrigger value="preview" aria-label={t("ui.preview")}>
          <IconEye className="sm:hidden" />
          <span className="max-sm:hidden">{t("ui.preview")}</span>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
