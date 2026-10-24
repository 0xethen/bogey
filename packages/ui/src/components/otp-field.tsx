import { OTPField as OTPFieldPrimitive } from "@base-ui/react/otp-field";
import { IconMinus } from "@tabler/icons-react";
import { cn } from "@bogey/ui/lib/utils";

function OTPField({ className, ...props }: OTPFieldPrimitive.Root.Props) {
  return (
    <OTPFieldPrimitive.Root
      data-slot="otp-field"
      className={cn("flex items-center gap-2 data-disabled:opacity-50", className)}
      {...props}
    />
  );
}

function OTPFieldGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="otp-field-group"
      className={cn("flex items-center rounded-3xl", className)}
      {...props}
    />
  );
}

function OTPFieldInput({ className, ...props }: OTPFieldPrimitive.Input.Props) {
  return (
    <OTPFieldPrimitive.Input
      data-slot="otp-field-input"
      className={cn(
        "relative m-0 size-9 min-w-0 border-y border-r border-input bg-input/50 p-0 text-center text-sm caret-primary motion-hover outline-none",
        "first:rounded-l-3xl first:border-l last:rounded-r-3xl",
        "focus:z-10 focus:border-ring focus:ring-3 focus:ring-ring/30",
        "aria-invalid:border-destructive focus:aria-invalid:ring-destructive/20 dark:focus:aria-invalid:ring-destructive/40",
        "disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    />
  );
}

function OTPFieldSeparator({ className, ...props }: OTPFieldPrimitive.Separator.Props) {
  return (
    <OTPFieldPrimitive.Separator
      data-slot="otp-field-separator"
      className={cn(
        "flex items-center text-muted-fg [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <IconMinus aria-hidden />
    </OTPFieldPrimitive.Separator>
  );
}

export { OTPField, OTPFieldGroup, OTPFieldInput, OTPFieldSeparator };
