import type { ReactElement, ReactNode } from "react";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@bogey/ui/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible.tsx";

// rows in a divided list; see docs/architecture/ui-conventions.md#rows

const rowListVariants = cva("flex flex-col divide-y divide-border", {
  variants: {
    variant: {
      // ruled above and below, for a list that is the section's content
      divided: "border-y border-border",
      // no outer rules, for a list inside a panel or under a heading
      flush: "",
      // a bordered box, for a list among other controls
      boxed: "rounded-2xl border border-border px-4",
    },
  },
  defaultVariants: { variant: "divided" },
});

/** The list rows sit in. Pass `render={<ul />}` (and `<li />` rows) for list semantics. */
export function RowList({
  variant = "divided",
  className,
  render,
  ...props
}: useRender.ComponentProps<"div"> & VariantProps<typeof rowListVariants>) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">({ className: cn(rowListVariants({ variant }), className) }, props),
    render,
    state: { slot: "row-list" },
  });
}

const rowVariants = cva("flex items-center gap-3", {
  variants: {
    size: { default: "py-3", sm: "py-2" },
  },
  defaultVariants: { size: "default" },
});

function RowText({
  title,
  meta,
  truncate,
}: {
  title: ReactNode;
  meta?: ReactNode;
  truncate?: boolean;
}) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className={cn("flex items-center gap-2 text-sm font-medium", truncate && "truncate")}>
        {title}
      </span>
      {meta && <span className={cn("text-sm text-muted-fg", truncate && "truncate")}>{meta}</span>}
    </span>
  );
}

/** A row with a title, a line of detail and controls at the end. `children` go under it. */
export function Row({
  id,
  leading,
  title,
  meta,
  actions,
  children,
  size = "default",
  className,
  render,
}: {
  /** An address a link can land on; the row is highlighted when it does. */
  id?: string;
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  render?: ReactElement;
} & VariantProps<typeof rowVariants>) {
  return useRender({
    defaultTagName: "div",
    render,
    state: { slot: "row" },
    props: {
      id,
      className: cn(rowVariants({ size }), "flex-wrap", id && "jump-target", className),
      children: (
        <>
          {leading && <span className="flex shrink-0 text-muted-fg [&_svg]:size-5">{leading}</span>}
          <RowText title={title} meta={meta} />
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
          {children && <div className="basis-full">{children}</div>}
        </>
      ),
    },
  });
}

/** A row that goes somewhere: the whole row is the link, with a chevron at the end. */
export function LinkRow({
  render,
  leading,
  title,
  meta,
  trailing,
}: {
  render: ReactElement;
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
}) {
  return useRender({
    render,
    state: { slot: "row" },
    props: {
      className: cn(
        rowVariants(),
        "-mx-2 gap-4 rounded-2xl px-2 text-fg no-underline transition-colors duration-200 hover:bg-fg/5 focus-visible:bg-fg/5",
      ),
      children: (
        <>
          {leading}
          <RowText title={title} meta={meta} truncate />
          {trailing && <span className="flex shrink-0 items-center gap-2">{trailing}</span>}
          <IconChevronRight className="size-4 shrink-0 text-muted-fg" />
        </>
      ),
    },
  });
}

/** A row that opens in place to show `children`; without children it's a plain row. */
export function DisclosureRow({
  id,
  title,
  meta,
  leading,
  actions,
  children,
  open,
  onOpenChange,
  defaultOpen,
}: {
  /** An address a link can land on (`#plugins.challenges`); the row is highlighted when it does. */
  id?: string;
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
    <Collapsible
      id={id}
      className={id ? "jump-target" : undefined}
      open={open}
      onOpenChange={onOpenChange}
      defaultOpen={defaultOpen}
    >
      <div className={rowVariants()}>
        <CollapsibleTrigger
          disabled={!expandable}
          className="group flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          {leading}
          <RowText title={title} meta={meta} truncate />
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
