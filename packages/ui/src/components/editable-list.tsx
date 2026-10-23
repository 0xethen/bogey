import { createContext, useContext, type ComponentProps, type ReactNode } from "react";
import { useUiText } from "../lib/ui-text.ts";
import { Feedback, PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import {
  DragDropProvider,
  useDragOperation,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import { IconCheck, IconCopy, IconGripVertical, IconPencil, IconTrash } from "@tabler/icons-react";
import { cn } from "@bogey/ui/lib/utils";
import { Button } from "./button.tsx";

export interface EditableListPosition {
  list: string;
  index: number;
}

const InGroup = createContext(false);
const Horizontal = createContext(false);
const ListId = createContext<string | undefined>(undefined);

const ITEM = "editable-list-item";

const DropBefore = createContext<string | null>(null);

const sensors: ComponentProps<typeof DragDropProvider>["sensors"] = (defaults) => [
  ...defaults.filter((sensor) => sensor !== PointerSensor),
  PointerSensor.configure({
    activationConstraints: (event) =>
      event.pointerType === "touch"
        ? [new PointerActivationConstraints.Delay({ value: 180, tolerance: 8 })]
        : [new PointerActivationConstraints.Distance({ value: 6 })],
  }),
];

const KEEP_IN_PLACE = [Feedback.configure({ feedback: "clone" })];

function addedKey(data: unknown): string | null {
  return typeof data === "object" && data !== null && "add" in data && typeof data.add === "string"
    ? data.add
    : null;
}

export function EditableListGroup({
  onMove,
  onAdd,
  onRemove,
  children,
}: {
  onMove: (from: EditableListPosition, to: EditableListPosition) => void;
  onAdd?: (key: string, to: EditableListPosition) => void;
  onRemove?: (from: EditableListPosition) => void;
  children: ReactNode;
}) {
  const over = (event: DragOverEvent) => {
    const { source, target } = event.operation;
    if (!source || !target || !isSortable(source)) return;
    event.preventDefault();
    if (target.id === source.id || target.id === REMOVE) return;
    const list = isSortable(target) ? target.group : target.id;
    if (list === undefined) return;
    const from = { list: String(source.group), index: source.index };
    const to = { list: String(list), index: isSortable(target) ? target.index : 0 };
    if (from.list !== to.list || from.index !== to.index) onMove(from, to);
  };

  const end = (event: DragEndEvent) => {
    const { source, target } = event.operation;
    if (!source) return;
    const add = isSortable(source) ? null : addedKey(source.data);
    if (add !== null) {
      if (event.canceled || !target) return;
      if (isSortable(target)) {
        onAdd?.(add, { list: String(target.group), index: target.index });
      } else {
        const ending = String(target.id).endsWith(END);
        const list = ending ? String(target.id).slice(0, -END.length) : String(target.id);
        onAdd?.(add, { list, index: ending ? Number.MAX_SAFE_INTEGER : 0 });
      }
      return;
    }
    if (!event.canceled && isSortable(source) && target?.id === REMOVE) {
      onRemove?.({ list: String(source.group), index: source.index });
      return;
    }
    if (!event.canceled || !isSortable(source)) return;
    const from = { list: String(source.group), index: source.index };
    const start = { list: String(source.initialGroup), index: source.initialIndex };
    if (from.list !== start.list || from.index !== start.index) onMove(from, start);
  };

  return (
    <DragDropProvider sensors={sensors} onDragOver={over} onDragEnd={end}>
      <InGroup value={true}>{children}</InGroup>
    </DragDropProvider>
  );
}

export function EditableListSource({
  id,
  onActivate,
  title,
  onPreview,
  className,
  children,
}: {
  id: string;
  onActivate?: () => void;
  title?: string;
  onPreview?: (shown: boolean) => void;
  className?: string;
  children: ReactNode;
}) {
  const { ref, isDragging } = useDraggable({
    id: `source:${id}`,
    type: ITEM,
    data: { add: id },
    plugins: KEEP_IN_PLACE,
  });
  return (
    <button
      ref={ref}
      type="button"
      onClick={onActivate}
      title={onPreview ? undefined : title}
      aria-description={title}
      onPointerEnter={onPreview && (() => onPreview(true))}
      onPointerLeave={onPreview && (() => onPreview(false))}
      onFocus={onPreview && (() => onPreview(true))}
      onBlur={onPreview && (() => onPreview(false))}
      data-dragging={isDragging || undefined}
      className={cn(
        "cursor-grab rounded-2xl border border-border bg-background text-left transition-[background-color,border-color,box-shadow] hocus:border-accent/30 hocus:bg-accent/60 active:cursor-grabbing",
        isDragging && "border-accent/30 bg-accent/60 opacity-60 shadow-lg",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function EditableList({
  id,
  onMove,
  empty,
  orientation = "vertical",
  children,
}: {
  id?: string;
  onMove?: (from: number, to: number) => void;
  empty?: ReactNode;
  /** `horizontal` lays the items out in a wrapping row, like tabs. */
  orientation?: "vertical" | "horizontal";
  children: ReactNode;
}) {
  const grouped = useContext(InGroup);
  const hasItems = Array.isArray(children) ? children.length > 0 : !!children;
  if (grouped && id !== undefined) {
    return (
      <GroupedList id={id} empty={hasItems ? undefined : empty}>
        {children}
      </GroupedList>
    );
  }
  if (!hasItems && empty) return <p className="text-sm text-muted-fg">{empty}</p>;

  const end = (event: DragEndEvent) => {
    const { source } = event.operation;
    if (event.canceled || !isSortable(source) || source.initialIndex === source.index) return;
    onMove?.(source.initialIndex, source.index);
  };

  return (
    <DragDropProvider sensors={sensors} onDragEnd={end}>
      <Horizontal value={orientation === "horizontal"}>
        <ol
          className={cn(
            "flex gap-3",
            orientation === "horizontal" ? "flex-row flex-wrap gap-2" : "flex-col",
          )}
        >
          {children}
        </ol>
      </Horizontal>
    </DragDropProvider>
  );
}

const END = ":end";
const REMOVE = "editable-list:remove";

export function EditableListPalette({
  label,
  removeLabel,
  className,
  children,
}: {
  label: string;
  removeLabel?: string;
  className?: string;
  children: ReactNode;
}) {
  const t = useUiText();
  const { source } = useDragOperation();
  const removing = !!source && isSortable(source);
  const { ref, isDropTarget } = useDroppable({
    id: REMOVE,
    type: "editable-list",
    accept: ITEM,
    collisionPriority: 4,
  });
  return (
    <section
      ref={ref}
      aria-label={label}
      data-removing={removing || undefined}
      data-over={(removing && isDropTarget) || undefined}
      className={cn("relative transition-colors duration-200", className)}
    >
      <div className={cn("transition-opacity duration-200", removing && "opacity-0")}>
        {children}
      </div>
      {removing && (
        <div
          aria-hidden
          className={cn(
            "absolute inset-0 flex items-center justify-center gap-2 rounded-[inherit] border-2 border-dashed border-destructive/40 bg-destructive/5 text-sm font-medium text-destructive transition-colors duration-200 animate-in fade-in",
            isDropTarget && "border-destructive bg-destructive/15",
          )}
        >
          <IconTrash className="size-4" />
          {removeLabel ?? t("ui.dropToRemove")}
        </div>
      )}
    </section>
  );
}

function GroupedList({
  id,
  empty,
  children,
}: {
  id: string;
  empty?: ReactNode;
  children: ReactNode;
}) {
  const { source, target } = useDragOperation();
  const adding = !!source && !isSortable(source) && addedKey(source.data) !== null;
  const targetId = target ? String(target.id) : null;
  const beside = target && isSortable(target) && String(target.group) === id ? targetId : null;
  const over = adding && (beside !== null || targetId === id || targetId === `${id}${END}`);
  const before = adding ? beside : null;
  return (
    <ListId value={id}>
      <DropBefore value={before}>
        <ol
          data-adding={adding || undefined}
          data-over={over || undefined}
          className={cn(
            "flex flex-col gap-3 rounded-3xl transition-[background-color,box-shadow,padding,margin] duration-200 ease-out",
            "data-adding:-m-3 data-adding:bg-accent/50 data-adding:p-3 data-adding:ring-1 data-adding:ring-border",
            "data-over:bg-accent data-over:ring-ring/40",
          )}
        >
          {children}
          {empty && <DropZone id={id}>{empty}</DropZone>}
          {adding && !empty && <EndZone id={`${id}${END}`} />}
        </ol>
      </DropBefore>
    </ListId>
  );
}

function DropZone({ id, children }: { id: string; children: ReactNode }) {
  const { ref, isDropTarget } = useDroppable({ id, type: "editable-list", accept: ITEM });
  return (
    <li
      ref={ref}
      data-over={isDropTarget || undefined}
      className="flex min-h-12 items-center rounded-2xl border border-dashed border-border px-4 text-sm text-muted-fg transition-colors duration-200 data-over:border-ring data-over:bg-accent data-over:text-fg"
    >
      {children}
    </li>
  );
}

function EndZone({ id }: { id: string }) {
  const { ref, isDropTarget } = useDroppable({ id, type: "editable-list", accept: ITEM });
  return (
    <li
      ref={ref}
      aria-hidden
      data-over={isDropTarget || undefined}
      className="relative min-h-16 flex-1 rounded-2xl transition-colors duration-200 data-over:bg-accent"
    >
      {isDropTarget && <DropLine className="top-0" />}
    </li>
  );
}

function DropLine({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute inset-x-1 h-1 rounded-full bg-primary shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-primary)_20%,transparent)] animate-in duration-200 fade-in slide-in-from-top-2",
        className,
      )}
    />
  );
}

export function EditableListItem({
  id,
  index,
  noun = "item",
  title,
  onRemove,
  onDuplicate,
  confirmRemove,
  footer,
  preview,
  editing = true,
  selected = false,
  onEdit,
  onDone,
  numbered = true,
  handle = true,
  editWith = "card",
  children,
}: {
  id: string;
  index: number;
  noun?: string;
  title?: ReactNode;
  numbered?: boolean;
  handle?: boolean;
  editWith?: "card" | "button";
  onRemove?: () => void;
  onDuplicate?: () => void;
  confirmRemove?: string;
  footer?: ReactNode;
  preview?: ReactNode;
  editing?: boolean;
  /** Marked as the one being edited elsewhere, like a tab whose settings show below the row. */
  selected?: boolean;
  onEdit?: () => void;
  onDone?: () => void;
  children?: ReactNode;
}) {
  const t = useUiText();
  const group = useContext(ListId);
  const horizontal = useContext(Horizontal);
  const dropsBefore = useContext(DropBefore) === id;
  const { ref, handleRef, isDragging } = useSortable({
    id,
    index,
    type: ITEM,
    accept: ITEM,
    disabled: !handle && editing && preview !== undefined,
    ...(group !== undefined ? { group } : {}),
  });
  const label = numbered ? `${noun} ${index + 1}` : noun;
  const previewing = preview !== undefined && !editing;
  const cardClicks = previewing && editWith === "card";

  const grip = handle && (
    <button
      ref={handleRef}
      type="button"
      aria-label={t("ui.reorder", { name: label })}
      className="relative z-1 flex h-6 w-5 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-fg hocus:bg-muted hocus:text-fg active:cursor-grabbing"
    >
      <IconGripVertical className="size-4" />
    </button>
  );

  const actions = (
    <div className="relative z-1 flex shrink-0 items-center gap-0.5">
      {previewing && editWith === "button" && (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={t("ui.editNamed", { name: label })}
          tooltip={t("ui.edit")}
          onClick={onEdit}
        >
          <IconPencil />
        </Button>
      )}
      {editing && onDone && (
        <Button
          type="button"
          size="icon-sm"
          aria-label={t("ui.doneEditing", { name: label })}
          tooltip={t("judging.done")}
          onClick={onDone}
        >
          <IconCheck />
        </Button>
      )}
      {onDuplicate && (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={t("ui.duplicate", { name: label })}
          tooltip={t("ui.duplicate", { name: label })}
          onClick={onDuplicate}
        >
          <IconCopy />
        </Button>
      )}
      {onRemove && (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost-destructive"
          aria-label={t("ui.removeNamed", { name: label })}
          tooltip={t("ui.removeNamed", { name: label })}
          confirm={
            confirmRemove
              ? {
                  title: t("ui.removeTitle", { name: label }),
                  description: confirmRemove,
                  label: t("twoFactor.remove"),
                }
              : undefined
          }
          onClick={onRemove}
        >
          <IconTrash />
        </Button>
      )}
    </div>
  );

  const content = cardClicks ? (
    <div
      role="button"
      tabIndex={0}
      data-slot="editable-preview"
      aria-label={t("ui.editNamed", { name: label })}
      onClick={onEdit}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onEdit?.();
        }
      }}
      className="min-w-0 flex-1 outline-none after:absolute after:inset-0 after:rounded-[inherit]"
    >
      <div inert className={cn(!horizontal && "py-1.5")}>
        {preview}
      </div>
    </div>
  ) : previewing ? (
    <div inert className="min-w-0 flex-1 py-1.5">
      {preview}
    </div>
  ) : (
    <div className="flex min-w-0 flex-1 flex-col gap-3">{children}</div>
  );

  return (
    <li
      ref={ref}
      data-dragging={isDragging || undefined}
      className={cn(
        "relative flex flex-col gap-3 rounded-2xl border border-border bg-background transition-[background-color,border-color,box-shadow]",
        horizontal ? "px-3 py-1.5" : "p-3",
        cardClicks &&
          "has-[[data-slot=editable-preview]:hover]:border-accent/30 has-[[data-slot=editable-preview]:hover]:bg-accent/60 has-[[data-slot=editable-preview]:focus-visible]:focus-ring",
        !handle &&
          previewing &&
          "cursor-grab hover:border-accent/30 hover:bg-accent/60 active:cursor-grabbing",
        ((preview !== undefined && editing) || selected) && "border-accent/30 bg-accent/60",
        isDragging && "border-accent/30 bg-accent/60 shadow-lg backdrop-blur-xs",
      )}
    >
      {dropsBefore && <DropLine className="-top-2" />}
      {title !== undefined ? (
        <>
          <header className="-mx-3 flex items-center gap-2 border-b border-border px-3 pb-3">
            {grip}
            <div className="min-w-0 flex-1 truncate text-xs font-medium tracking-wide text-muted-fg uppercase">
              {title}
            </div>
            {actions}
          </header>
          {content}
        </>
      ) : (
        <div className={cn("flex items-start", !horizontal && "gap-2")}>
          {grip && <div className="flex h-8 shrink-0 items-center">{grip}</div>}
          {numbered && (
            <span className="flex h-8 w-5 shrink-0 items-center text-sm text-muted-fg tabular-nums">
              {index + 1}.
            </span>
          )}
          {content}
          {actions}
        </div>
      )}
      {footer && (
        <div
          className={cn(
            "text-xs text-muted-fg",
            title === undefined && (handle || numbered) && "pl-7",
            title === undefined && handle && numbered && "pl-14",
          )}
        >
          {footer}
        </div>
      )}
    </li>
  );
}
