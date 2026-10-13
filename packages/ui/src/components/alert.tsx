import * as React from "react";
import { useUiText } from "../lib/ui-text.ts";
import { IconX } from "@tabler/icons-react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@bogey/ui/lib/utils";

const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-2xl border px-4 py-3 text-left text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2.5 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-card text-card-fg",
        destructive:
          "bg-card text-destructive *:data-[slot=alert-description]:text-destructive/90 *:[svg]:text-current",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Alert({
  className,
  variant,
  dismissable = false,
  onDismiss,
  children,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof alertVariants> & {
    dismissable?: boolean;
    onDismiss?: () => void;
  }) {
  const t = useUiText();
  const [dismissed, setDismissed] = React.useState(false);
  if (dismissed) return null;
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), dismissable && "pr-11", className)}
      {...props}
    >
      {children}
      {dismissable && (
        <button
          type="button"
          aria-label={t("ui.dismiss")}
          title={t("ui.dismiss")}
          className="absolute top-2.5 right-2.5 flex size-6 items-center justify-center rounded-md text-current opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:focus-ring [&_svg]:size-4"
          onClick={() => {
            setDismissed(true);
            onDismiss?.();
          }}
        >
          <IconX />
        </button>
      )}
    </div>
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-fg",
        className,
      )}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-sm text-balance text-muted-fg md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-fg [&_p:not(:last-child)]:mb-4",
        className,
      )}
      {...props}
    />
  );
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("absolute top-2.5 right-3", className)}
      {...props}
    />
  );
}

export { Alert, AlertTitle, AlertDescription, AlertAction };
