import type { ReactNode } from "react";
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  useTable,
  type RowData,
  type TableOptions,
} from "@tanstack/react-table";
import { IconArrowDown, IconArrowUp, IconArrowsSort } from "@tabler/icons-react";
import { cn } from "@bogey/ui/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table.tsx";
import { Checkbox } from "./checkbox.tsx";
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
}: {
  columns: TableOptions<Features, T>["columns"];
  data: T[];
  getRowId?: TableOptions<Features, T>["getRowId"];
  empty?: ReactNode;
  className?: string;
  selection?: DataTableSelection<T>;
}) {
  const t = useUiText();
  const table = useTable({ features: dataTableFeatures, columns, data, getRowId });
  const rows = table.getRowModel().rows;
  const ids = rows.map((row) => row.id);
  const picked = selection ? ids.filter((id) => selection.selected.has(id)).length : 0;
  const toggle = (id: string) => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (!next.delete(id)) next.add(id);
    selection.onChange(next);
  };

  return (
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
            <TableRow
              key={row.id}
              data-state={selection?.selected.has(row.id) ? "selected" : undefined}
            >
              {selection && (
                <TableCell className="w-8 align-top">
                  <Checkbox
                    aria-label={t("ui.selectRow", { name: selection.label(row.original) })}
                    checked={selection.selected.has(row.id)}
                    onCheckedChange={() => toggle(row.id)}
                  />
                </TableCell>
              )}
              {row.getAllCells().map((cell) => (
                <TableCell key={cell.id} className="align-top">
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
