import { useUiText } from "./ui-text.ts";
import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type ReactNode,
  type SubmitEvent,
} from "react";
import { toSlug, typedSlug } from "@bogey/utils/keys";
import {
  createErrorVisibility,
  createFormHook,
  createValidator,
  getFormHookHelpers,
  type AnyFieldApi,
  type FieldWithValue,
} from "@tanstack/react-form";
import { Button } from "../components/button";
import { Input } from "../components/input";
import { NumberInput as NumberFieldInput } from "../components/number-field";
import { Textarea } from "../components/textarea";
import { Switch } from "../components/switch";
import { Spinner } from "../components/spinner";
import { OptSelect, type SelectOption } from "../components/opt-select";
import { DateTimeInput } from "../components/date-time-field";
import { ErrorAlert } from "../components/error-alert";
import { OptionsInput } from "../components/options-input";
import { MultiSelect, SearchSelect, type SearchSelectOption } from "../components/search-select";
import {
  MarkdownEditor,
  MarkdownLabel,
  MarkdownModeSwitch,
  useMarkdownMode,
  type MarkdownToolbarItem,
} from "../components/markdown-input";
import type { MarkdownFeatureSet } from "@bogey/utils/markdown";
import { CreateDialogHeadline } from "../components/create-dialog";
import { RangeInput, type Range } from "../components/range-input";
import {
  Field as FieldRoot,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
} from "../components/field";
import { useUnsavedEntry } from "./unsaved.ts";
import { cn } from "./utils.ts";
import { fieldMeta, validatorSchema, type SchemaFieldMeta } from "./form-meta.ts";

export { fieldHelp } from "./form-meta.ts";

const { fieldComponent } = getFormHookHelpers();

const schemas = new WeakMap<object, NonNullable<ReturnType<typeof validatorSchema>>>();

export function schemaMetaOf(field: AnyFieldApi): SchemaFieldMeta {
  const schema = schemas.get(field.form);
  return schema ? fieldMeta(schema, field.name) : {};
}

function describedBy(field: AnyFieldApi, meta: SchemaFieldMeta): string | undefined {
  return meta.help ? meta.help(field.value) : meta.description;
}

function resolve(
  field: AnyFieldApi,
  props: { label?: string; placeholder?: string; description?: ReactNode },
) {
  const meta = schemaMetaOf(field);
  return {
    label: props.label ?? meta.label ?? "",
    placeholder: props.placeholder ?? meta.placeholder,
    description: props.description ?? describedBy(field, meta),
  };
}

export const errorVisibility = createErrorVisibility(
  ({ state, fieldState }) =>
    (fieldState.meta.isBlurred && fieldState.meta.isDirty) || state.submissionAttempts > 0,
);

export const rewardEarlyPunishLate = createValidator({
  triggers: [
    "blur",
    {
      trigger: "change",
      when: ({ fieldApi }) => fieldApi !== undefined && fieldApi.meta.isInvalid,
    },
  ],
});

export const remoteCheck = {
  triggers: ["change", "blur"] satisfies Array<"change" | "blur">,
  triggerDebounceMs: 400,
  bailIfInvalid: true,
};

// `<form.Form anchor="details">` gives each field the address `#details.<name>`, like a setting's
const AnchorGroup = createContext<string | undefined>(undefined);

export function fieldAnchor(group: string, name: string): string {
  return `${group}.${name}`;
}

function FormField({
  field,
  className,
  ...props
}: ComponentProps<typeof FieldRoot> & { field: AnyFieldApi }) {
  const group = useContext(AnchorGroup);
  return (
    <FieldRoot
      id={group ? fieldAnchor(group, field.name) : undefined}
      data-invalid={field.meta.isInvalid || undefined}
      className={cn(group && "jump-target", className)}
      {...props}
    />
  );
}

function FormLabel({
  field,
  children,
  ...props
}: ComponentProps<typeof FieldLabel> & { field: AnyFieldApi }) {
  return (
    <FieldLabel htmlFor={field.name} {...props}>
      {children ?? schemaMetaOf(field).label}
    </FieldLabel>
  );
}

function FormLegend({
  field,
  children,
  ...props
}: ComponentProps<typeof FieldLegend> & { field: AnyFieldApi }) {
  return <FieldLegend {...props}>{children ?? schemaMetaOf(field).label}</FieldLegend>;
}

function FormDescription({
  field,
  children,
  ...props
}: ComponentProps<typeof FieldDescription> & { field: AnyFieldApi }) {
  const content = children ?? describedBy(field, schemaMetaOf(field));
  if (!content) return null;
  return (
    <FieldDescription id={`${field.name}-description`} {...props}>
      {content}
    </FieldDescription>
  );
}

function FormError({
  field,
  ...props
}: ComponentProps<typeof FieldError> & { field: AnyFieldApi }) {
  const t = useUiText();
  return (
    <>
      <FieldError {...props} errors={field.meta.errors} />
      {field.meta.isValidating && <FieldDescription>{t("ui.checking")}</FieldDescription>}
    </>
  );
}

function FieldFrame({
  field,
  label,
  required,
  description,
  hideLabel,
  heading,
  row,
  className,
  children,
}: {
  field: AnyFieldApi;
  label: string;
  required?: boolean;
  description?: ReactNode;
  hideLabel?: boolean;
  heading?: ReactNode;
  // short controls: label left, control right once the field group is wide
  row?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <FormField
      field={field}
      className={cn(
        row &&
          "@xl/field-group:grid @xl/field-group:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] @xl/field-group:items-start @xl/field-group:gap-x-6 @xl/field-group:gap-y-1",
        className,
      )}
    >
      <div
        className={cn(
          "contents",
          row && "@xl/field-group:block @xl/field-group:col-start-1 @xl/field-group:row-start-1",
        )}
      >
        {heading ?? (
          <FormLabel
            field={field}
            required={required}
            className={hideLabel ? "sr-only" : undefined}
          >
            {label}
          </FormLabel>
        )}
      </div>
      <div
        className={cn(
          "contents",
          row &&
            "@xl/field-group:block @xl/field-group:col-start-2 @xl/field-group:row-span-2 @xl/field-group:row-start-1",
        )}
      >
        {children}
      </div>
      {description && (
        <div
          className={cn(
            "contents",
            row && "@xl/field-group:block @xl/field-group:col-start-1 @xl/field-group:row-start-2",
          )}
        >
          <FormDescription field={field}>{description}</FormDescription>
        </div>
      )}
      <div
        className={cn(
          "contents",
          row && "@xl/field-group:block @xl/field-group:col-start-2 @xl/field-group:row-start-3",
        )}
      >
        <FormError field={field} />
      </div>
    </FormField>
  );
}

function TextInput({
  field,
  placeholder,
  ...props
}: Omit<ComponentProps<typeof Input>, "value" | "onChange"> & { field: FieldWithValue<string> }) {
  return (
    <Input
      id={field.name}
      name={field.name}
      value={field.value}
      onChange={(event) => field.handleChange(event.target.value)}
      onBlur={field.handleBlur}
      aria-invalid={field.meta.isInvalid || undefined}
      placeholder={placeholder ?? schemaMetaOf(field).placeholder}
      {...props}
    />
  );
}

function TextArea({
  field,
  placeholder,
  ...props
}: Omit<ComponentProps<typeof Textarea>, "value" | "onChange"> & {
  field: FieldWithValue<string>;
}) {
  return (
    <Textarea
      id={field.name}
      name={field.name}
      value={field.value}
      onChange={(event) => field.handleChange(event.target.value)}
      onBlur={field.handleBlur}
      aria-invalid={field.meta.isInvalid || undefined}
      placeholder={placeholder ?? schemaMetaOf(field).placeholder}
      {...props}
    />
  );
}

function NumberInput({
  field,
  min,
  max,
  step,
  placeholder,
  scrub,
}: {
  field: FieldWithValue<number>;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  scrub?: boolean;
}) {
  return (
    <NumberFieldInput
      scrub={scrub}
      id={field.name}
      name={field.name}
      value={Number.isNaN(field.value) ? null : field.value}
      onValueChange={(next) => field.handleChange(next ?? Number.NaN)}
      onBlur={field.handleBlur}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder ?? schemaMetaOf(field).placeholder}
      invalid={field.meta.isInvalid}
    />
  );
}

function SwitchInput({ field, disabled }: { field: FieldWithValue<boolean>; disabled?: boolean }) {
  return (
    <Switch
      id={field.name}
      checked={field.value}
      disabled={disabled}
      onCheckedChange={(checked) => field.handleChange(checked)}
      onBlur={field.handleBlur}
      aria-invalid={field.meta.isInvalid || undefined}
    />
  );
}

function DateTime({
  field,
  label,
  showIcon,
}: {
  field: FieldWithValue<string>;
  label?: string;
  showIcon?: boolean;
}) {
  return (
    <DateTimeInput
      id={field.name}
      label={label ?? schemaMetaOf(field).label ?? ""}
      value={field.value}
      onChange={(next) => field.handleChange(next)}
      onBlur={field.handleBlur}
      invalid={field.meta.isInvalid}
      showIcon={showIcon}
    />
  );
}

export function FieldSelect<T extends string>({
  field,
  options,
  placeholder,
  onValueChange,
}: {
  field: FieldWithValue<T>;
  options: Tuple<NoInfer<SelectOption<T>>>;
  placeholder?: ReactNode;
  onValueChange?: (value: T) => void;
}) {
  return (
    <OptSelect
      id={field.name}
      value={field.value}
      options={options}
      placeholder={placeholder ?? schemaMetaOf(field).placeholder}
      onChange={(value) => {
        field.handleChange(value);
        field.handleBlur();
        onValueChange?.(value);
      }}
    />
  );
}

export function FieldCombobox({
  field,
  options,
  placeholder,
  empty,
}: {
  field: FieldWithValue<string>;
  options: Tuple<SearchSelectOption>;
  placeholder?: string;
  empty?: string;
}) {
  return (
    <SearchSelect
      id={field.name}
      options={options}
      value={field.value || undefined}
      onValueChange={(next) => {
        field.handleChange(next ?? "");
        field.handleBlur();
      }}
      placeholder={placeholder ?? schemaMetaOf(field).placeholder}
      empty={empty}
    />
  );
}

function Options({
  field,
  placeholder,
}: {
  field: FieldWithValue<string[]>;
  placeholder?: string;
}) {
  return (
    <OptionsInput
      id={field.name}
      value={field.value}
      placeholder={placeholder ?? schemaMetaOf(field).placeholder}
      invalid={field.meta.isInvalid}
      onChange={(next) => field.handleChange(next)}
      onBlur={field.handleBlur}
    />
  );
}

function MultiSelectInput({
  field,
  options,
  placeholder,
  empty,
}: {
  field: FieldWithValue<string[]>;
  options: Tuple<SearchSelectOption>;
  placeholder?: string;
  empty?: string;
}) {
  return (
    <MultiSelect
      id={field.name}
      options={options}
      value={field.value}
      onValueChange={(next) => field.handleChange(next)}
      placeholder={placeholder ?? schemaMetaOf(field).placeholder}
      empty={empty}
    />
  );
}

interface WrapperProps {
  label?: string;
  description?: ReactNode;
  placeholder?: string;
  required?: boolean;
}

function TextField({
  field,
  type = "text",
  autoComplete,
  className,
  required,
  ...props
}: WrapperProps & {
  field: FieldWithValue<string>;
  type?: "text" | "email" | "url" | "password";
  autoComplete?: string;
  className?: string;
}) {
  const { label, description, placeholder } = resolve(field, props);
  return (
    <FieldFrame field={field} label={label} required={required} description={description}>
      <TextInput
        field={field}
        type={type}
        aria-required={required || undefined}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className={className}
        aria-describedby={description ? `${field.name}-description` : undefined}
      />
    </FieldFrame>
  );
}

function SlugField({
  field,
  required,
  maxLength = 64,
  ...props
}: WrapperProps & { field: FieldWithValue<string>; maxLength?: number }) {
  const { label, description, placeholder } = resolve(field, props);
  const input = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (caret.current === null || !input.current) return;
    input.current.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });
  return (
    <FieldFrame field={field} label={label} required={required} description={description} row>
      <Input
        ref={input}
        id={field.name}
        name={field.name}
        value={field.value}
        maxLength={maxLength}
        placeholder={placeholder}
        className="font-mono"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        aria-required={required || undefined}
        aria-invalid={field.meta.isInvalid || undefined}
        aria-describedby={description ? `${field.name}-description` : undefined}
        onChange={(event) => {
          caret.current = event.target.selectionStart;
          field.handleChange(typedSlug(event.target.value));
        }}
        onBlur={() => {
          const tidy = toSlug(field.value, maxLength);
          if (tidy !== field.value) field.handleChange(tidy);
          field.handleBlur();
        }}
      />
    </FieldFrame>
  );
}

function TextAreaField({
  field,
  rows = 5,
  required,
  ...props
}: WrapperProps & { field: FieldWithValue<string>; rows?: number }) {
  const { label, description, placeholder } = resolve(field, props);
  return (
    <FieldFrame field={field} label={label} required={required} description={description}>
      <TextArea
        field={field}
        rows={rows}
        placeholder={placeholder}
        aria-required={required || undefined}
      />
    </FieldFrame>
  );
}

function NetworkListField({ field, ...props }: WrapperProps & { field: FieldWithValue<string> }) {
  const { label, description, placeholder } = resolve(field, props);
  const count = field.value.split(/[\s,]+/).filter(Boolean).length;
  return (
    <FieldFrame
      field={field}
      label={label}
      description={
        <>
          {description}
          {count > 0 && ` ${count === 1 ? "1 entry" : `${count} entries`}.`}
        </>
      }
    >
      <TextArea
        field={field}
        rows={4}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        className="font-mono text-sm"
      />
    </FieldFrame>
  );
}

function MarkdownField({
  field,
  rows = 6,
  required,
  preview = true,
  actions,
  features,
  items,
  ...props
}: WrapperProps & {
  field: FieldWithValue<string>;
  rows?: number;
  preview?: boolean;
  actions?: ReactNode;
  features?: MarkdownFeatureSet;
  items?: Tuple<MarkdownToolbarItem>;
}) {
  const { label, description, placeholder } = resolve(field, props);
  const [mode, setMode] = useMarkdownMode();
  return (
    <FieldFrame
      field={field}
      label={label}
      description={description}
      heading={
        <MarkdownLabel
          htmlFor={field.name}
          required={required}
          mode={preview ? mode : undefined}
          onModeChange={setMode}
          actions={actions}
        >
          {label}
        </MarkdownLabel>
      }
    >
      <MarkdownEditor
        id={field.name}
        name={field.name}
        mode={mode}
        value={field.value}
        rows={rows}
        features={features}
        items={items}
        placeholder={placeholder}
        onValueChange={(next) => field.handleChange(next)}
        onBlur={field.handleBlur}
        aria-invalid={field.meta.isInvalid || undefined}
        aria-required={required || undefined}
      />
    </FieldFrame>
  );
}

function RangeField({
  field,
  min,
  max,
  labels,
  required,
  ...props
}: Omit<WrapperProps, "placeholder"> & {
  field: FieldWithValue<Range>;
  min?: number;
  max?: number;
  labels?: [string, string];
}) {
  const { label, description } = resolve(field, props);
  return (
    <FieldFrame field={field} label={label} required={required} description={description}>
      <RangeInput
        id={field.name}
        value={field.value}
        onValueChange={(next) => field.handleChange(next)}
        onBlur={field.handleBlur}
        min={min}
        max={max}
        labels={labels}
        invalid={field.meta.isInvalid}
      />
    </FieldFrame>
  );
}

function HeadlineField({
  field,
  required,
  ...props
}: Omit<WrapperProps, "description"> & { field: FieldWithValue<string> }) {
  const { label, placeholder } = resolve(field, props);
  return (
    <FieldFrame field={field} label={label} required={required} hideLabel>
      <CreateDialogHeadline
        id={field.name}
        name={field.name}
        value={field.value}
        placeholder={placeholder ?? label}
        onChange={(event) => field.handleChange(event.target.value)}
        onBlur={field.handleBlur}
        aria-invalid={field.meta.isInvalid || undefined}
        aria-required={required || undefined}
      />
    </FieldFrame>
  );
}

function BodyField({
  field,
  required,
  features,
  items,
  ...props
}: Omit<WrapperProps, "description"> & {
  field: FieldWithValue<string>;
  features?: MarkdownFeatureSet;
  items?: Tuple<MarkdownToolbarItem>;
}) {
  const { label, placeholder } = resolve(field, props);
  const [mode, setMode] = useMarkdownMode();
  return (
    <FieldFrame field={field} label={label} required={required} hideLabel className="flex-1">
      <MarkdownEditor
        id={field.name}
        name={field.name}
        size="lg"
        mode={mode}
        value={field.value}
        placeholder={placeholder}
        onValueChange={(next) => field.handleChange(next)}
        onBlur={field.handleBlur}
        features={features}
        items={items}
        trailing={<MarkdownModeSwitch mode={mode} onModeChange={setMode} />}
        aria-invalid={field.meta.isInvalid || undefined}
        aria-required={required || undefined}
        className="flex-1"
      />
    </FieldFrame>
  );
}

function NumberField({
  field,
  required,
  min,
  max,
  step,
  scrub,
  ...props
}: WrapperProps & {
  field: FieldWithValue<number>;
  min?: number;
  max?: number;
  step?: number;
  scrub?: boolean;
}) {
  const { label, description, placeholder } = resolve(field, props);
  return (
    <FieldFrame field={field} label={label} required={required} description={description} row>
      <NumberInput
        field={field}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        scrub={scrub}
      />
    </FieldFrame>
  );
}

function SwitchField({
  field,
  disabled,
  ...props
}: Omit<WrapperProps, "placeholder" | "required"> & {
  field: FieldWithValue<boolean>;
  disabled?: boolean;
}) {
  const { label, description } = resolve(field, props);
  return (
    <FormField field={field} orientation="horizontal" className="justify-between">
      <div className="flex flex-col gap-1">
        <FormLabel field={field}>{label}</FormLabel>
        {description && <FormDescription field={field}>{description}</FormDescription>}
      </div>
      <SwitchInput field={field} disabled={disabled} />
    </FormField>
  );
}

function DateTimeField({
  field,
  required,
  showIcon,
  ...props
}: Omit<WrapperProps, "placeholder"> & {
  field: FieldWithValue<string>;
  showIcon?: boolean;
}) {
  const { label, description } = resolve(field, props);
  return (
    <FieldFrame field={field} label={label} required={required} description={description} row>
      <DateTime field={field} label={label} showIcon={showIcon} />
    </FieldFrame>
  );
}

function MultiSelectField({
  field,
  options,
  empty,
  required,
  ...props
}: WrapperProps & {
  field: FieldWithValue<string[]>;
  options: Tuple<SearchSelectOption>;
  empty?: string;
}) {
  const { label, description, placeholder } = resolve(field, props);
  return (
    <FieldFrame field={field} label={label} required={required} description={description} row>
      <MultiSelectInput field={field} options={options} placeholder={placeholder} empty={empty} />
    </FieldFrame>
  );
}

function OptionsField({
  field,
  required,
  ...props
}: WrapperProps & { field: FieldWithValue<string[]> }) {
  const { label, description, placeholder } = resolve(field, props);
  return (
    <FieldFrame field={field} label={label} required={required} description={description}>
      <Options field={field} placeholder={placeholder} />
    </FieldFrame>
  );
}

function Form({
  unsaved,
  anchor,
  children,
  ...props
}: ComponentProps<"form"> & {
  unsaved?: "save" | "draft";
  /** Each field is addressable as `#<anchor>.<name>`, and highlighted when a link lands on it. */
  anchor?: string;
}) {
  const form = useFormContext();
  return (
    <form
      id={form.formId}
      noValidate
      {...props}
      onSubmit={
        props.onSubmit ??
        ((event: SubmitEvent<HTMLFormElement>) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        })
      }
    >
      {unsaved === "save" && <SaveBarEntry />}
      {unsaved === "draft" && <DraftGuard />}
      <AnchorGroup.Provider value={anchor}>{children}</AnchorGroup.Provider>
    </form>
  );
}

// which Submit started each form's submission, and on which attempt: only that button shows it's
// working, while the form's other submit buttons just wait. A save from the unsaved bar or a
// shortcut presses none of them. (Enter in a field clicks the form's first submit button.)
const pressed = new WeakMap<object, { id: string; attempt: number }>();

function Submit({
  children,
  pending,
  onClick,
  ...props
}: Omit<ComponentProps<typeof Button>, "type"> & { pending?: string }) {
  const form = useFormContext();
  const id = useId();
  return (
    <form.Subscribe
      selector={(state) => ({
        isSubmitting: state.isSubmitting,
        attempt: state.submissionAttempts,
      })}
    >
      {({ isSubmitting, attempt }) => {
        const press = pressed.get(form);
        const working = isSubmitting && press?.id === id && press.attempt === attempt;
        return (
          <Button
            type="submit"
            form={form.formId}
            {...props}
            onClick={(event) => {
              pressed.set(form, { id, attempt: form.state.submissionAttempts + 1 });
              onClick?.(event);
            }}
            disabled={props.disabled || isSubmitting}
          >
            {working && <Spinner />}
            {working && pending ? pending : children}
          </Button>
        );
      }}
    </form.Subscribe>
  );
}

function FormAlert({ title }: { title?: string }) {
  const form = useFormContext();
  return (
    <form.Subscribe selector={(state) => state.errors}>
      {(errors) => (
        <ErrorAlert
          error={errors.find(
            (error) => !("path" in error && Array.isArray(error.path) && error.path.length),
          )}
          title={title}
        />
      )}
    </form.Subscribe>
  );
}

function SaveBarEntry() {
  const form = useFormContext();
  return (
    <form.Subscribe selector={(state) => !state.isDefaultValue}>
      {(dirty) => (
        <UnsavedEntry
          dirty={dirty}
          save={async () => {
            try {
              await form.handleSubmit();
            } catch {
              return false;
            }
            if (!form.state.isSubmitSuccessful) return false;
            if (!form.state.isDefaultValue) form.reset(form.state.values);
            return true;
          }}
          reset={() => form.reset()}
        />
      )}
    </form.Subscribe>
  );
}

function DraftGuard() {
  const form = useFormContext();
  return (
    <form.Subscribe selector={(state) => !state.isDefaultValue && !state.isSubmitting}>
      {(dirty) => <UnsavedEntry dirty={dirty} reset={() => form.reset()} />}
    </form.Subscribe>
  );
}

function UnsavedEntry(props: Parameters<typeof useUnsavedEntry>[0]) {
  useUnsavedEntry(props);
  return null;
}

const app = createFormHook({
  fieldComponents: {
    Field: fieldComponent.loose(FormField, "field"),
    Label: fieldComponent.loose(FormLabel, "field"),
    Legend: fieldComponent.loose(FormLegend, "field"),
    Description: fieldComponent.loose(FormDescription, "field"),
    Error: fieldComponent.loose(FormError, "field"),
    TextInput: fieldComponent.strict(TextInput, "field"),
    TextArea: fieldComponent.strict(TextArea, "field"),
    NumberInput: fieldComponent.strict(NumberInput, "field"),
    NumberField: fieldComponent.strict(NumberField, "field"),
    Switch: fieldComponent.strict(SwitchInput, "field"),
    DateTime: fieldComponent.strict(DateTime, "field"),
    TextField: fieldComponent.strict(TextField, "field"),
    TextAreaField: fieldComponent.strict(TextAreaField, "field"),
    SlugField: fieldComponent.strict(SlugField, "field"),
    MarkdownField: fieldComponent.strict(MarkdownField, "field"),
    HeadlineField: fieldComponent.strict(HeadlineField, "field"),
    RangeField: fieldComponent.strict(RangeField, "field"),
    BodyField: fieldComponent.strict(BodyField, "field"),
    NetworkListField: fieldComponent.strict(NetworkListField, "field"),
    SwitchField: fieldComponent.strict(SwitchField, "field"),
    DateTimeField: fieldComponent.strict(DateTimeField, "field"),
    Options: fieldComponent.strict(Options, "field"),
    OptionsField: fieldComponent.strict(OptionsField, "field"),
    MultiSelect: fieldComponent.strict(MultiSelectInput, "field"),
    MultiSelectField: fieldComponent.strict(MultiSelectField, "field"),
  },
  formComponents: {
    Form,
    Submit,
    FormAlert,
    SaveBarEntry,
    DraftGuard,
  },
});

export const { appFormOptions, useFormContext } = app;

export const useAppForm: typeof app.useAppForm = (options) => {
  const form = app.useAppForm(options);
  const schema = validatorSchema(options.validators);
  if (schema) schemas.set(form, schema);
  return form;
};
