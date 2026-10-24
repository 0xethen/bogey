// TanStack Table's columns and rows change in place, so the compiler's caching would show stale state
"use no memo";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  columnFacetingFeature,
  columnFilteringFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createFacetedRowModel,
  createFacetedUniqueValues,
  createFilteredRowModel,
  createSortedRowModel,
  globalFilteringFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  useTable,
  type Column,
  type ColumnFiltersState,
  type ColumnVisibilityState,
  type FilterFn,
  type Row,
  type RowData,
  type SortingState,
  type TableOptions,
} from "@tanstack/react-table";
import {
  IconAdjustmentsHorizontal,
  IconArrowDown,
  IconArrowUp,
  IconArrowsSort,
  IconChevronRight,
  IconCirclePlus,
  IconFilterX,
  IconSearch,
} from "@tabler/icons-react";
import { cn } from "@bogey/ui/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table.tsx";
import { Checkbox } from "./checkbox.tsx";
import { Badge } from "./badge.tsx";
import { Button } from "./button.tsx";
import { OptSelect } from "./opt-select.tsx";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./input-group.tsx";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "./combobox.tsx";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./dropdown-menu.tsx";
import { PAGE_SIZES, PageControls, type Paging } from "./page-controls.tsx";
import { useUiText } from "../lib/ui-text.ts";

/** Per-column options the kit reads from `meta`. */
export interface DataColumnMeta {
  /** Names the column in the columns menu when its header isn't plain text. */
  label?: string;
  /** `end` lines the header and cells up at the right: numbers, and trailing actions (the default for an `actions` column). */
  align?: "start" | "end";
}

// end-aligned columns: numbers line up by digit, and an `actions` column hugs the right edge
function alignClass(column: { id: string; columnDef: { meta?: DataColumnMeta } }) {
  const end =
    (column.columnDef.meta?.align ?? (column.id === "actions" ? "end" : "start")) === "end";
  if (!end) return undefined;
  return cn("text-end *:data-[slot]:ml-auto", column.id === "actions" && "w-px");
}

// a faceted filter's value is the list of picked values; a row passes when it has any of them
function oneOf(
  row: { getUniqueValues: <V>(columnId: string) => V[] },
  columnId: string,
  picked: Tuple<string>,
) {
  return row.getUniqueValues<unknown>(columnId).some((value) => picked.includes(String(value)));
}
oneOf.autoRemove = (picked: Tuple<string> | undefined) => !picked || picked.length === 0;

export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  columnFilteringFeature,
  globalFilteringFeature,
  columnFacetingFeature,
  columnVisibilityFeature,
  sortedRowModel: createSortedRowModel(),
  filteredRowModel: createFilteredRowModel(),
  facetedRowModel: createFacetedRowModel(),
  facetedUniqueValues: createFacetedUniqueValues(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text, datetime: sortFn_datetime },
  filterFns: { oneOf },
  columnMeta: {} as DataColumnMeta,
});

type Features = typeof dataTableFeatures;

export function dataColumns<T extends RowData>() {
  return createColumnHelper<Features, T>();
}

/** Checkboxes in a first column; ids come from `getRowId`. */
export interface DataTableSelection<T> {
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  /** Names a row for its checkbox's label. */
  label: (row: T) => string;
}

/** A search box over the rows; every word typed has to appear in `text`. */
export interface DataTableSearch<T> {
  text: (row: T) => string;
  placeholder?: string;
}

/** A filter on a column's values (its `getUniqueValues`, else its value). */
export interface DataTableFilter {
  column: string;
  title: string;
  options: Tuple<{ value: string; label: string }>;
  /** Pick one value from a short list instead; this labels the "no filter" choice. */
  single?: { all: string };
}

/** Rows gathered under headers that open and close. */
export interface DataTableGroups<T> {
  by: (row: T) => string;
  label: (key: string, rows: Tuple<T>) => ReactNode;
  /** Orders the groups; by key otherwise. */
  compare?: (a: string, b: string) => number;
  collapsed?: boolean;
}

export function DataTable<T extends RowData>({
  columns,
  data,
  getRowId,
  empty,
  className,
  selection,
  pageSize,
  detail,
  search,
  filters,
  columnsMenu,
  groups,
  toolbar,
  hidden,
}: {
  columns: TableOptions<Features, T>["columns"];
  data: T[];
  getRowId?: TableOptions<Features, T>["getRowId"];
  empty?: ReactNode;
  className?: string;
  selection?: DataTableSelection<T>;
  /** Rows per page to start with; without it every row shows. */
  pageSize?: number;
  /** Rows open on an arrow to show this beneath them; keep the function stable, rows compare it. */
  detail?: (row: T) => ReactNode;
  search?: DataTableSearch<T>;
  filters?: Tuple<DataTableFilter>;
  /** A menu to show and hide columns. */
  columnsMenu?: boolean;
  groups?: DataTableGroups<T>;
  /** More controls at the end of the toolbar. */
  toolbar?: ReactNode;
  /** Columns hidden to start with. */
  hidden?: Tuple<string>;
}) {
  const t = useUiText();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>(() =>
    Object.fromEntries((hidden ?? []).map((id) => [id, false])),
  );
  const searchText = search?.text;
  const searchFn = useMemo(() => searchFilter(searchText ?? noText), [searchText]);
  const table = useTable({
    features: dataTableFeatures,
    columns,
    data,
    getRowId,
    defaultColumn: { filterFn: "oneOf" },
    state: { sorting, columnFilters, globalFilter, columnVisibility },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    globalFilterFn: searchFn,
    getColumnCanGlobalFilter: () => true,
  });
  const sorted = table.getRowModel().rows;
  const leafCount = table.getVisibleLeafColumns().length;
  const visibleKey = table
    .getVisibleLeafColumns()
    .map((column) => column.id)
    .join(" ");

  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());
  const grouped = useMemo(() => {
    if (!groups) return undefined;
    const byKey = new Map<string, Row<Features, T>[]>();
    for (const row of sorted) {
      const key = groups.by(row.original);
      const list = byKey.get(key);
      if (list) list.push(row);
      else byKey.set(key, [row]);
    }
    const compare = groups.compare ?? ((a: string, b: string) => a.localeCompare(b));
    return [...byKey].sort(([a], [b]) => compare(a, b));
  }, [groups, sorted]);
  const isOpen = (key: string) => (groups?.collapsed ? flipped.has(key) : !flipped.has(key));
  const toggleGroup = (key: string) =>
    setFlipped((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  // what pages are made of: rows, and with groups each group's header then its open rows
  type Item =
    | { kind: "row"; row: Row<Features, T>; group?: string }
    | { kind: "group"; key: string };
  const items: Item[] = grouped
    ? grouped.flatMap(([key, rows]): Item[] => [
        { kind: "group", key },
        ...(isOpen(key) ? rows.map((row): Item => ({ kind: "row", row, group: key })) : []),
      ])
    : sorted.map((row) => ({ kind: "row", row }));
  const paged = usePageOf(items, pageSize, [globalFilter, columnFilters, sorting]);
  let shown = paged.shown;
  // a group split across pages shows its header again at the top
  const first = shown[0];
  if (first?.kind === "row" && first.group !== undefined) {
    shown = [{ kind: "group", key: first.group }, ...shown];
  }
  const rows = shown.flatMap((item) => (item.kind === "row" ? [item.row] : []));

  // the header box picks this page's rows, as the rows it can see
  const ids = rows.map((row) => row.id);
  const picked = selection ? ids.filter((id) => selection.selected.has(id)).length : 0;
  const pickedEverywhere = selection
    ? sorted.filter((row) => selection.selected.has(row.id)).length
    : 0;
  // rows skip re-rendering when they haven't changed, so a row's checkbox reads the
  // selection from here rather than from the render it was last drawn in
  const latest = useRef(selection);
  useLayoutEffect(() => {
    latest.current = selection;
  });
  const toggle = useCallback((id: string) => {
    const current = latest.current;
    if (!current) return;
    const next = new Set(current.selected);
    if (!next.delete(id)) next.add(id);
    current.onChange(next);
  }, []);
  const pickMany = (some: Tuple<string>, checked: boolean) => {
    if (!selection) return;
    const next = new Set(selection.selected);
    for (const id of some) {
      if (checked) next.add(id);
      else next.delete(id);
    }
    selection.onChange(next);
  };

  const columnCount = leafCount + (selection ? 1 : 0) + (detail ? 1 : 0);
  const hasToolbar = !!search || (filters?.length ?? 0) > 0 || columnsMenu || !!toolbar;
  const filtered = columnFilters.length > 0 || globalFilter !== "";

  return (
    <div className="flex flex-col gap-3">
      {hasToolbar && (
        <div className="flex flex-wrap items-center gap-2">
          {search && (
            <DataTableSearchInput
              value={globalFilter}
              placeholder={search.placeholder}
              onChange={setGlobalFilter}
            />
          )}
          {filters?.map((filter) => {
            const column = table.getColumn(filter.column);
            if (!column) return null;
            return filter.single ? (
              <DataTableSingleFilter
                key={filter.column}
                column={column}
                filter={filter}
                all={filter.single.all}
              />
            ) : (
              <DataTableFacetedFilter key={filter.column} column={column} filter={filter} />
            );
          })}
          {filtered && (
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => {
                setColumnFilters([]);
                setGlobalFilter("");
              }}
              tooltip={t("ui.resetFilters")}
            >
              <IconFilterX />
            </Button>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {toolbar}
            {columnsMenu && <DataTableViewOptions table={table} />}
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <Table className={className}>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {selection && (
                  <TableHead className="w-8">
                    <Checkbox
                      aria-label={t("ui.selectAll")}
                      checked={picked > 0 && picked === ids.length}
                      indeterminate={picked > 0 && picked < ids.length}
                      disabled={ids.length === 0}
                      onCheckedChange={(checked) => pickMany(ids, checked)}
                    />
                  </TableHead>
                )}
                {detail && <TableHead className="w-8" aria-label={t("ui.details")} />}
                {group.headers.map((header) => {
                  const direction = header.column.getIsSorted();
                  const label = header.isPlaceholder ? null : <table.FlexRender header={header} />;
                  return (
                    <TableHead
                      key={header.id}
                      className={alignClass(header.column)}
                      aria-sort={
                        direction === "asc"
                          ? "ascending"
                          : direction === "desc"
                            ? "descending"
                            : undefined
                      }
                    >
                      {header.column.getCanSort() ? (
                        <DataTableColumnHeader column={header.column} title={label} />
                      ) : (
                        label
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {shown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="h-20 text-center text-muted-fg">
                  {filtered ? t("ui.noMatches") : (empty ?? t("ui.noRows"))}
                </TableCell>
              </TableRow>
            ) : (
              shown.map((item, index) => {
                if (item.kind === "group") {
                  const members = grouped?.find(([key]) => key === item.key)?.[1] ?? [];
                  return (
                    <GroupRow
                      key={`group:${item.key}:${index}`}
                      label={groups?.label(
                        item.key,
                        members.map((row) => row.original),
                      )}
                      count={members.length}
                      open={isOpen(item.key)}
                      onToggle={() => toggleGroup(item.key)}
                      columnCount={columnCount}
                      selection={
                        selection
                          ? {
                              ids: members.map((row) => row.id),
                              selected: selection.selected,
                              onPick: pickMany,
                            }
                          : undefined
                      }
                    />
                  );
                }
                const row = item.row;
                return (
                  <DataRow
                    key={row.id}
                    row={row}
                    original={row.original}
                    columns={columns}
                    visible={visibleKey}
                    selectable={!!selection}
                    detail={detail}
                    columnCount={columnCount}
                    selected={selection?.selected.has(row.id) ?? false}
                    label={
                      selection ? t("ui.selectRow", { name: selection.label(row.original) }) : ""
                    }
                    onToggle={toggle}
                    render={(cell) => <table.FlexRender cell={cell} />}
                  />
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
      {pageSize !== undefined && (
        <div className="flex flex-col gap-2">
          {selection && picked === ids.length && picked > 0 && pickedEverywhere < sorted.length && (
            <p className="text-sm text-muted-fg">
              {t("ui.pagePicked", { count: picked })}{" "}
              <button
                type="button"
                className="font-medium text-fg underline underline-offset-2"
                onClick={() => selection.onChange(new Set(sorted.map((row) => row.id)))}
              >
                {t("ui.pickAll", { count: sorted.length })}
              </button>
            </p>
          )}
          <PageControls paging={paged.paging} />
        </div>
      )}
    </div>
  );
}

const noText = () => "";

// the global filter runs once per column, so each row's answer is kept for the query
export function searchFilter<T extends RowData>(text: (row: T) => string): FilterFn<Features, T> {
  let asked = "";
  let answers = new Map<T, boolean>();
  return (row, _columnId, query: string) => {
    if (query !== asked) {
      asked = query;
      answers = new Map();
    }
    const known = answers.get(row.original);
    if (known !== undefined) return known;
    const haystack = text(row.original).toLowerCase();
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const answer = words.every((word) => haystack.includes(word));
    answers.set(row.original, answer);
    return answer;
  };
}

// pages a list, back to the first page whenever `reset` changes
function usePageOf<T>(
  items: Tuple<T>,
  initialSize: number | undefined,
  reset: Tuple<unknown>,
): { shown: Tuple<T>; paging: Paging } {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(initialSize ?? PAGE_SIZES[0] ?? 25);
  const [seen, setSeen] = useState(reset);
  if (seen.length !== reset.length || seen.some((value, index) => value !== reset[index])) {
    setSeen(reset);
    setPage(0);
  }
  if (initialSize === undefined) {
    return {
      shown: items,
      paging: {
        page: 0,
        pageSize: items.length,
        total: items.length,
        onPage() {},
        onPageSize() {},
      },
    };
  }
  const last = Math.max(0, Math.ceil(items.length / pageSize) - 1);
  const current = Math.min(page, last);
  return {
    shown: items.slice(current * pageSize, (current + 1) * pageSize),
    paging: {
      page: current,
      pageSize,
      total: items.length,
      onPage: setPage,
      onPageSize: (size) => {
        // keep the first row on screen in view
        setPage(Math.floor((current * pageSize) / size));
        setPageSize(size);
      },
    },
  };
}

/** A sortable column's header: click to sort up, down, then not at all. */
export function DataTableColumnHeader<T extends RowData>({
  column,
  title,
  className,
}: {
  column: Column<Features, T>;
  title: ReactNode;
  className?: string;
}) {
  const direction = column.getIsSorted();
  return (
    <button
      type="button"
      className={cn(
        "-mx-1 inline-flex items-center gap-1 rounded-md px-1 whitespace-nowrap hocus:text-fg",
        className,
      )}
      onClick={column.getToggleSortingHandler()}
    >
      {title}
      {direction === "asc" ? (
        <IconArrowUp className="size-3.5" />
      ) : direction === "desc" ? (
        <IconArrowDown className="size-3.5" />
      ) : (
        <IconArrowsSort className="size-3.5 opacity-40" />
      )}
    </button>
  );
}

// typing waits a moment before filtering, so a long table doesn't redraw on every key
function DataTableSearchInput({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder?: string;
  onChange: (next: string) => void;
}) {
  const t = useUiText();
  const [draft, setDraft] = useState(value);
  const [applied, setApplied] = useState(value);
  if (applied !== value) {
    // cleared from outside, like the reset button
    setApplied(value);
    setDraft(value);
  }
  const latest = useRef(onChange);
  useLayoutEffect(() => {
    latest.current = onChange;
  });
  useEffect(() => {
    if (draft === applied) return;
    const timer = setTimeout(() => {
      setApplied(draft.trim() ? draft : "");
      latest.current(draft.trim() ? draft : "");
    }, 200);
    return () => clearTimeout(timer);
  }, [draft, applied]);
  return (
    <InputGroup className="h-8 w-full sm:max-w-64">
      <InputGroupAddon>
        <IconSearch />
      </InputGroupAddon>
      <InputGroupInput
        type="search"
        aria-label={placeholder ?? `${t("ui.search")}...`}
        placeholder={placeholder ?? `${t("ui.search")}...`}
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
      />
    </InputGroup>
  );
}

/** A combobox of a column's values, with how many rows have each. */
export function DataTableFacetedFilter<T extends RowData>({
  column,
  filter,
}: {
  column: Column<Features, T>;
  filter: DataTableFilter;
}) {
  const t = useUiText();
  const counts = column.getFacetedUniqueValues();
  const picked = pickedValues(column.getFilterValue());
  const labels = new Map(filter.options.map((option) => [option.value, option.label]));
  const label = (value: string) => labels.get(value) ?? value;
  return (
    <Combobox
      items={filter.options.map((option) => option.value)}
      multiple
      value={[...picked]}
      onValueChange={(next: string[]) => column.setFilterValue(next.length ? next : undefined)}
      itemToStringLabel={label}
    >
      <ComboboxTrigger render={<Button size="sm" variant="outline" className="border-dashed" />}>
        <IconCirclePlus />
        {filter.title}
        {picked.length > 0 && (
          <span className="flex items-center gap-1 border-l pl-2">
            {picked.length > 2 ? (
              <Badge variant="secondary">{t("ui.nPicked", { count: picked.length })}</Badge>
            ) : (
              picked.map((value) => (
                <Badge key={value} variant="secondary">
                  {label(value)}
                </Badge>
              ))
            )}
          </span>
        )}
      </ComboboxTrigger>
      <ComboboxContent className="w-64">
        <ComboboxInput showTrigger={false} placeholder={filter.title} />
        <ComboboxEmpty>{t("cmd.empty")}</ComboboxEmpty>
        <ComboboxList>
          {(value: string) => (
            <ComboboxItem key={value} value={value}>
              <span className="truncate">{label(value)}</span>
              <span className="ml-auto text-xs text-muted-fg tabular-nums">
                {counts.get(value) ?? 0}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

const ALL = "__all__";

/** A select of a short list of values, one at a time. */
export function DataTableSingleFilter<T extends RowData>({
  column,
  filter,
  all,
}: {
  column: Column<Features, T>;
  filter: DataTableFilter;
  all: string;
}) {
  const picked = pickedValues(column.getFilterValue());
  return (
    <OptSelect
      size="sm"
      ariaLabel={filter.title}
      value={picked[0] ?? ALL}
      options={[{ value: ALL, label: all }, ...filter.options]}
      onChange={(next) => column.setFilterValue(next === ALL ? undefined : [next])}
    />
  );
}

function pickedValues(value: unknown): Tuple<string> {
  return Array.isArray(value) ? value.filter((each) => typeof each === "string") : [];
}

/** A menu to show and hide the columns that can be hidden. */
export function DataTableViewOptions<T extends RowData>({
  table,
}: {
  table: { getAllLeafColumns: () => Tuple<Column<Features, T>> };
}) {
  const t = useUiText();
  const hideable = table.getAllLeafColumns().filter((column) => column.getCanHide());
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
        <IconAdjustmentsHorizontal />
        {t("ui.columns")}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("ui.showColumns")}</DropdownMenuLabel>
          {hideable.map((column) => (
            <DropdownMenuCheckboxItem
              key={column.id}
              checked={column.getIsVisible()}
              onCheckedChange={(checked) => column.toggleVisibility(checked)}
            >
              {columnLabel(column)}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function columnLabel<T extends RowData>(column: Column<Features, T>): string {
  const header = column.columnDef.header;
  return column.columnDef.meta?.label ?? (typeof header === "string" ? header : column.id);
}

function GroupRow({
  label,
  count,
  open,
  onToggle,
  columnCount,
  selection,
}: {
  label: ReactNode;
  count: number;
  open: boolean;
  onToggle: () => void;
  columnCount: number;
  selection?: {
    ids: Tuple<string>;
    selected: ReadonlySet<string>;
    onPick: (ids: Tuple<string>, checked: boolean) => void;
  };
}) {
  const t = useUiText();
  const picked = selection ? selection.ids.filter((id) => selection.selected.has(id)).length : 0;
  return (
    <TableRow className="bg-muted/40 hover:bg-muted/60">
      {selection && (
        <TableCell className="w-8 align-middle">
          <Checkbox
            aria-label={t("ui.selectGroup")}
            checked={picked > 0 && picked === selection.ids.length}
            indeterminate={picked > 0 && picked < selection.ids.length}
            disabled={selection.ids.length === 0}
            onCheckedChange={(checked) => selection.onPick(selection.ids, checked)}
          />
        </TableCell>
      )}
      <TableCell colSpan={columnCount - (selection ? 1 : 0)} className="py-1.5">
        <button
          type="button"
          aria-expanded={open}
          className="flex w-full items-center gap-2 text-left font-medium"
          onClick={onToggle}
        >
          <IconChevronRight
            className={cn(
              "size-4 text-muted-fg transition-transform duration-(--motion-expand) ease-emphasized",
              open && "rotate-90",
            )}
          />
          {label}
          <span className="text-xs font-normal text-muted-fg tabular-nums">{count}</span>
        </button>
      </TableCell>
    </TableRow>
  );
}

type DataRowProps<T extends RowData> = {
  row: Row<Features, T>;
  /** Compared instead of `row`, which the table rebuilds every render. */
  original: T;
  /** Compared so a change to what the cells render redraws the rows. */
  columns: unknown;
  /** The shown columns' ids, compared so hiding one redraws the rows. */
  visible: string;
  selectable: boolean;
  detail: ((row: T) => ReactNode) | undefined;
  columnCount: number;
  selected: boolean;
  label: string;
  onToggle: (id: string) => void;
  render: (cell: ReturnType<Row<Features, T>["getVisibleCells"]>[number]) => ReactNode;
};

// A big table re-rendered whole on every checkbox click is what made it lag, so a row
// redraws only when its data, the columns or its own checkbox change.
const DataRow = memo(
  function DataRow<T extends RowData>({
    row,
    selectable,
    detail,
    columnCount,
    selected,
    label,
    onToggle,
    render,
  }: DataRowProps<T>) {
    const t = useUiText();
    const [open, setOpen] = useState(false);
    return (
      <>
        <TableRow
          data-state={selected ? "selected" : undefined}
          className={cn(open && "border-b-0 has-aria-expanded:bg-transparent")}
        >
          {selectable && (
            <TableCell className="w-8 align-middle">
              <Checkbox
                aria-label={label}
                checked={selected}
                onCheckedChange={() => onToggle(row.id)}
              />
            </TableCell>
          )}
          {detail && (
            <TableCell className="w-8 align-middle">
              <button
                type="button"
                aria-expanded={open}
                aria-label={open ? t("ui.hideDetails") : t("ui.showDetails")}
                className="-my-0.5 grid size-6 place-items-center rounded-md text-muted-fg motion-hover hocus:text-fg"
                onClick={() => setOpen((current) => !current)}
              >
                <IconChevronRight
                  className={cn(
                    "size-4 transition-transform duration-(--motion-expand) ease-emphasized",
                    open && "rotate-90",
                  )}
                />
              </button>
            </TableCell>
          )}
          {row.getVisibleCells().map((cell) => (
            <TableCell key={cell.id} className={cn("align-middle", alignClass(cell.column))}>
              {render(cell)}
            </TableCell>
          ))}
        </TableRow>
        {detail && open && (
          // the leading checkbox and arrow cells stay empty so the detail lines up with the first column
          <TableRow className="hover:bg-transparent">
            {selectable && <TableCell aria-hidden />}
            <TableCell aria-hidden />
            <TableCell colSpan={columnCount - (selectable ? 2 : 1)} className="pt-0 pb-4">
              {detail(row.original)}
            </TableCell>
          </TableRow>
        )}
      </>
    );
  },
  (before, after) =>
    before.original === after.original &&
    before.columns === after.columns &&
    before.visible === after.visible &&
    before.selectable === after.selectable &&
    before.detail === after.detail &&
    before.columnCount === after.columnCount &&
    before.selected === after.selected &&
    before.label === after.label &&
    before.onToggle === after.onToggle,
) as <T extends RowData>(props: DataRowProps<T>) => ReactNode;
