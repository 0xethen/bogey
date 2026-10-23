import type { ComponentType, ReactElement, SVGProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Item, ItemContent, ItemMedia, ItemTitle } from "@bogey/ui/components/item";
import { cn } from "@bogey/ui/lib/utils";

const statVariants = cva("", {
  variants: {
    variant: {
      default: "",
      urgent: "border-warning/50",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export function Stat({
  icon: Icon,
  label,
  value,
  of,
  variant = "default",
  render,
  className,
}: {
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  value: number;
  of?: number;
  variant?: VariantProps<typeof statVariants>["variant"];
  render?: ReactElement;
  className?: string;
}) {
  const urgent = variant === "urgent";

  return (
    <Item
      variant={urgent ? "outline" : "muted"}
      className={cn(statVariants({ variant }), className)}
      render={render}
    >
      {Icon && (
        <ItemMedia variant="icon" className={urgent ? "text-warning" : "text-muted-fg"}>
          <Icon />
        </ItemMedia>
      )}
      <ItemContent>
        <ItemTitle className="font-heading text-2xl tabular-nums">
          {value}
          {of !== undefined && <span className="text-base font-normal text-muted-fg"> / {of}</span>}
        </ItemTitle>
        <span className="text-sm text-muted-fg">{label}</span>
      </ItemContent>
    </Item>
  );
}

export function StatGroup({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-4", className)}>{children}</div>
  );
}
