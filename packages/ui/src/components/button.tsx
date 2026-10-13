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

//   "before:transition-colors before:absolute before:inset-x-3 before:top-0 before:h-px before:bg-linear-to-r before:from-transparent before:via-white/20 hover:before:via-white/40 before:to-transparent";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-4xl border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all select-none focus-visible:border-ring active:not-aria-[haspopup]:scale-97 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
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
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30",
        link: "link px-0",
        underline: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
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
  onClick,
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    confirm?: ButtonConfirm;
  }) {
  const t = useUiText();
  const [open, setOpen] = useState(false);
  const classes = cn("relative", buttonVariants({ variant, size, className }));
  if (!confirm) {
    return (
      <ButtonPrimitive data-slot="button" className={classes} onClick={onClick} {...props}>
        {children}
      </ButtonPrimitive>
    );
  }
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={<ButtonPrimitive data-slot="button" type="button" className={classes} {...props} />}
      >
        {children}
      </AlertDialogTrigger>
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

export { Button, buttonVariants };
