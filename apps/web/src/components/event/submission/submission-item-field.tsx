import type { SubmissionItem } from "@bogey/db/queries/submissions";
import { pluginItemType, type PluginItemInfo } from "@bogey/plugins";
import { isPluginAnswerKind } from "@bogey/utils/answers";
import { Checkbox } from "@bogey/ui/components/checkbox";
import { Input } from "@bogey/ui/components/input";
import { NumberInput } from "@bogey/ui/components/number-field";
import { Field, FieldDescription, FieldError, FieldLabel } from "@bogey/ui/components/field";
import {
  MarkdownEditor,
  MarkdownLabel,
  useMarkdownMode,
  type MarkdownMode,
} from "@bogey/ui/components/markdown-input";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { Textarea } from "@bogey/ui/components/textarea";
import { FileDrop } from "@bogey/ui/components/file-drop";
import { IconBrandGoogleDrive, IconLink, IconVideo } from "@tabler/icons-react";
import { useT } from "#/lib/translate.tsx";

const LINK_ICON = { url: IconLink, video: IconVideo, drive: IconBrandGoogleDrive } as const;
const PLACEHOLDER = {
  url: "https://",
  video: "https://youtube.com/...",
  drive: "https://docs.google.com/...",
} as const;

export function pluginItemInfo(item: SubmissionItem): PluginItemInfo {
  return {
    key: item.key,
    label: item.label,
    help: item.help,
    required: item.required,
    config: item.config ?? {},
  };
}

export function SubmissionItemControl({
  item,
  id,
  value,
  invalid,
  disabled,
  onChange,
  onBlur,
  mode,
}: {
  item: SubmissionItem;
  id: string;
  value: string | boolean | undefined;
  invalid: boolean;
  disabled?: boolean;
  onChange: (value: string | boolean) => void;
  onBlur: () => void;
  mode?: MarkdownMode;
}) {
  const t = useT();
  const text = typeof value === "string" ? value : "";
  if (isPluginAnswerKind(item.kind)) {
    const Plugin = pluginItemType(item.kind)?.Field;
    if (Plugin) {
      return (
        <Plugin
          id={id}
          item={pluginItemInfo(item)}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          invalid={invalid}
          disabled={disabled}
        />
      );
    }
    return (
      <Textarea
        id={id}
        value={text}
        rows={3}
        disabled
        aria-invalid={invalid || undefined}
        onChange={() => {}}
      />
    );
  }
  const common = {
    id,
    value: text,
    disabled,
    onBlur,
    "aria-invalid": invalid || undefined,
  };

  switch (item.kind) {
    case "boolean":
      return (
        <Checkbox
          id={id}
          checked={value === true}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          onCheckedChange={(checked) => onChange(checked === true)}
        />
      );
    case "select":
      return (
        <OptSelect
          id={id}
          value={text}
          placeholder={t("onboarding.chooseOne")}
          disabled={disabled}
          options={item.options.map((option) => ({ value: option, label: option }))}
          onChange={(next) => {
            onChange(next);
            onBlur();
          }}
        />
      );
    case "longtext":
      return <Textarea {...common} rows={5} onChange={(e) => onChange(e.target.value)} />;
    case "markdown":
      return <MarkdownEditor {...common} mode={mode} rows={10} onValueChange={onChange} />;
    case "url":
    case "video":
    case "drive": {
      const Icon = LINK_ICON[item.kind];
      return (
        <div className="relative">
          <Icon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-fg" />
          <Input
            {...common}
            type="url"
            inputMode="url"
            className="pl-9"
            placeholder={PLACEHOLDER[item.kind]}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );
    }
    case "number":
      return (
        <NumberInput
          id={id}
          className="max-w-56"
          scrub={false}
          disabled={disabled}
          invalid={invalid}
          value={text.trim() && Number.isFinite(Number(text)) ? Number(text) : null}
          onValueChange={(next) => onChange(next === null ? "" : String(next))}
          onBlur={onBlur}
        />
      );
    default:
      return <Input {...common} onChange={(e) => onChange(e.target.value)} />;
  }
}

export function SubmissionItemField({
  item,
  id,
  value,
  errors,
  onChange,
  onBlur,
  blind,
}: {
  item: SubmissionItem;
  id: string;
  blind?: boolean;
  value: string | boolean | undefined;
  errors: Tuple<{ message?: string } | undefined>;
  onChange: (value: string | boolean) => void;
  onBlur: () => void;
}) {
  const t = useT();
  const [mode, setMode] = useMarkdownMode();
  const invalid = errors.length > 0;
  const control = (
    <SubmissionItemControl
      item={item}
      id={id}
      value={value}
      invalid={invalid}
      mode={mode}
      onChange={onChange}
      onBlur={onBlur}
    />
  );
  return (
    <Field
      data-invalid={invalid || undefined}
      orientation={item.kind === "boolean" ? "horizontal" : "vertical"}
    >
      {item.kind === "boolean" && control}
      <div className="flex flex-1 flex-col gap-2">
        {item.kind === "markdown" ? (
          <MarkdownLabel htmlFor={id} required={item.required} mode={mode} onModeChange={setMode}>
            {item.label}
          </MarkdownLabel>
        ) : (
          <FieldLabel htmlFor={id} required={item.required}>
            {item.label}
          </FieldLabel>
        )}
        {item.kind !== "boolean" && control}
        {item.help && <FieldDescription>{item.help}</FieldDescription>}
        {blind && item.namesPeople && (
          <FieldDescription>{t("submission.namesFine")}</FieldDescription>
        )}
        <FieldError errors={[...errors]} />
      </div>
    </Field>
  );
}

const noop = () => {};

export function SubmissionItemPreview({ item }: { item: SubmissionItem }) {
  const t = useT();
  const id = `preview-${item.key || item.label}`;
  const shown = { ...item, label: item.label || t("submission.untitledItem") };
  if (item.kind !== "file") {
    return (
      <SubmissionItemField
        item={shown}
        id={id}
        value={item.kind === "boolean" ? false : ""}
        errors={[]}
        onChange={noop}
        onBlur={noop}
      />
    );
  }
  return (
    <Field>
      <FieldLabel htmlFor={id} required={item.required}>
        {shown.label}
      </FieldLabel>
      <FileDrop
        id={id}
        files={[]}
        accept={item.accept}
        maxMb={item.maxMb ?? 50}
        onAdd={noop}
        onRemove={noop}
      />
      {item.help && <FieldDescription>{item.help}</FieldDescription>}
    </Field>
  );
}
