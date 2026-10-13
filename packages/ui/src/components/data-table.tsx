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

export function DataTable<T extends RowData>({
  columns,
  data,
  getRowId,
  empty,
  className,
}: {
  columns: TableOptions<Features, T>["columns"];
  data: T[];
  getRowId?: TableOptions<Features, T>["getRowId"];
  empty?: ReactNode;
  className?: string;
}) {
  const t = useUiText();
  const table = useTable({ features: dataTableFeatures, columns, data, getRowId });
  const rows = table.getRowModel().rows;

  return (
    <Table className={className}>
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id}>
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
              colSpan={table.getAllLeafColumns().length}
              className={cn("h-20 text-center text-muted-fg")}
            >
              {empty ?? t("ui.noRows")}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <TableRow key={row.id}>
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
