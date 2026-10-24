import { useState, type ReactNode } from "react";
import { useUiText } from "../lib/ui-text.ts";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@bogey/ui/lib/utils";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@bogey/ui/components/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bogey/ui/components/tooltip";

//   "before:transition-colors before:absolute before:inset-x-3 before:top-0 before:h-px before:bg-linear-to-r before:from-transparent before:via-white/20 hover:before:via-white/40 before:to-transparent";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-4xl border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap motion-hover select-none focus-visible:border-ring active:not-aria-[haspopup]:scale-97 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: [
          "bg-linear-to-t from-primary to-primary-lite text-primary-fg hover:opacity-80",
          "before:transition-colors before:absolute before:inset-x-3 before:top-0 before:h-px before:bg-linear-to-r before:from-transparent before:via-white/20 hover:before:via-white/40 before:to-transparent",
        ].join(" "),
        secondary: [
          "bg-secondary text-secondary-fg hover:bg-[color-mix(in_oklch,var(--secondary),var(--fg)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-fg",
          "before:transition-colors before:absolute before:inset-x-3 before:top-0 before:h-px before:bg-linear-to-r before:from-transparent before:via-white/10 hover:before:via-white/30 before:to-transparent",
        ].join(" "),
        outline:
          "border-border bg-background hover:bg-muted hover:text-fg aria-expanded:bg-muted aria-expanded:text-fg dark:bg-transparent dark:hover:bg-input/30",
        ghost:
          "hover:bg-muted hover:text-fg aria-expanded:bg-muted aria-expanded:text-fg dark:hover:bg-muted/50",
        "ghost-destructive":
          "text-destructive hover:bg-destructive/10 aria-expanded:bg-destructive/10 dark:hover:bg-destructive/20",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30",
        link: "link px-0",
      },
      size: {
        default:
          "h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        // `sm` with its `ButtonLabel` hidden on phones (below the `sm` breakpoint), leaving the icon
        "sm-icon-on-phones":
          "h-8 gap-1 px-3 max-sm:w-8 max-sm:px-0 max-sm:[&_[data-slot=button-label]]:sr-only",
        lg: "h-10 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        "icon-3xs": "size-4.5 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-2xs": "size-5 [&_svg:not([class*='size-'])]:size-3",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-4",
        "icon-sm": "size-8",
        icon: "size-9",
        "icon-lg": "size-10",
        "icon-xl": "size-12 [&_svg:not([class*='size-'])]:size-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonConfirm = {
  title: string;
  description: ReactNode;
  label: string;
  variant?: "destructive" | "default";
};

function Button({
  children,
  className,
  variant = "default",
  size = "default",
  confirm,
  tooltip,
  onClick,
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    confirm?: ButtonConfirm;
    /** Shown on hover and focus, and on hover while the button is disabled. */
    tooltip?: ReactNode;
  }) {
  const t = useUiText();
  const [open, setOpen] = useState(false);
  const classes = cn("relative", buttonVariants({ variant, size, className }));
  const button = confirm ? (
    <AlertDialogTrigger
      render={<ButtonPrimitive data-slot="button" type="button" className={classes} {...props} />}
    >
      {children}
    </AlertDialogTrigger>
  ) : (
    <ButtonPrimitive data-slot="button" className={classes} onClick={onClick} {...props}>
      {children}
    </ButtonPrimitive>
  );
  const shown = tooltip ? <WithTooltip tooltip={tooltip}>{button}</WithTooltip> : button;
  if (!confirm) return shown;
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {shown}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirm.title}</AlertDialogTitle>
          <AlertDialogDescription>{confirm.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel autoFocus>{t("common.cancel")}</AlertDialogCancel>
          <Button
            type="button"
            variant={confirm.variant ?? "destructive"}
            onClick={(event) => {
              setOpen(false);
              onClick?.(event);
            }}
          >
            {confirm.label}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// a disabled button gets no pointer events, so the tooltip hangs off a span around it
function WithTooltip({ tooltip, children }: { tooltip: ReactNode; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>{children}</TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

/** A button's words, which `size="sm-icon-on-phones"` hides on phones; give the button an `aria-label`. */
function ButtonLabel({ children }: { children: ReactNode }) {
  return <span data-slot="button-label">{children}</span>;
}

export { Button, ButtonLabel, buttonVariants };
