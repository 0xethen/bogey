import { memo, useCallback, useLayoutEffect, useRef, type ReactNode } from "react";
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  useTable,
  type Row,
  type RowData,
  type TableOptions,
} from "@tanstack/react-table";
import { IconArrowDown, IconArrowUp, IconArrowsSort } from "@tabler/icons-react";
import { cn } from "@bogey/ui/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table.tsx";
import { Checkbox } from "./checkbox.tsx";
import { PageControls, usePaged } from "./page-controls.tsx";
import { useUiText } from "../lib/ui-text.ts";

export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text, datetime: sortFn_datetime },
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

export function DataTable<T extends RowData>({
  columns,
  data,
  getRowId,
  empty,
  className,
  selection,
  pageSize,
}: {
  columns: TableOptions<Features, T>["columns"];
  data: T[];
  getRowId?: TableOptions<Features, T>["getRowId"];
  empty?: ReactNode;
  className?: string;
  selection?: DataTableSelection<T>;
  /** Rows per page to start with; without it every row shows. */
  pageSize?: number;
}) {
  const t = useUiText();
  const table = useTable({ features: dataTableFeatures, columns, data, getRowId });
  const sorted = table.getRowModel().rows;
  const { shown: rows, paging } = usePaged(sorted, pageSize ?? Number.MAX_SAFE_INTEGER);
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

  return (
    <div className="flex flex-col gap-2">
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
                    onCheckedChange={(checked) => {
                      const next = new Set(selection.selected);
                      for (const id of ids) {
                        if (checked) next.add(id);
                        else next.delete(id);
                      }
                      selection.onChange(next);
                    }}
                  />
                </TableHead>
              )}
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                const label = header.isPlaceholder ? null : <table.FlexRender header={header} />;
                return (
                  <TableHead
                    key={header.id}
                    aria-sort={
                      sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined
                    }
                  >
                    {header.column.getCanSort() ? (
                      <button
                        type="button"
                        className="-mx-1 inline-flex items-center gap-1 rounded-md px-1 hocus:text-fg"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {label}
                        {sorted === "asc" ? (
                          <IconArrowUp className="size-3.5" />
                        ) : sorted === "desc" ? (
                          <IconArrowDown className="size-3.5" />
                        ) : (
                          <IconArrowsSort className="size-3.5 opacity-40" />
                        )}
                      </button>
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
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={table.getAllLeafColumns().length + (selection ? 1 : 0)}
                className={cn("h-20 text-center text-muted-fg")}
              >
                {empty ?? t("ui.noRows")}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <DataRow
                key={row.id}
                row={row}
                original={row.original}
                columns={columns}
                selectable={!!selection}
                selected={selection?.selected.has(row.id) ?? false}
                label={selection ? t("ui.selectRow", { name: selection.label(row.original) }) : ""}
                onToggle={toggle}
                render={(cell) => <table.FlexRender cell={cell} />}
              />
            ))
          )}
        </TableBody>
      </Table>
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
          <PageControls paging={paging} />
        </div>
      )}
    </div>
  );
}

type DataRowProps<T extends RowData> = {
  row: Row<Features, T>;
  /** Compared instead of `row`, which the table rebuilds every render. */
  original: T;
  /** Compared so a change to what the cells render redraws the rows. */
  columns: unknown;
  selectable: boolean;
  selected: boolean;
  label: string;
  onToggle: (id: string) => void;
  render: (cell: ReturnType<Row<Features, T>["getAllCells"]>[number]) => ReactNode;
};

// A big table re-rendered whole on every checkbox click is what made it lag, so a row
// redraws only when its data, the columns or its own checkbox change.
const DataRow = memo(
  function DataRow<T extends RowData>({
    row,
    selectable,
    selected,
    label,
    onToggle,
    render,
  }: DataRowProps<T>) {
    return (
      <TableRow data-state={selected ? "selected" : undefined}>
        {selectable && (
          <TableCell className="w-8 align-top">
            <Checkbox
              aria-label={label}
              checked={selected}
              onCheckedChange={() => onToggle(row.id)}
            />
          </TableCell>
        )}
        {row.getAllCells().map((cell) => (
          <TableCell key={cell.id} className="align-top">
            {render(cell)}
          </TableCell>
        ))}
      </TableRow>
    );
  },
  (before, after) =>
    before.original === after.original &&
    before.columns === after.columns &&
    before.selectable === after.selectable &&
    before.selected === after.selected &&
    before.label === after.label &&
    before.onToggle === after.onToggle,
) as <T extends RowData>(props: DataRowProps<T>) => ReactNode;
