import { useState } from "react";
import {
  IconChevronLeft,
  IconChevronRight,
  IconChevronsLeft,
  IconChevronsRight,
} from "@tabler/icons-react";
import { cn } from "@bogey/ui/lib/utils";
import { Button } from "./button.tsx";
import { OptSelect } from "./opt-select.tsx";
import { useUiText } from "../lib/ui-text.ts";

export const PAGE_SIZES: Tuple<number> = [25, 50, 100, 200];

export interface Paging {
  /** Zero-based. */
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}

/** Pages a list held in memory; the page stays in range when the list shrinks. */
export function usePaged<T>(
  items: Tuple<T>,
  initialSize = PAGE_SIZES[0] ?? 25,
): { shown: Tuple<T>; paging: Paging } {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(initialSize);
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

/** Rows per page and page buttons under a list; nothing when everything fits on the smallest page. */
export function PageControls({ paging, className }: { paging: Paging; className?: string }) {
  const t = useUiText();
  const { page, pageSize, total } = paging;
  if (total <= (PAGE_SIZES[0] ?? 0)) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  const sizes = PAGE_SIZES.includes(pageSize) ? PAGE_SIZES : [...PAGE_SIZES, pageSize];
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm text-muted-fg",
        className,
      )}
    >
      <span className="tabular-nums">{t("ui.rowsShown", { from, to, total })}</span>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="flex items-center gap-2">
          <span aria-hidden>{t("ui.perPage")}</span>
          <OptSelect
            size="sm"
            ariaLabel={t("ui.perPage")}
            value={String(pageSize)}
            options={sizes.map((size) => ({ value: String(size), label: String(size) }))}
            onChange={(next) => paging.onPageSize(Number(next))}
          />
        </span>
        <span className="tabular-nums">{t("ui.pageOf", { page: page + 1, pages })}</span>
        <span className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            className="hidden sm:inline-flex"
            aria-label={t("ui.firstPage")}
            disabled={page === 0}
            onClick={() => paging.onPage(0)}
          >
            <IconChevronsLeft />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t("ui.previousPage")}
            disabled={page === 0}
            onClick={() => paging.onPage(page - 1)}
          >
            <IconChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t("ui.nextPage")}
            disabled={page >= pages - 1}
            onClick={() => paging.onPage(page + 1)}
          >
            <IconChevronRight />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            className="hidden sm:inline-flex"
            aria-label={t("ui.lastPage")}
            disabled={page >= pages - 1}
            onClick={() => paging.onPage(pages - 1)}
          >
            <IconChevronsRight />
          </Button>
        </span>
      </div>
    </div>
  );
}
