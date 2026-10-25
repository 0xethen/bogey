import { useMemo } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Fieldset as FieldsetPrimitive } from "@base-ui/react/fieldset";

import { cn } from "@bogey/ui/lib/utils";
import { Label } from "@bogey/ui/components/label";
import { Separator } from "@bogey/ui/components/separator";

function FieldSet({ className, ...props }: FieldsetPrimitive.Root.Props) {
  return (
    <FieldsetPrimitive.Root
      data-slot="field-set"
      className={cn(
        "flex flex-col gap-(--field-set-gap) [--field-set-gap:--spacing(6)] has-[>[data-slot=checkbox-group]]:[--field-set-gap:--spacing(3)] has-[>[data-slot=radio-group]]:[--field-set-gap:--spacing(3)]",
        className,
      )}
      {...props}
    />
  );
}

function FieldLegend({
  className,
  variant = "legend",
  ...props
}: FieldsetPrimitive.Legend.Props & { variant?: "legend" | "label" }) {
  return (
    <FieldsetPrimitive.Legend
      data-slot="field-legend"
      data-variant={variant}
      className={cn(
        "mb-3 font-medium data-[variant=label]:text-sm data-[variant=legend]:text-base",
        className,
      )}
      {...props}
    />
  );
}

function FieldGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-group"
      className={cn(
        "group/field-group @container/field-group flex w-full flex-col gap-7 data-[slot=checkbox-group]:gap-3 *:data-[slot=field-group]:gap-4",
        className,
      )}
      {...props}
    />
  );
}

const fieldVariants = cva("group/field flex w-full gap-3 data-[invalid=true]:text-destructive", {
  variants: {
    orientation: {
      vertical: "flex-col *:w-full [&>.sr-only]:w-auto",
      horizontal:
        "flex-row items-center has-[>[data-slot=field-content]]:items-start *:data-[slot=field-label]:flex-auto has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
      inline:
        "w-auto flex-row items-center gap-2 *:data-[slot=field-label]:shrink-0 *:data-[slot=field-label]:whitespace-nowrap",
      responsive:
        "flex-col *:w-full @md/field-group:flex-row @md/field-group:items-center @md/field-group:*:w-auto @md/field-group:has-[>[data-slot=field-content]]:items-start @md/field-group:*:data-[slot=field-label]:flex-auto [&>.sr-only]:w-auto @md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
    },
  },
  defaultVariants: {
    orientation: "vertical",
  },
});

function Field({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof fieldVariants>) {
  return (
    <div
      role="group"
      data-slot="field"
      data-orientation={orientation}
      className={cn(fieldVariants({ orientation }), className)}
      {...props}
    />
  );
}

function FieldContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-content"
      className={cn("group/field-content flex flex-1 flex-col gap-1 leading-snug", className)}
      {...props}
    />
  );
}

function FieldLabel({
  className,
  required,
  children,
  ...props
}: React.ComponentProps<typeof Label> & { required?: boolean }) {
  return (
    <Label
      data-slot="field-label"
      className={cn(
        "group/field-label peer/field-label flex w-fit gap-2 leading-snug group-data-[disabled=true]/field:opacity-50 has-data-checked:bg-input/30 has-[>[data-slot=field]]:rounded-2xl has-[>[data-slot=field]]:border *:data-[slot=field]:p-4",
        "has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col",
        className,
      )}
      {...props}
    >
      {required ? (
        <span>
          {children}
          <span aria-hidden className="ml-0.5 text-destructive">
            *
          </span>
        </span>
      ) : (
        children
      )}
    </Label>
  );
}

function FieldTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-label"
      className={cn(
        "flex w-fit items-center gap-2 text-sm font-medium group-data-[disabled=true]/field:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-description"
      className={cn(
        "text-left text-sm leading-normal font-normal whitespace-pre-line text-muted-fg group-has-data-horizontal/field:text-balance",
        "last:mt-0 nth-last-2:-mt-1",
        // sit right under a legend, cancelling its margin and the fieldset gap
        "[[data-variant=legend]+&]:mt-[calc(-0.5rem-var(--field-set-gap,0px))]!",
        "[&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-fg",
        className,
      )}
      {...props}
    />
  );
}

function FieldSeparator({
  children,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  children?: React.ReactNode;
}) {
  return (
    <div
      data-slot="field-separator"
      data-content={!!children}
      className={cn(
        "relative -my-2 h-5 text-sm group-data-[variant=outline]/field-group:-mb-2",
        className,
      )}
      {...props}
    >
      <Separator className="absolute inset-0 top-1/2" />
      {children && (
        <span
          className="relative mx-auto block w-fit bg-background px-2 text-muted-fg"
          data-slot="field-separator-content"
        >
          {children}
        </span>
      )}
    </div>
  );
}

function FieldError({
  className,
  children,
  errors,
  ...props
}: React.ComponentProps<"div"> & {
  errors?: Array<{ message?: string } | undefined>;
}) {
  const content = useMemo(() => {
    if (children) {
      return children;
    }

    if (!errors?.length) {
      return null;
    }

    const uniqueErrors = [...new Map(errors.map((error) => [error?.message, error])).values()];

    if (uniqueErrors?.length == 1) {
      return uniqueErrors[0]?.message;
    }

    return (
      <ul className="ml-4 flex list-disc flex-col gap-1">
        {uniqueErrors.map((error, index) => error?.message && <li key={index}>{error.message}</li>)}
      </ul>
    );
  }, [children, errors]);

  if (!content) {
    return null;
  }

  return (
    <div
      role="alert"
      data-slot="field-error"
      className={cn("text-sm font-normal text-destructive", className)}
      {...props}
    >
      {content}
    </div>
  );
}

/**
 * A labelled control in one of three layouts; see docs/architecture/ui-conventions.md#fields.
 * `stack` puts the control under the label, `row` puts short controls at the right edge once the
 * field is wide, and `switch` sets a switch beside its label.
 */
function FieldFrame({
  layout = "stack",
  label,
  description,
  descriptionId,
  note,
  error,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  layout?: "stack" | "row" | "switch";
  label: React.ReactNode;
  description?: React.ReactNode;
  descriptionId?: string;
  // a quieter line under the description, like where a setting comes from
  note?: React.ReactNode;
  error?: React.ReactNode;
  children: React.ReactNode;
}) {
  const about = (description || note) && (
    <div className="flex flex-col gap-1">
      {description && <FieldDescription id={descriptionId}>{description}</FieldDescription>}
      {note}
    </div>
  );
  if (layout === "switch") {
    return (
      <Field orientation="horizontal" className={cn("justify-between", className)} {...props}>
        <FieldContent>
          {label}
          {about}
          {error}
        </FieldContent>
        {children}
      </Field>
    );
  }
  if (layout === "row") {
    return (
      <Field className={cn("@container/field", className)} {...props}>
        <div className="flex flex-col gap-3 @xl/field:grid @xl/field:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] @xl/field:items-start @xl/field:gap-x-6 @xl/field:gap-y-1">
          <div className="flex flex-col gap-1 @xl/field:row-span-2">
            {label}
            {about}
          </div>
          <div className="flex flex-col @xl/field:items-end *:data-[slot=combobox-chips]:w-full *:data-[slot=number-field]:w-full *:data-[slot=number-field]:max-w-44">
            {children}
          </div>
          {error && <div className="@xl/field:col-start-2 @xl/field:text-right">{error}</div>}
        </div>
      </Field>
    );
  }
  return (
    <Field className={className} {...props}>
      {label}
      {children}
      {about}
      {error}
    </Field>
  );
}

export {
  Field,
  FieldFrame,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldContent,
  FieldTitle,
};
