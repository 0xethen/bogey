import {
  Children,
  createContext,
  useContext,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
} from "react";
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
import { useReducedMotion } from "@bogey/ui/hooks/reduced-motion";
import { cn } from "@bogey/ui/lib/utils";
import { Button } from "./button.tsx";

export interface EditableListPosition {
  list: string;
  index: number;
}

type GroupMove = (from: EditableListPosition, to: EditableListPosition) => void;

interface Mover {
  move: (from: number, to: number) => void;
  count: number;
  announce: (message: string) => void;
}

const InGroup = createContext<GroupMove | null>(null);
const Horizontal = createContext(false);
const ListId = createContext<string | undefined>(undefined);
const ListMover = createContext<Mover | null>(null);
const DropBefore = createContext<string | null>(null);

const ITEM = "editable-list-item";
const END = ":end";
const REMOVE = "editable-list:remove";

const sensors: ComponentProps<typeof DragDropProvider>["sensors"] = (defaults) => [
  ...defaults.filter((sensor) => sensor !== PointerSensor),
  PointerSensor.configure({
    activationConstraints: (event) =>
      event.pointerType === "touch"
        ? [new PointerActivationConstraints.Delay({ value: 180, tolerance: 8 })]
        : [new PointerActivationConstraints.Distance({ value: 6 })],
  }),
];

const STILL: ComponentProps<typeof DragDropProvider>["plugins"] = (defaults) => [
  ...defaults.filter((plugin) => plugin !== Feedback),
  Feedback.configure({ dropAnimation: null, keyboardTransition: null }),
];

const INSTANT = { duration: 0, idle: false };

const KEEP_IN_PLACE = [Feedback.configure({ feedback: "clone" })];

function addedKey(data: unknown): string | null {
  return typeof data === "object" && data !== null && "add" in data && typeof data.add === "string"
    ? data.add
    : null;
}

function Provider(props: Omit<ComponentProps<typeof DragDropProvider>, "sensors" | "plugins">) {
  const reduced = useReducedMotion();
  return <DragDropProvider sensors={sensors} plugins={reduced ? STILL : undefined} {...props} />;
}

function Announcer({ message }: { message: string }) {
  return (
    <p role="status" className="sr-only">
      {message}
    </p>
  );
}

/** Lets items move between several EditableLists (each with an `id`), and in from sources. */
export function EditableListGroup({
  onMove,
  onAdd,
  onRemove,
  children,
}: {
  onMove: GroupMove;
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
    <Provider onDragOver={over} onDragEnd={end}>
      <InGroup value={onMove}>{children}</InGroup>
    </Provider>
  );
}

/** Something to drag into an EditableListGroup's lists; clicking it calls `onActivate`. */
export function EditableListSource({
  id,
  onActivate,
  title,
  className,
  children,
}: {
  id: string;
  onActivate?: () => void;
  title?: string;
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
      aria-description={title}
      data-dragging={isDragging || undefined}
      className={cn(
        "cursor-grab text-left transition-[background-color,border-color,box-shadow,opacity] active:cursor-grabbing data-dragging:opacity-50",
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
  const group = useContext(InGroup);
  const [message, announce] = useState("");
  const count = Children.toArray(children).length;
  if (group && id !== undefined) {
    return (
      <ListMover
        value={{
          move: (from, to) => group({ list: id, index: from }, { list: id, index: to }),
          count,
          announce,
        }}
      >
        <GroupedList id={id} empty={count > 0 ? undefined : empty}>
          {children}
        </GroupedList>
        <Announcer message={message} />
      </ListMover>
    );
  }
  if (count === 0 && empty) return <p className="text-sm text-muted-fg">{empty}</p>;

  const end = (event: DragEndEvent) => {
    const { source } = event.operation;
    if (event.canceled || !isSortable(source) || source.initialIndex === source.index) return;
    onMove?.(source.initialIndex, source.index);
  };

  return (
    <Provider onDragEnd={end}>
      <ListMover value={{ move: (from, to) => onMove?.(from, to), count, announce }}>
        <Horizontal value={orientation === "horizontal"}>
          <ol
            className={cn(
              "flex",
              orientation === "horizontal" ? "flex-row flex-wrap gap-2" : "flex-col gap-2",
            )}
          >
            {children}
          </ol>
        </Horizontal>
        <Announcer message={message} />
      </ListMover>
    </Provider>
  );
}

/** Holds EditableListSources; while an item is dragged it turns into a place to drop it to remove it. */
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
            "flex flex-col gap-3 rounded-3xl outline-offset-8 transition-[background-color,outline-color] duration-200 ease-out",
            "data-adding:outline-2 data-adding:outline-border data-adding:outline-dashed",
            "data-over:bg-primary/5 data-over:outline-primary/40",
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
      className="flex min-h-12 items-center justify-center rounded-2xl border border-dashed border-border px-4 text-center text-sm text-muted-fg transition-colors duration-200 data-over:border-primary/50 data-over:bg-primary/5 data-over:text-fg"
    >
      {children}
    </li>
  );
}

function EndZone({ id }: { id: string }) {
  const { ref, isDropTarget } = useDroppable({ id, type: "editable-list", accept: ITEM });
  return (
    <li ref={ref} aria-hidden className="relative min-h-16 flex-1 rounded-2xl">
      {isDropTarget && <DropLine className="top-0" />}
    </li>
  );
}

function DropLine({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute inset-x-0 h-0.5 rounded-full bg-primary motion-safe:animate-in motion-safe:fade-in",
        "before:absolute before:-top-[3px] before:-left-1 before:size-2 before:rounded-full before:border-2 before:border-primary before:bg-background",
        className,
      )}
    />
  );
}

// the empty slot dnd-kit leaves where a dragged item will land
const SLOT =
  "data-dnd-placeholder:after:visible data-dnd-placeholder:after:absolute data-dnd-placeholder:after:inset-0 data-dnd-placeholder:after:rounded-[inherit] data-dnd-placeholder:after:border-2 data-dnd-placeholder:after:border-dashed data-dnd-placeholder:after:border-primary/40 data-dnd-placeholder:after:bg-primary/5 data-dnd-placeholder:after:content-['']";

// wide screens with a mouse: actions float over the row's end and show on hover or focus
const REVEAL = [
  "motion-hover",
  "[@media(hover:hover)_and_(pointer:fine)_and_(min-width:40rem)]:absolute",
  "[@media(hover:hover)_and_(pointer:fine)_and_(min-width:40rem)]:top-2",
  "[@media(hover:hover)_and_(pointer:fine)_and_(min-width:40rem)]:right-2",
  "[@media(hover:hover)_and_(pointer:fine)_and_(min-width:40rem)]:rounded-lg",
  "[@media(hover:hover)_and_(pointer:fine)_and_(min-width:40rem)]:bg-background",
  "[@media(hover:hover)_and_(pointer:fine)_and_(min-width:40rem)]:pointer-events-none",
  "[@media(hover:hover)_and_(pointer:fine)_and_(min-width:40rem)]:opacity-0",
  "[@media(hover:hover)_and_(pointer:fine)_and_(min-width:40rem)]:group-hover/item:pointer-events-auto",
  "[@media(hover:hover)_and_(pointer:fine)_and_(min-width:40rem)]:group-hover/item:opacity-100",
  "[@media(hover:hover)_and_(pointer:fine)_and_(min-width:40rem)]:group-focus-within/item:pointer-events-auto",
  "[@media(hover:hover)_and_(pointer:fine)_and_(min-width:40rem)]:group-focus-within/item:opacity-100",
  "[@media(hover:hover)_and_(pointer:fine)_and_(min-width:40rem)]:has-aria-expanded:pointer-events-auto",
  "[@media(hover:hover)_and_(pointer:fine)_and_(min-width:40rem)]:has-aria-expanded:opacity-100",
].join(" ");

const KEY_STEP: Record<string, number> = {
  ArrowUp: -1,
  ArrowLeft: -1,
  ArrowDown: 1,
  ArrowRight: 1,
};

/**
 * A row in an EditableList: a drag handle, a preview (or the fields while editing), and actions
 * at the end. Alt and an arrow key on the handle moves it. See docs/architecture/ui-conventions.md.
 */
export function EditableListItem({
  id,
  index,
  noun = "item",
  title,
  icon,
  numbered = true,
  onRemove,
  onDuplicate,
  confirmRemove,
  actions: extra,
  footer,
  preview,
  editing = true,
  selected = false,
  dimmed = false,
  onEdit,
  onDone,
  children,
}: {
  id: string;
  index: number;
  noun?: string;
  /** A header above the preview, for items that show a large preview like a homepage block. */
  title?: ReactNode;
  icon?: ReactNode;
  numbered?: boolean;
  onRemove?: () => void;
  onDuplicate?: () => void;
  confirmRemove?: string;
  /** More buttons, shown before the built-in ones. */
  actions?: ReactNode;
  footer?: ReactNode;
  preview?: ReactNode;
  editing?: boolean;
  /** Marked as the one being edited elsewhere, like a tab whose settings show below the row. */
  selected?: boolean;
  /** Fades the preview, for items that are kept but not shown. */
  dimmed?: boolean;
  onEdit?: () => void;
  onDone?: () => void;
  children?: ReactNode;
}) {
  const t = useUiText();
  const group = useContext(ListId);
  const horizontal = useContext(Horizontal);
  const mover = useContext(ListMover);
  const dropsBefore = useContext(DropBefore) === id;
  const reduced = useReducedMotion();
  const { ref, handleRef, isDragging } = useSortable({
    id,
    index,
    type: ITEM,
    accept: ITEM,
    ...(reduced ? { transition: INSTANT } : {}),
    ...(group !== undefined ? { group } : {}),
  });
  const label = numbered ? `${noun} ${index + 1}` : noun;
  const previewing = preview !== undefined && !editing;
  const clickable = previewing && onEdit !== undefined;

  const keyMove = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = KEY_STEP[event.key];
    if (!event.altKey || step === undefined || !mover) return;
    event.preventDefault();
    const to = index + step;
    if (to < 0 || to >= mover.count) return;
    const handle = event.currentTarget;
    mover.move(index, to);
    mover.announce(t("ui.movedTo", { name: label, position: to + 1, count: mover.count }));
    // reordering the list drops focus from the moved row
    requestAnimationFrame(() => handle.focus());
  };

  const grip = (
    <button
      ref={handleRef}
      type="button"
      data-slot="editable-handle"
      aria-label={t("ui.reorder", { name: label })}
      aria-description={t("ui.reorderHint")}
      aria-keyshortcuts={horizontal ? "Alt+ArrowLeft Alt+ArrowRight" : "Alt+ArrowUp Alt+ArrowDown"}
      onKeyDown={keyMove}
      className={cn(
        "relative z-1 flex shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted-fg/70 transition-colors hocus:bg-muted hocus:text-fg active:cursor-grabbing group-data-dragging/item:text-fg",
        horizontal ? "size-6" : "size-8",
      )}
    >
      <IconGripVertical className="size-4" />
    </button>
  );

  const actions = !horizontal && (
    <div className={cn("relative z-1 flex shrink-0 items-center gap-0.5", !editing && REVEAL)}>
      {extra}
      {clickable && (
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
                  title: `${t("ui.removeTitle", { name: label })}...`,
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

  const shown = (
    <div
      inert
      data-slot="editable-content"
      className={cn(
        "flex min-w-0 flex-col justify-center transition-opacity",
        !horizontal && "min-h-8",
        title === undefined && "text-sm",
        dimmed && "opacity-50",
      )}
    >
      {preview}
    </div>
  );

  const body = clickable ? (
    <div
      role="button"
      tabIndex={0}
      data-slot="editable-preview"
      aria-label={t("ui.editNamed", { name: label })}
      aria-pressed={selected || undefined}
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
      {shown}
    </div>
  ) : (
    <div className="min-w-0 flex-1">{shown}</div>
  );

  const heading =
    title !== undefined ? (
      <div className="flex h-8 min-w-0 flex-1 items-center gap-2 text-sm font-medium">
        {icon && <span className="flex shrink-0 text-muted-fg [&_svg]:size-4">{icon}</span>}
        <span className="min-w-0 truncate">{title}</span>
      </div>
    ) : editing ? (
      <div className="flex h-8 min-w-0 flex-1 items-center text-sm font-medium text-muted-fg first-letter:uppercase">
        {label}
      </div>
    ) : (
      <>
        {numbered && (
          <span className="flex h-8 w-5 shrink-0 items-center justify-end text-sm text-muted-fg tabular-nums">
            {index + 1}
          </span>
        )}
        {icon && (
          <span className="flex h-8 shrink-0 items-center text-muted-fg [&_svg]:size-4">
            {icon}
          </span>
        )}
        {body}
      </>
    );

  return (
    <li
      ref={ref}
      data-dragging={isDragging || undefined}
      data-selected={selected || undefined}
      className={cn("group/item relative", horizontal ? "rounded-xl" : "rounded-2xl", SLOT)}
    >
      {dropsBefore && <DropLine className="-top-2" />}
      <div
        className={cn(
          "relative flex flex-col rounded-[inherit] border border-border bg-background transition-[background-color,border-color,box-shadow]",
          clickable &&
            "has-[[data-slot=editable-preview]:hover]:border-ring/30 has-[[data-slot=editable-preview]:hover]:bg-accent/40 has-[[data-slot=editable-preview]:focus-visible]:focus-ring",
          editing && preview !== undefined && "border-ring/40 shadow-sm",
          selected && "border-primary/50 bg-accent/40 ring-2 ring-primary/15",
          "group-data-dragging/item:cursor-grabbing group-data-dragging/item:border-primary/40 group-data-dragging/item:shadow-xl group-data-dragging/item:ring-2 group-data-dragging/item:ring-primary/15",
        )}
      >
        <div
          className={cn(
            "flex gap-1",
            horizontal ? "items-center py-1 pr-3 pl-1" : "items-start p-2",
          )}
        >
          {grip}
          {heading}
          {actions}
        </div>
        {title !== undefined && preview !== undefined && (
          <div className="flex border-t border-border p-3">{body}</div>
        )}
        {editing && children && (
          <div
            className={cn(
              "flex flex-col gap-3 px-3 pb-3",
              title !== undefined ? "border-t border-border pt-3" : "sm:pl-11",
            )}
          >
            {children}
          </div>
        )}
        {footer && !horizontal && (
          <div className="-mt-1 px-3 pb-2.5 text-xs text-muted-fg sm:pl-11">{footer}</div>
        )}
      </div>
    </li>
  );
}
