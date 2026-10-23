import { Toolbar as ToolbarPrimitive } from "@base-ui/react/toolbar";
import { cn } from "@bogey/ui/lib/utils";
import { buttonVariants } from "./button.tsx";
import type { VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.tsx";

function Toolbar({ className, ...props }: ToolbarPrimitive.Root.Props) {
  return (
    <ToolbarPrimitive.Root
      data-slot="toolbar"
      className={cn(
        "flex items-center gap-1 data-[orientation=vertical]:flex-col data-[orientation=vertical]:items-stretch",
        className,
      )}
      {...props}
    />
  );
}

function ToolbarGroup({ className, ...props }: ToolbarPrimitive.Group.Props) {
  return (
    <ToolbarPrimitive.Group
      data-slot="toolbar-group"
      className={cn("flex items-center gap-0.5", className)}
      {...props}
    />
  );
}

function ToolbarButton({
  className,
  variant = "ghost",
  size = "icon-sm",
  tooltip,
  ...props
}: ToolbarPrimitive.Button.Props &
  VariantProps<typeof buttonVariants> & {
    /** Shown on hover and focus, and on hover while the button is disabled. */
    tooltip?: ReactNode;
  }) {
  const button = (
    <ToolbarPrimitive.Button
      data-slot="toolbar-button"
      className={cn(
        buttonVariants({ variant, size }),
        "data-pressed:bg-muted data-pressed:text-fg",
        "data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
  if (!tooltip) return button;
  // a disabled button gets no pointer events, so the tooltip hangs off a span around it
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>{button}</TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function ToolbarLink({ className, ...props }: ToolbarPrimitive.Link.Props) {
  return (
    <ToolbarPrimitive.Link
      data-slot="toolbar-link"
      className={cn("px-2 text-sm text-muted-fg hover:text-fg", className)}
      {...props}
    />
  );
}

function ToolbarInput({ className, ...props }: ToolbarPrimitive.Input.Props) {
  return (
    <ToolbarPrimitive.Input
      data-slot="toolbar-input"
      className={cn(
        "h-8 min-w-0 rounded-3xl border border-transparent bg-input/50 px-3 text-sm focus-visible:border-ring",
        className,
      )}
      {...props}
    />
  );
}

function ToolbarSeparator({ className, ...props }: ToolbarPrimitive.Separator.Props) {
  return (
    <ToolbarPrimitive.Separator
      data-slot="toolbar-separator"
      className={cn(
        "mx-1 h-5 w-px shrink-0 bg-border data-[orientation=horizontal]:mx-0 data-[orientation=horizontal]:my-1 data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-auto",
        className,
      )}
      {...props}
    />
  );
}

export { Toolbar, ToolbarGroup, ToolbarButton, ToolbarLink, ToolbarInput, ToolbarSeparator };
