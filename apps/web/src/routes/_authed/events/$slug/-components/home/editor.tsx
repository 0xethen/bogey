import { useState, type ReactNode } from "react";
import {
  IconArrowsLeftRight,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconPlug,
  IconPlus,
  IconSearch,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import {
  CALLOUT_TONES,
  HOME_BUILT_IN_BLOCKS,
  HOME_CUSTOM_BLOCKS,
  homeBlockSchema,
  type CalloutTone,
  type HomeBlock,
  type HomeLayout,
} from "@bogey/config/settings";
import { Badge } from "@bogey/ui/components/badge";
import { Button } from "@bogey/ui/components/button";
import {
  EditableList,
  EditableListGroup,
  EditableListItem,
  EditableListPalette,
  EditableListSource,
  type EditableListPosition,
} from "@bogey/ui/components/editable-list";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@bogey/ui/components/field";
import { Input } from "@bogey/ui/components/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@bogey/ui/components/input-group";
import {
  MarkdownEditor,
  MarkdownLabel,
  useMarkdownMode,
} from "@bogey/ui/components/markdown-input";
import { OptSelect, type SelectOption } from "@bogey/ui/components/opt-select";
import { Popover, PopoverContent, PopoverTrigger } from "@bogey/ui/components/popover";
import { Switch } from "@bogey/ui/components/switch";
import { Tabs, TabsList, TabsTrigger } from "@bogey/ui/components/tabs";
import { Textarea } from "@bogey/ui/components/textarea";
import { useMinWidth } from "@bogey/ui/hooks/media";
import { useReducedMotion } from "@bogey/ui/hooks/reduced-motion";
import {
  BLOCK_GROUPS,
  BLOCK_INFO,
  blockLabel,
  HomeBlockView,
  type BlockGroup,
  type BlockType,
  type HomeData,
} from "./blocks.tsx";
import { homePanelsOf } from "./plugin-panels.tsx";
import { ImageInput } from "#/components/event/submission/image-input.tsx";
import { useT, type PlainKey, type T } from "#/lib/translate.tsx";
import { LINK, Linked, SettingLink } from "#/components/settings/setting-link.tsx";
import { useEventViewer } from "#/lib/viewer.ts";

type Column = keyof HomeLayout;

const COLUMNS: Tuple<{
  key: Column;
  label: PlainKey;
  short: PlainKey;
  hint: PlainKey;
  within: PlainKey;
  moveHere: PlainKey;
  addHere: PlainKey;
}> = [
  {
    key: "main",
    label: "homeEditor.main",
    short: "homeEditor.mainShort",
    within: "homeEditor.inMain",
    moveHere: "homeEditor.moveToMain",
    addHere: "homeEditor.addToMain",
    hint: "homeEditor.mainHint",
  },
  {
    key: "aside",
    label: "homeEditor.side",
    short: "homeEditor.sideShort",
    within: "homeEditor.inSide",
    moveHere: "homeEditor.moveToSide",
    addHere: "homeEditor.addToSide",
    hint: "homeEditor.sideHint",
  },
];

function placedPanels(layout: HomeLayout): ReadonlySet<string> {
  return new Set(
    [...layout.main, ...layout.aside].flatMap((block) =>
      block.type === "plugin" ? [`${block.plugin}:${block.panel ?? ""}`] : [],
    ),
  );
}

function isColumn(list: string): list is Column {
  return list === "main" || list === "aside";
}

function moveBlock(layout: HomeLayout, from: EditableListPosition, to: EditableListPosition) {
  if (!isColumn(from.list) || !isColumn(to.list)) return layout;
  const block = layout[from.list][from.index];
  if (!block) return layout;
  const next = { ...layout, [from.list]: layout[from.list].toSpliced(from.index, 1) };
  return { ...next, [to.list]: next[to.list].toSpliced(to.index, 0, block) };
}

function newId(type: string): string {
  return `${type}-${crypto.randomUUID().slice(0, 8)}`;
}

interface Template {
  key: string;
  label: string;
  description: string;
  icon: (typeof BLOCK_INFO)[BlockType]["icon"];
  make: () => HomeBlock;
}

type PaletteGroup = {
  key: BlockGroup | "plugins";
  label: string;
  hint?: string;
  items: Template[];
};

function blank(type: BlockType): HomeBlock {
  const id = newId(type);
  switch (type) {
    case "text":
      return { id, type, title: "", body: "" };
    case "callout":
      return { id, type, title: "", tone: "default", body: "" };
    case "faq":
      return { id, type, title: "", questions: [] };
    case "image":
      return { id, type, title: "", image: { url: "", alt: "" }, caption: "" };
    case "sponsors":
      return { id, type, title: "", sponsors: [] };
    case "links":
      return { id, type, title: "", links: [] };
    case "countdown":
      return { id, type, title: "", to: "start" };
    case "divider":
      return { id, type };
    case "about":
      return { id, type, title: "", images: [] };
    case "next-steps":
    case "agenda":
    case "announcements":
    case "facts":
    case "prizes":
    case "pages":
    case "badge":
      return { id, type };
  }
}

function isCustom(block: HomeBlock): boolean {
  return HOME_CUSTOM_BLOCKS.some((type) => type === block.type);
}

function templates(layout: HomeLayout, data: HomeData, t: T): PaletteGroup[] {
  const used = new Set([...layout.main, ...layout.aside].map((block) => block.type));
  const placed = placedPanels(layout);
  const template = (type: BlockType): Template => ({
    key: type,
    label: t(BLOCK_INFO[type].label),
    description: t(BLOCK_INFO[type].description),
    icon: BLOCK_INFO[type].icon,
    make: () => blank(type),
  });
  const available: Tuple<BlockType> = [
    ...HOME_BUILT_IN_BLOCKS.filter((type) => !used.has(type)),
    ...(used.has("about") ? [] : (["about"] as const)),
    ...HOME_CUSTOM_BLOCKS,
  ];
  const groups: PaletteGroup[] = BLOCK_GROUPS.map((group) => ({
    key: group.key,
    label: t(group.label),
    hint: "hint" in group ? t(group.hint) : undefined,
    items: available.filter((type) => BLOCK_INFO[type].group === group.key).map(template),
  }));
  const plugins: Template[] = data.plugins.flatMap((plugin) =>
    homePanelsOf(plugin)
      .filter((panel) => !placed.has(`${plugin.key}:${panel.key}`))
      .map((panel) => ({
        key: `plugin:${plugin.key}:${panel.key}`,
        label: panel.label,
        description: panel.description ?? plugin.description,
        icon: IconPlug,
        make: (): HomeBlock => ({
          id: newId("plugin"),
          type: "plugin",
          plugin: plugin.key,
          panel: panel.key,
        }),
      })),
  );
  const pluginGroup: PaletteGroup = {
    key: "plugins",
    label: t("accountNav.plugins"),
    hint: t("homeEditor.pluginHint"),
    items: plugins,
  };
  return [...groups, pluginGroup].filter((group) => group.items.length > 0);
}

interface Found {
  column: Column;
  index: number;
  block: HomeBlock;
}

function findBlock(layout: HomeLayout, id: string | null): Found | null {
  if (id === null) return null;
  for (const { key: column } of COLUMNS) {
    const index = layout[column].findIndex((block) => block.id === id);
    const block = layout[column][index];
    if (block) return { column, index, block };
  }
  return null;
}

function iconOf(block: HomeBlock) {
  return block.type === "plugin" ? IconPlug : BLOCK_INFO[block.type].icon;
}

const otherColumn = (column: Column): Column => (column === "main" ? "aside" : "main");

const columnOf = (column: Column) => (column === "main" ? COLUMNS[0] : COLUMNS[1]);

/**
 * Customize mode for the event homepage: the page itself as the canvas, a side panel for the
 * selected block (or the block picker), and inline editing on narrow screens.
 * See docs/architecture/ui-conventions.md.
 */
export function HomeEditor({
  layout,
  onChange,
  data,
}: {
  layout: HomeLayout;
  onChange: (layout: HomeLayout) => void;
  data: HomeData;
}) {
  const t = useT();
  const wide = useMinWidth("xl");
  const reduced = useReducedMotion();
  const [active, setActive] = useState<string | null>(null);
  const [target, setTarget] = useState<Column>("main");
  const palette = templates(layout, data, t);
  const selected = findBlock(layout, active);

  const setColumn = (column: Column, blocks: Array<HomeBlock>) =>
    onChange({ ...layout, [column]: blocks });
  const replace = (column: Column, block: HomeBlock) =>
    setColumn(
      column,
      layout[column].map((each) => (each.id === block.id ? block : each)),
    );
  const reveal = (id: string) =>
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-home-block="${id}"]`)
        ?.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" }),
    );
  const add = (key: string, to: EditableListPosition) => {
    const template = palette.flatMap((group) => group.items).find((each) => each.key === key);
    if (!template || !isColumn(to.list)) return;
    const block = template.make();
    setColumn(to.list, layout[to.list].toSpliced(to.index, 0, block));
    setActive(block.id);
    reveal(block.id);
  };
  const remove = ({ column, block }: Found) => {
    setColumn(
      column,
      layout[column].filter((each) => each.id !== block.id),
    );
    if (active === block.id) setActive(null);
  };
  const duplicate = ({ column, index, block }: Found) => {
    const copy = { ...block, id: newId(block.type) };
    setColumn(column, layout[column].toSpliced(index + 1, 0, copy));
    setActive(copy.id);
  };
  const toggle = ({ column, block }: Found) =>
    replace(column, { ...block, hidden: block.hidden ? undefined : true });
  const moveAcross = ({ column, index }: Found) => {
    const to = otherColumn(column);
    onChange(moveBlock(layout, { list: column, index }, { list: to, index: layout[to].length }));
  };

  const options = (found: Found, full: boolean) => (
    <BlockOptions
      block={found.block}
      column={found.column}
      onToggle={() => toggle(found)}
      onMove={() => moveAcross(found)}
      onDuplicate={full && isCustom(found.block) ? () => duplicate(found) : undefined}
      onRemove={full ? () => remove(found) : undefined}
    />
  );

  return (
    <EditableListGroup
      onMove={(from, to) => onChange(moveBlock(layout, from, to))}
      onAdd={add}
      onRemove={(from) => {
        if (!isColumn(from.list)) return;
        const block = layout[from.list][from.index];
        if (block) remove({ column: from.list, index: from.index, block });
      }}
    >
      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          {COLUMNS.map((column) => (
            <section
              key={column.key}
              aria-label={t(column.label)}
              className="flex min-w-0 flex-col gap-3"
            >
              <header className="flex items-end justify-between gap-3 border-b border-border pb-2">
                <div className="flex min-w-0 flex-col">
                  <h2 className="text-sm font-semibold">{t(column.label)}</h2>
                  <p className="text-xs text-muted-fg">{t(column.hint)}</p>
                </div>
                <span className="shrink-0 text-xs text-muted-fg tabular-nums">
                  {t("homeEditor.blocks", { count: layout[column.key].length })}
                </span>
              </header>
              <EditableList id={column.key} empty={t("homeEditor.empty")}>
                {layout[column.key].map((block, index) => {
                  const found = { column: column.key, index, block };
                  const label = blockLabel(block, data.plugins, t);
                  const Icon = iconOf(block);
                  const invalid = !homeBlockSchema.safeParse(block).success;
                  const editingHere = !wide && active === block.id;
                  return (
                    <EditableListItem
                      key={block.id}
                      id={block.id}
                      index={index}
                      noun={label}
                      title={label}
                      icon={<Icon />}
                      numbered={false}
                      selected={wide && active === block.id}
                      dimmed={block.hidden}
                      actions={
                        <>
                          {invalid && (
                            <Badge variant="destructive" className="mr-1">
                              {t("homeEditor.needsFix")}
                            </Badge>
                          )}
                          {block.hidden && (
                            <Badge variant="secondary" className="mr-1">
                              {t("homeEditor.hidden")}
                            </Badge>
                          )}
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            aria-label={t(block.hidden ? "homeEditor.show" : "homeEditor.hide", {
                              name: label,
                            })}
                            tooltip={t(block.hidden ? "homeEditor.show" : "homeEditor.hide", {
                              name: label,
                            })}
                            onClick={() => toggle(found)}
                          >
                            {block.hidden ? <IconEye /> : <IconEyeOff />}
                          </Button>
                        </>
                      }
                      onDuplicate={isCustom(block) ? () => duplicate(found) : undefined}
                      onRemove={() => remove(found)}
                      preview={
                        <div data-home-block={block.id} className="min-w-0">
                          <HomeBlockView block={block} data={data} customizing />
                        </div>
                      }
                      editing={editingHere}
                      onEdit={() => setActive(block.id)}
                      onDone={() => setActive(null)}
                    >
                      {editingHere && (
                        <>
                          <BlockSettings
                            block={block}
                            eventId={data.event.id}
                            onChange={(next) => replace(column.key, next)}
                          />
                          {options(found, false)}
                        </>
                      )}
                    </EditableListItem>
                  );
                })}
              </EditableList>
              <AddBlock
                groups={palette}
                column={column.key}
                onPick={(key) => add(key, { list: column.key, index: layout[column.key].length })}
              />
            </section>
          ))}
        </div>

        {wide && (
          <EditableListPalette
            label={selected ? blockLabel(selected.block, data.plugins, t) : t("homeEditor.palette")}
            removeLabel={t("homeEditor.remove")}
            className="sticky top-[calc(var(--layout-offset,0px)+--spacing(3))] rounded-3xl border border-border bg-card"
          >
            <div
              className="flex max-h-[calc(100dvh-var(--layout-offset,0px)-(--spacing(6)))] flex-col overflow-y-auto scrollbar-thin"
              onKeyDown={(event) => {
                if (event.key === "Escape" && selected) setActive(null);
              }}
            >
              {selected ? (
                <>
                  <header className="flex items-center gap-3 border-b border-border p-4">
                    <BlockIcon icon={iconOf(selected.block)} />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <h2 className="truncate text-sm font-semibold">
                        {blockLabel(selected.block, data.plugins, t)}
                      </h2>
                      <p className="text-xs text-muted-fg">{t(columnOf(selected.column).within)}</p>
                    </div>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("homeEditor.close")}
                      tooltip={t("homeEditor.close")}
                      onClick={() => setActive(null)}
                    >
                      <IconX />
                    </Button>
                  </header>
                  <div className="p-4">
                    <BlockSettings
                      key={selected.block.id}
                      block={selected.block}
                      eventId={data.event.id}
                      onChange={(next) => replace(selected.column, next)}
                    />
                  </div>
                  <div className="border-t border-border p-4">{options(selected, true)}</div>
                </>
              ) : (
                <div className="flex flex-col gap-3 p-4">
                  <header className="flex items-center justify-between gap-3">
                    <h2 className="text-sm font-semibold">{t("homeEditor.addTitle")}</h2>
                    <Tabs
                      value={target}
                      onValueChange={(next: Column) => setTarget(next)}
                      className="gap-0"
                    >
                      <TabsList variant="switch" aria-label={t("homeEditor.addTo")}>
                        {COLUMNS.map((column) => (
                          <TabsTrigger key={column.key} value={column.key}>
                            {t(column.short)}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </Tabs>
                  </header>
                  <p className="text-xs text-muted-fg">{t("homeEditor.addHelp")}</p>
                  <BlockPicker
                    groups={palette}
                    draggable
                    onPick={(key) => add(key, { list: target, index: layout[target].length })}
                  />
                </div>
              )}
            </div>
          </EditableListPalette>
        )}
      </div>
    </EditableListGroup>
  );
}

function BlockIcon({ icon: Icon }: { icon: Template["icon"] }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-fg">
      <Icon className="size-4" />
    </span>
  );
}

function BlockOptions({
  block,
  column,
  onToggle,
  onMove,
  onDuplicate,
  onRemove,
}: {
  block: HomeBlock;
  column: Column;
  onToggle: () => void;
  onMove: () => void;
  onDuplicate?: () => void;
  onRemove?: () => void;
}) {
  const t = useT();
  const id = `${block.id}-shown`;
  return (
    <div className="flex flex-col gap-4">
      <Field orientation="horizontal" className="justify-between">
        <FieldContent>
          <FieldLabel htmlFor={id}>{t("homeEditor.shown")}</FieldLabel>
          <FieldDescription>{t("homeEditor.shownHelp")}</FieldDescription>
        </FieldContent>
        <Switch id={id} checked={!block.hidden} onCheckedChange={onToggle} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onMove}>
          <IconArrowsLeftRight />
          {t(columnOf(otherColumn(column)).moveHere)}
        </Button>
        {onDuplicate && (
          <Button type="button" size="sm" variant="outline" onClick={onDuplicate}>
            <IconCopy />
            {t("homeEditor.duplicate")}
          </Button>
        )}
        {onRemove && (
          <Button type="button" size="sm" variant="ghost-destructive" onClick={onRemove}>
            <IconTrash />
            {t("homeEditor.removeBlock")}
          </Button>
        )}
      </div>
    </div>
  );
}

function matches(template: Template, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return (
    !needle ||
    template.label.toLowerCase().includes(needle) ||
    template.description.toLowerCase().includes(needle)
  );
}

function BlockPicker({
  groups,
  draggable = false,
  onPick,
}: {
  groups: Tuple<PaletteGroup>;
  draggable?: boolean;
  onPick: (key: string) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const shown = groups
    .map((group) => ({ ...group, items: group.items.filter((each) => matches(each, query)) }))
    .filter((group) => group.items.length > 0);
  const row =
    "flex w-full items-center gap-3 rounded-xl p-1.5 text-left transition-colors hocus:bg-muted";
  return (
    <div className="flex flex-col gap-3">
      <InputGroup>
        <InputGroupAddon>
          <IconSearch />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          aria-label={t("homeEditor.search")}
          placeholder={t("homeEditor.search")}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            const first = shown[0]?.items[0];
            if (event.key === "Enter" && first) {
              event.preventDefault();
              onPick(first.key);
            }
          }}
        />
      </InputGroup>
      {shown.length === 0 && <p className="text-sm text-muted-fg">{t("homeEditor.noMatches")}</p>}
      {shown.map((group) => (
        <div key={group.key} className="flex flex-col gap-0.5">
          <h3
            className="px-1.5 pb-1 text-[0.6875rem] font-semibold tracking-wide text-muted-fg uppercase"
            title={group.hint}
          >
            {group.label}
          </h3>
          {group.items.map((template) => {
            const content = (
              <>
                <BlockIcon icon={template.icon} />
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium">{template.label}</span>
                  <span className="line-clamp-1 text-xs text-muted-fg">{template.description}</span>
                </span>
              </>
            );
            return draggable ? (
              <EditableListSource
                key={template.key}
                id={template.key}
                title={template.description}
                onActivate={() => onPick(template.key)}
                className={row}
              >
                {content}
              </EditableListSource>
            ) : (
              <button
                key={template.key}
                type="button"
                className={row}
                onClick={() => onPick(template.key)}
              >
                {content}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function AddBlock({
  groups,
  column,
  onPick,
}: {
  groups: Tuple<PaletteGroup>;
  column: Column;
  onPick: (key: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="justify-start self-start text-muted-fg"
            aria-label={t(columnOf(column).addHere)}
          />
        }
      >
        <IconPlus />
        {t("homeEditor.addHere")}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-[min(28rem,var(--available-height))] w-80 overflow-y-auto p-3 scrollbar-thin"
      >
        <BlockPicker
          groups={groups}
          onPick={(key) => {
            onPick(key);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function issueAt(block: HomeBlock, path: Tuple<string | number>): string | undefined {
  const result = homeBlockSchema.safeParse(block);
  if (result.success) return undefined;
  return result.error.issues.find(
    (issue) =>
      issue.path.length === path.length && issue.path.every((part, index) => part === path[index]),
  )?.message;
}

const TONE_LABEL = {
  default: "homeEditor.toneDefault",
  info: "homeEditor.toneInfo",
  success: "homeEditor.toneSuccess",
  warning: "homeEditor.toneWarning",
} as const satisfies Record<CalloutTone, PlainKey>;

const tones = (t: T): Tuple<SelectOption<CalloutTone>> =>
  CALLOUT_TONES.map((tone) => ({ value: tone, label: t(TONE_LABEL[tone]) }));

const countdownTargets = (t: T): Tuple<SelectOption<"start" | "end">> => [
  { value: "start", label: t("homeEditor.untilStart") },
  { value: "end", label: t("homeEditor.untilEnd") },
];

function Rows<T>({
  rows,
  max,
  noun,
  addLabel,
  blank,
  onChange,
  children,
}: {
  rows: Tuple<T>;
  max: number;
  noun: string;
  addLabel: string;
  blank: T;
  onChange: (rows: Array<T>) => void;
  children: (row: T, index: number, set: (patch: Partial<T>) => void) => ReactNode;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row, index) => (
        <div key={index} className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {children(row, index, (patch) =>
              onChange(rows.map((each, at) => (at === index ? { ...each, ...patch } : each))),
            )}
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={t("homeEditor.removeRow", { noun, n: index + 1 })}
            tooltip={t("homeEditor.removeNoun", { noun })}
            onClick={() => onChange(rows.filter((_, at) => at !== index))}
          >
            <IconX />
          </Button>
        </div>
      ))}
      <div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={rows.length >= max}
          tooltip={rows.length >= max ? t("common.limitReached", { max }) : undefined}
          onClick={() => onChange([...rows, blank])}
        >
          <IconPlus />
          {addLabel}
        </Button>
      </div>
    </div>
  );
}

function BlockSettings({
  block,
  eventId,
  onChange,
}: {
  block: HomeBlock;
  eventId: string;
  onChange: (block: HomeBlock) => void;
}) {
  const t = useT();
  const [mode, setMode] = useMarkdownMode();
  const titleError = issueAt(block, ["title"]);
  const fallbackKey = block.type === "plugin" ? null : BLOCK_INFO[block.type].title;
  const fallback = fallbackKey ? t(fallbackKey) : "";
  const error = (...path: Array<string | number>) => issueAt(block, path);
  const field = (path: Tuple<string | number>, id: string) => ({
    id: `${block.id}-${id}`,
    "aria-invalid": issueAt(block, path) ? (true as const) : undefined,
  });

  return (
    <div className="flex flex-col gap-4">
      {block.type === "divider" ? (
        <p className="text-sm text-muted-fg">{t("homeEditor.nothingToSet")}</p>
      ) : (
        <Field data-invalid={titleError ? true : undefined}>
          <FieldLabel htmlFor={`${block.id}-title`}>{t("homeEditor.heading")}</FieldLabel>
          <Input
            id={`${block.id}-title`}
            value={block.title ?? ""}
            placeholder={fallback || t("homeEditor.noHeading")}
            aria-invalid={titleError ? true : undefined}
            onChange={(event) => onChange({ ...block, title: event.target.value })}
          />
          {titleError && <FieldError>{titleError}</FieldError>}
        </Field>
      )}

      {block.type === "text" && (
        <Field data-invalid={error("body") ? true : undefined}>
          <MarkdownLabel htmlFor={`${block.id}-body`} mode={mode} onModeChange={setMode}>
            {t("homeEditor.text")}
          </MarkdownLabel>
          <MarkdownEditor
            id={`${block.id}-body`}
            mode={mode}
            rows={6}
            value={block.body}
            placeholder={t("homeEditor.textPlaceholder")}
            onValueChange={(body) => onChange({ ...block, body })}
          />
          {error("body") && <FieldError>{error("body")}</FieldError>}
        </Field>
      )}

      {block.type === "callout" && (
        <>
          <Field>
            <FieldLabel htmlFor={`${block.id}-tone`}>{t("homeEditor.kind")}</FieldLabel>
            <OptSelect
              id={`${block.id}-tone`}
              value={block.tone}
              options={tones(t)}
              onChange={(tone) => onChange({ ...block, tone })}
            />
          </Field>
          <Field data-invalid={error("body") ? true : undefined}>
            <MarkdownLabel htmlFor={`${block.id}-body`} mode={mode} onModeChange={setMode}>
              {t("homeEditor.note")}
            </MarkdownLabel>
            <MarkdownEditor
              id={`${block.id}-body`}
              mode={mode}
              rows={3}
              features="short"
              value={block.body}
              placeholder={t("homeEditor.notePlaceholder")}
              onValueChange={(body) => onChange({ ...block, body })}
            />
            {error("body") && <FieldError>{error("body")}</FieldError>}
          </Field>
        </>
      )}

      {block.type === "faq" && (
        <Rows
          rows={block.questions}
          max={20}
          noun={t("homeEditor.question")}
          addLabel={t("homeEditor.addQuestion")}
          blank={{ question: "", answer: "" }}
          onChange={(questions) => onChange({ ...block, questions })}
        >
          {(row, index, set) => (
            <div className="flex flex-col gap-2">
              <Field data-invalid={error("questions", index, "question") ? true : undefined}>
                <FieldLabel htmlFor={`${block.id}-${index}-q`} className="sr-only">
                  {t("homeEditor.question")}
                </FieldLabel>
                <Input
                  {...field(["questions", index, "question"], `${index}-q`)}
                  value={row.question}
                  placeholder={t("homeEditor.questionPlaceholder")}
                  onChange={(event) => set({ question: event.target.value })}
                />
                {error("questions", index, "question") && (
                  <FieldError>{error("questions", index, "question")}</FieldError>
                )}
              </Field>
              <Field data-invalid={error("questions", index, "answer") ? true : undefined}>
                <FieldLabel htmlFor={`${block.id}-${index}-a`} className="sr-only">
                  {t("homeEditor.answer")}
                </FieldLabel>
                <Textarea
                  {...field(["questions", index, "answer"], `${index}-a`)}
                  rows={3}
                  value={row.answer}
                  placeholder={t("homeEditor.answerPlaceholder")}
                  onChange={(event) => set({ answer: event.target.value })}
                />
                {error("questions", index, "answer") && (
                  <FieldError>{error("questions", index, "answer")}</FieldError>
                )}
              </Field>
            </div>
          )}
        </Rows>
      )}

      {block.type === "image" && (
        <>
          <Field data-invalid={error("image", "url") ? true : undefined}>
            <FieldLabel htmlFor={`${block.id}-url`}>{t("homeEditor.image")}</FieldLabel>
            <ImageInput
              id={`${block.id}-url`}
              eventId={eventId}
              value={block.image.url}
              invalid={!!error("image", "url")}
              onChange={(url) => onChange({ ...block, image: { ...block.image, url } })}
            />
            {error("image", "url") && <FieldError>{error("image", "url")}</FieldError>}
          </Field>
          <Field data-invalid={error("image", "alt") ? true : undefined}>
            <FieldLabel htmlFor={`${block.id}-alt`}>{t("homeEditor.description")}</FieldLabel>
            <Input
              {...field(["image", "alt"], "alt")}
              value={block.image.alt}
              placeholder={t("homeEditor.altPlaceholder")}
              onChange={(event) =>
                onChange({ ...block, image: { ...block.image, alt: event.target.value } })
              }
            />
            {error("image", "alt") && <FieldError>{error("image", "alt")}</FieldError>}
          </Field>
          <Field data-invalid={error("caption") ? true : undefined}>
            <FieldLabel htmlFor={`${block.id}-caption`}>{t("homeEditor.caption")}</FieldLabel>
            <Input
              {...field(["caption"], "caption")}
              value={block.caption ?? ""}
              onChange={(event) => onChange({ ...block, caption: event.target.value })}
            />
            {error("caption") && <FieldError>{error("caption")}</FieldError>}
          </Field>
        </>
      )}

      {block.type === "sponsors" && (
        <Rows
          rows={block.sponsors}
          max={40}
          noun={t("homeEditor.sponsor")}
          addLabel={t("homeEditor.addSponsor")}
          blank={{ name: "", logo: "", url: undefined }}
          onChange={(sponsors) => onChange({ ...block, sponsors })}
        >
          {(row, index, set) => (
            <div className="flex flex-col gap-2 rounded-2xl border border-border p-3">
              <Field data-invalid={error("sponsors", index, "name") ? true : undefined}>
                <FieldLabel htmlFor={`${block.id}-${index}-name`} className="sr-only">
                  {t("homeEditor.name")}
                </FieldLabel>
                <Input
                  {...field(["sponsors", index, "name"], `${index}-name`)}
                  value={row.name}
                  placeholder={t("homeEditor.name")}
                  onChange={(event) => set({ name: event.target.value })}
                />
                {error("sponsors", index, "name") && (
                  <FieldError>{error("sponsors", index, "name")}</FieldError>
                )}
              </Field>
              <Field data-invalid={error("sponsors", index, "logo") ? true : undefined}>
                <FieldLabel htmlFor={`${block.id}-${index}-logo`} className="sr-only">
                  {t("homeEditor.logo")}
                </FieldLabel>
                <ImageInput
                  id={`${block.id}-${index}-logo`}
                  eventId={eventId}
                  compact
                  value={row.logo}
                  placeholder={t("homeEditor.logoPlaceholder")}
                  invalid={!!error("sponsors", index, "logo")}
                  onChange={(logo) => set({ logo })}
                />
                {error("sponsors", index, "logo") && (
                  <FieldError>{error("sponsors", index, "logo")}</FieldError>
                )}
              </Field>
              <Field data-invalid={error("sponsors", index, "url") ? true : undefined}>
                <FieldLabel htmlFor={`${block.id}-${index}-site`} className="sr-only">
                  {t("homeEditor.website")}
                </FieldLabel>
                <Input
                  {...field(["sponsors", index, "url"], `${index}-site`)}
                  type="url"
                  value={row.url ?? ""}
                  placeholder={t("homeEditor.websitePlaceholder")}
                  onChange={(event) => set({ url: event.target.value || undefined })}
                />
                {error("sponsors", index, "url") && (
                  <FieldError>{error("sponsors", index, "url")}</FieldError>
                )}
              </Field>
            </div>
          )}
        </Rows>
      )}

      {block.type === "about" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-fg">
            <AboutHelp />
          </p>
          <Rows
            rows={block.images ?? []}
            max={12}
            noun={t("homeEditor.imageNoun")}
            addLabel={t("homeEditor.addImage")}
            blank={{ url: "", alt: "" }}
            onChange={(images) => onChange({ ...block, images })}
          >
            {(row, index, set) => (
              <div className="flex flex-col gap-2">
                <Field data-invalid={error("images", index, "url") ? true : undefined}>
                  <FieldLabel htmlFor={`${block.id}-${index}-img`} className="sr-only">
                    {t("homeEditor.image")}
                  </FieldLabel>
                  <ImageInput
                    id={`${block.id}-${index}-img`}
                    eventId={eventId}
                    compact
                    value={row.url}
                    invalid={!!error("images", index, "url")}
                    onChange={(url) => set({ url })}
                  />
                  {error("images", index, "url") && (
                    <FieldError>{error("images", index, "url")}</FieldError>
                  )}
                </Field>
                <Field data-invalid={error("images", index, "alt") ? true : undefined}>
                  <FieldLabel htmlFor={`${block.id}-${index}-alt`} className="sr-only">
                    {t("homeEditor.description")}
                  </FieldLabel>
                  <Input
                    {...field(["images", index, "alt"], `${index}-alt`)}
                    value={row.alt}
                    placeholder={t("homeEditor.altPlaceholderShort")}
                    onChange={(event) => set({ alt: event.target.value })}
                  />
                  {error("images", index, "alt") && (
                    <FieldError>{error("images", index, "alt")}</FieldError>
                  )}
                </Field>
              </div>
            )}
          </Rows>
        </div>
      )}

      {block.type === "links" && (
        <Rows
          rows={block.links}
          max={12}
          noun={t("homeEditor.link")}
          addLabel={t("homeEditor.addLink")}
          blank={{ label: "", url: "" }}
          onChange={(links) => onChange({ ...block, links })}
        >
          {(row, index, set) => (
            <div className="grid min-w-0 gap-2 sm:grid-cols-[1fr_2fr]">
              <Field data-invalid={error("links", index, "label") ? true : undefined}>
                <FieldLabel htmlFor={`${block.id}-${index}-label`} className="sr-only">
                  {t("homeEditor.label")}
                </FieldLabel>
                <Input
                  {...field(["links", index, "label"], `${index}-label`)}
                  value={row.label}
                  placeholder="Devpost"
                  onChange={(event) => set({ label: event.target.value })}
                />
                {error("links", index, "label") && (
                  <FieldError>{error("links", index, "label")}</FieldError>
                )}
              </Field>
              <Field data-invalid={error("links", index, "url") ? true : undefined}>
                <FieldLabel htmlFor={`${block.id}-${index}-url`} className="sr-only">
                  {t("homeEditor.address")}
                </FieldLabel>
                <Input
                  {...field(["links", index, "url"], `${index}-url`)}
                  type="url"
                  value={row.url}
                  placeholder="https://..."
                  onChange={(event) => set({ url: event.target.value })}
                />
                {error("links", index, "url") && (
                  <FieldError>{error("links", index, "url")}</FieldError>
                )}
              </Field>
            </div>
          )}
        </Rows>
      )}

      {block.type === "countdown" && (
        <Field>
          <FieldLabel htmlFor={`${block.id}-to`}>{t("homeEditor.countsDown")}</FieldLabel>
          <OptSelect
            id={`${block.id}-to`}
            value={block.to}
            options={countdownTargets(t)}
            onChange={(to) => onChange({ ...block, to })}
          />
        </Field>
      )}
    </div>
  );
}

function AboutHelp() {
  const t = useT();
  const slug = useEventViewer()?.event.slug ?? "";
  return (
    <Linked
      text={t("homeEditor.aboutHelp", { details: LINK, privacy: LINK })}
      links={[
        <SettingLink key="details" to={`/events/${slug}/manage/details`} hash="details.about">
          {t("path.manageDetails")}
        </SettingLink>,
        <SettingLink key="privacy" to={`/events/${slug}/manage/security`} hash="privacy.about">
          {t("path.beforeApproval")}
        </SettingLink>,
      ]}
    />
  );
}
