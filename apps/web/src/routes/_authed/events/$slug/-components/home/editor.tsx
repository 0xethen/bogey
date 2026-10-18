import { useState, type ReactNode, type SetStateAction } from "react";
import { IconPlug, IconPlus, IconX } from "@tabler/icons-react";
import {
  CALLOUT_TONES,
  HOME_BUILT_IN_BLOCKS,
  HOME_CUSTOM_BLOCKS,
  homeBlockSchema,
  type CalloutTone,
  type HomeBlock,
  type HomeLayout,
} from "@bogey/config/settings";
import { Button } from "@bogey/ui/components/button";
import {
  EditableList,
  EditableListGroup,
  EditableListItem,
  EditableListPalette,
  EditableListSource,
  type EditableListPosition,
} from "@bogey/ui/components/editable-list";
import { Field, FieldError, FieldLabel } from "@bogey/ui/components/field";
import { Input } from "@bogey/ui/components/input";
import {
  MarkdownEditor,
  MarkdownLabel,
  useMarkdownMode,
} from "@bogey/ui/components/markdown-input";
import { OptSelect, type SelectOption } from "@bogey/ui/components/opt-select";
import { Textarea } from "@bogey/ui/components/textarea";
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

const COLUMNS: Tuple<{ key: Column; label: PlainKey; hint: PlainKey }> = [
  { key: "main", label: "homeEditor.main", hint: "homeEditor.mainHint" },
  { key: "aside", label: "homeEditor.side", hint: "homeEditor.sideHint" },
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

function hasSettings(block: HomeBlock): boolean {
  return block.type !== "divider";
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
  const [active, setActive] = useState<string | null>(null);
  const [previewing, setPreviewingState] = useState<string | null>(null);
  const palette = templates(layout, data, t);
  const previewed = palette
    .flatMap((group) => group.items)
    .find((template) => template.key === previewing);

  const replace = (column: Column, block: HomeBlock) =>
    onChange({
      ...layout,
      [column]: layout[column].map((each) => (each.id === block.id ? block : each)),
    });
  const add = (key: string, to: EditableListPosition) => {
    const template = palette.flatMap((group) => group.items).find((each) => each.key === key);
    if (!template || !isColumn(to.list)) return;
    const block = template.make();
    onChange({ ...layout, [to.list]: layout[to.list].toSpliced(to.index, 0, block) });
    if (isCustom(block) && hasSettings(block)) setActive(block.id);
  };

  const setPreviewing = (state: SetStateAction<string | null>) => {
    setTimeout(() => setPreviewingState(state), 100);
  };

  return (
    <EditableListGroup
      onMove={(from, to) => onChange(moveBlock(layout, from, to))}
      onAdd={add}
      onRemove={(from) => {
        if (!isColumn(from.list)) return;
        onChange({ ...layout, [from.list]: layout[from.list].toSpliced(from.index, 1) });
      }}
    >
      <div className="flex flex-col gap-8">
        <EditableListPalette
          label={t("homeEditor.palette")}
          removeLabel={t("homeEditor.remove")}
          className="sticky top-[calc(var(--layout-offset,0px)+--spacing(3))] z-10 rounded-3xl border border-border bg-background/95 p-3 shadow-sm backdrop-blur supports-backdrop-filter:bg-background/80 sm:p-4"
        >
          <div className="flex flex-col gap-3">
            <div className="grid max-h-40 scroll-fade gap-x-6 gap-y-2 overflow-y-auto scrollbar-thin sm:max-h-none lg:grid-cols-2">
              {palette.map((group) => (
                <div key={group.key} className="flex flex-wrap items-center gap-1.5">
                  <h3
                    className="w-full text-[0.6875rem] font-semibold tracking-wide text-muted-fg uppercase sm:w-24 sm:shrink-0"
                    title={group.hint}
                  >
                    {group.label}
                  </h3>
                  {group.items.map((template) => (
                    <EditableListSource
                      key={template.key}
                      id={template.key}
                      title={template.description}
                      onPreview={(shown) =>
                        setPreviewing((current) =>
                          shown ? template.key : current === template.key ? null : current,
                        )
                      }
                      onActivate={() =>
                        add(template.key, { list: "main", index: layout.main.length })
                      }
                      className="inline-flex items-center gap-1.5 rounded-pill bg-muted/40 py-1 pr-3 pl-1.5 text-sm"
                    >
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-pill bg-primary/10 text-primary-text">
                        <template.icon className="size-3.5" />
                      </span>
                      <span className="font-medium">{template.label}</span>
                    </EditableListSource>
                  ))}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-fg">
              {previewed ? (
                <>
                  <span className="font-medium text-fg">{previewed.label}.</span>{" "}
                  {previewed.description}
                </>
              ) : (
                <>
                  <span className="font-medium text-fg">{t("homeEditor.addBlock")}</span>{" "}
                  {t("homeEditor.addHelp")}
                </>
              )}
            </p>
          </div>
        </EditableListPalette>

        <div className="grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          {COLUMNS.map((column) => (
            <section
              key={column.key}
              aria-label={t(column.label)}
              className="flex min-w-0 flex-col gap-3"
            >
              <header className="flex items-baseline justify-between gap-3 border-b border-border pb-2">
                <div className="flex flex-col">
                  <h2 className="text-sm font-semibold">{t(column.label)}</h2>
                  <p className="text-xs text-muted-fg">{t(column.hint)}</p>
                </div>
                <span className="text-xs text-muted-fg tabular-nums">
                  {t("homeEditor.blocks", { count: layout[column.key].length })}
                </span>
              </header>
              <EditableList id={column.key} empty={t("homeEditor.empty")}>
                {layout[column.key].map((block, index) => {
                  const label = blockLabel(block, data.plugins, t);
                  return (
                    <EditableListItem
                      key={block.id}
                      id={block.id}
                      index={index}
                      noun={label}
                      title={label}
                      numbered={false}
                      handle={false}
                      editWith="button"
                      onRemove={() =>
                        onChange({
                          ...layout,
                          [column.key]: layout[column.key].filter((each) => each.id !== block.id),
                        })
                      }
                      onDuplicate={
                        isCustom(block)
                          ? () =>
                              onChange({
                                ...layout,
                                [column.key]: layout[column.key].toSpliced(index + 1, 0, {
                                  ...block,
                                  id: newId(block.type),
                                }),
                              })
                          : undefined
                      }
                      preview={<HomeBlockView block={block} data={data} customizing />}
                      editing={active === block.id || !homeBlockSchema.safeParse(block).success}
                      onEdit={() => setActive(block.id)}
                      onDone={() => setActive(null)}
                    >
                      <BlockSettings
                        block={block}
                        eventId={data.event.id}
                        onChange={(next) => replace(column.key, next)}
                      />
                    </EditableListItem>
                  );
                })}
              </EditableList>
            </section>
          ))}
        </div>
      </div>
    </EditableListGroup>
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
            title={t("homeEditor.removeNoun", { noun })}
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
