import type { ComponentProps } from "react";
import { cn } from "@bogey/ui/lib/utils";

// blurs text like an IP address until it's hovered or focused
export function Blurred({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      tabIndex={0}
      className={cn(
        "rounded-sm blur-sm transition-[filter] outline-none hover:blur-none focus-visible:blur-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    />
  );
}
