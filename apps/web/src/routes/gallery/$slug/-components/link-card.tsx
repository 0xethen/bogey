import type { ReactElement, ReactNode } from "react";
import { cn } from "@bogey/ui/lib/utils";
import { Item } from "@bogey/ui/components/item";

export function LinkCard({
  render,
  eyebrow,
  title,
  description,
  footer,
}: {
  render: ReactElement;
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Item
      variant="outline"
      size="default"
      render={render}
      className="h-full flex-col items-stretch gap-2 p-5"
    >
      {eyebrow && <span className="text-xs font-medium text-muted-fg">{eyebrow}</span>}
      <span className="font-heading text-base font-medium tracking-tight">{title}</span>
      {description && <span className="line-clamp-3 text-sm text-muted-fg">{description}</span>}
      {footer && (
        <span className="mt-auto flex flex-wrap items-center gap-1.5 pt-2 text-xs text-muted-fg">
          {footer}
        </span>
      )}
    </Item>
  );
}

export function CardGrid({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-3", className)}>{children}</div>
  );
}
