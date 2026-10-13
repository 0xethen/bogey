import type { ReactNode } from "react";
import { IconChevronDown } from "@tabler/icons-react";
import { cn } from "@bogey/ui/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible.tsx";

export function DisclosureRow({
  title,
  meta,
  leading,
  actions,
  children,
  open,
  onOpenChange,
  defaultOpen,
}: {
  title: ReactNode;
  meta?: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
}) {
  const expandable = children !== undefined && children !== null && children !== false;

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} defaultOpen={defaultOpen}>
      <div className="flex items-center gap-3 py-3">
        <CollapsibleTrigger
          disabled={!expandable}
          className="group flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          {leading}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium">{title}</span>
            {meta && <span className="truncate text-sm text-muted-fg">{meta}</span>}
          </span>
          {expandable && (
            <IconChevronDown className="size-4 shrink-0 text-muted-fg transition-transform group-data-[panel-open]:rotate-180" />
          )}
        </CollapsibleTrigger>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {expandable && (
        <CollapsibleContent keepMounted>
          <div className="pb-4">{children}</div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

export function DisclosureList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col divide-y divide-border border-y border-border", className)}>
      {children}
    </div>
  );
}
