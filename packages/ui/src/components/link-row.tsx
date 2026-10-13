import type { ReactElement, ReactNode } from "react";
import { IconChevronRight } from "@tabler/icons-react";
import { cn } from "@bogey/ui/lib/utils";
import { Item } from "@bogey/ui/components/item";

export function LinkRow({
  render,
  leading,
  title,
  meta,
  trailing,
  variant = "row",
}: {
  render: ReactElement;
  variant?: "row" | "block";
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <Item
      variant={variant === "block" ? "outline" : "default"}
      render={render}
      className={cn("gap-4", variant === "row" && "-mx-2 px-2 py-3")}
    >
      {leading}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2 truncate font-medium">{title}</span>
        {meta && <span className="truncate text-sm text-muted-fg">{meta}</span>}
      </span>
      {trailing && <span className="flex shrink-0 items-center gap-2">{trailing}</span>}
      <IconChevronRight className="size-4 shrink-0 text-muted-fg" />
    </Item>
  );
}
