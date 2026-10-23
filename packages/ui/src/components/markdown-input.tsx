import { useRef, useState, type ComponentProps, type ReactNode } from "react";
import { useUiText } from "../lib/ui-text.ts";
import { useHotkey } from "@tanstack/react-hotkeys";
import {
  IconBold,
  IconEye,
  IconEyeOff,
  IconH1,
  IconH2,
  IconItalic,
  IconLink,
  IconMarkdown,
  IconPencil,
  IconUnderline,
} from "@tabler/icons-react";
import {
  activeFormats,
  applyEdit,
  formatAllowed,
  formatMarkdown,
  insertMarkdown,
  markdownFeatures,
  type MarkdownFeatureSet,
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

type FormatItem = {
  format: MarkdownFormat;
  label:
    | "ui.bold"
    | "ui.italic"
    | "ui.underline"
    | "ui.spoiler"
    | "ui.link"
    | "ui.heading1"
    | "ui.heading2";
  keys: string;
  icon: ReactNode;
};

const INLINE: Tuple<FormatItem> = [
  { format: "bold", label: "ui.bold", keys: "Mod+B", icon: <IconBold /> },
  { format: "italic", label: "ui.italic", keys: "Mod+I", icon: <IconItalic /> },
  { format: "underline", label: "ui.underline", keys: "Mod+U", icon: <IconUnderline /> },
  { format: "link", label: "ui.link", keys: "Mod+K", icon: <IconLink /> },
  { format: "spoiler", label: "ui.spoiler", keys: "Mod+\\", icon: <IconEyeOff /> },
];

const HEADINGS: Tuple<FormatItem> = [
  { format: "h1", label: "ui.heading1", keys: "Mod+Alt+1", icon: <IconH1 /> },
  { format: "h2", label: "ui.heading2", keys: "Mod+Alt+2", icon: <IconH2 /> },
];

/** A field-specific toolbar button, shown after the formatting buttons. */
export interface MarkdownToolbarItem {
  id: string;
  label: string;
  icon: ReactNode;
  /** Returns Markdown to insert at the caret, or nothing. */
  run: () => Promise<string | undefined | void> | string | undefined | void;
}

export function MarkdownEditor({
  mode = "write",
  value,
  onValueChange,
  features: featureSet,
  items,
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
  /** What the field accepts; the toolbar and preview follow it. Defaults to everything. */
  features?: MarkdownFeatureSet;
  items?: Tuple<MarkdownToolbarItem>;
  trailing?: ReactNode;
  size?: "default" | "lg";
}) {
  const t = useUiText();
  const ref = useRef<HTMLTextAreaElement>(null);
  const writing = mode === "write";
  const features = markdownFeatures(featureSet);
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
    if (el && formatAllowed(kind, features)) {
      apply(formatMarkdown(el.value, el.selectionStart, el.selectionEnd, kind));
    }
  };
  const run = async (item: MarkdownToolbarItem) => {
    const el = ref.current;
    if (!el) return;
    const [start, end] = [el.selectionStart, el.selectionEnd];
    const text = await item.run();
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
  useHotkey("Mod+U", () => format("underline"), hotkey(t("ui.underline")));
  useHotkey("Mod+\\", () => format("spoiler"), hotkey(t("ui.spoiler")));
  useHotkey("Mod+K", () => format("link"), {
    ...hotkey(t("ui.link")),
    enabled: writing && features.links,
  });
  useHotkey("Mod+Alt+1", () => format("h1"), {
    ...hotkey(t("ui.heading1")),
    enabled: writing && features.headings,
  });
  useHotkey("Mod+Alt+2", () => format("h2"), {
    ...hotkey(t("ui.heading2")),
    enabled: writing && features.headings,
  });

  const button = (item: FormatItem) => (
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
  );

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
            {INLINE.filter((item) => formatAllowed(item.format, features)).map(button)}
          </ToolbarGroup>
          {features.headings && (
            <>
              <ToolbarSeparator orientation="vertical" />
              <ToolbarGroup role="group" aria-label={t("ui.headings")}>
                {HEADINGS.map(button)}
              </ToolbarGroup>
            </>
          )}
          {items && items.length > 0 && (
            <>
              <ToolbarSeparator orientation="vertical" />
              <ToolbarGroup role="group" aria-label={t("ui.insert")}>
                {items.map((item) => (
                  <ToolbarButton
                    key={item.id}
                    aria-label={item.label}
                    title={item.label}
                    disabled={!writing}
                    focusableWhenDisabled={false}
                    onClick={() => void run(item)}
                  >
                    {item.icon}
                  </ToolbarButton>
                ))}
              </ToolbarGroup>
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
            <Markdown features={features}>{value}</Markdown>
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
