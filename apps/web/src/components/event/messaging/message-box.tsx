import { useMemo, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { IconPaperclip, IconPhoto, IconPlus, IconSend } from "@tabler/icons-react";
import { MAX_MESSAGE_LENGTH, type MessageAttachment } from "@bogey/db/queries/messages";
import { Button } from "@bogey/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bogey/ui/components/dropdown-menu";
import {
  MarkdownEditor,
  MarkdownModeSwitch,
  useMarkdownMode,
} from "@bogey/ui/components/markdown-input";
import {
  appFormOptions,
  errorVisibility,
  rewardEarlyPunishLate,
  schemaMetaOf,
  useAppForm,
} from "@bogey/ui/lib/form";
import { cn } from "@bogey/ui/lib/utils";
import { useT, type T } from "#/lib/translate.tsx";
import { LONG_PASTE, PendingAttachments, useAttachmentUploads } from "./message-attachments.tsx";

export interface OutgoingMessage {
  body: string;
  attachments: MessageAttachment[];
}

const messageSchema = (t: T) =>
  z.object({
    body: z
      .string()
      .max(MAX_MESSAGE_LENGTH, t("conv.maxLength", { max: MAX_MESSAGE_LENGTH }))
      .meta({ label: t("compose.message"), placeholder: t("conv.placeholder") }),
  });

/**
 * The box at the bottom of a conversation or the announcements channel: a
 * Markdown body plus files, uploaded to `<event>/<folderId>/...` as they're
 * added. `onSend` returns an error to show, or nothing once it's sent.
 */
export function MessageBox({
  eventId,
  folderId,
  onSend,
  above,
  controls,
  allowEmpty = false,
}: {
  eventId: string;
  folderId: string;
  onSend: (message: OutgoingMessage) => Promise<string | undefined>;
  above?: ReactNode;
  controls?: ReactNode;
  allowEmpty?: boolean;
}) {
  const t = useT();
  const schema = useMemo(() => messageSchema(t), [t]);
  const uploads = useAttachmentUploads(eventId, folderId);
  const [mode, setMode] = useMarkdownMode();
  const [dragging, setDragging] = useState(false);
  const files = useRef<HTMLInputElement>(null);
  const pictures = useRef<HTMLInputElement>(null);
  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: { body: "" },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
      if (uploads.uploading) return createValidationError(t("conv.waitUploads"));
      if (uploads.failed) return createValidationError(t("conv.removeFailed"));
      if (!allowEmpty && !value.body.trim() && !uploads.ready.length) {
        return createValidationError(t("conv.writeSomething"));
      }
      const error = await onSend({ body: value.body, attachments: uploads.ready });
      if (error) return createValidationError(error);
      formApi.reset();
      uploads.clear();
      setMode("write");
      return undefined;
    },
  });

  const pick = (input: HTMLInputElement | null) => input?.click();
  const take = (list: FileList | null) => {
    if (list?.length) uploads.add([...list]);
  };

  return (
    <form.AppForm>
      <form.Form
        className={cn(
          "flex flex-col gap-2 border-t border-border p-3 transition-colors",
          dragging && "bg-accent",
        )}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          if (!event.dataTransfer.files.length) return;
          event.preventDefault();
          setDragging(false);
          take(event.dataTransfer.files);
        }}
      >
        {above}
        <PendingAttachments items={uploads.items} onRemove={uploads.remove} />
        {uploads.problem && <p className="text-xs text-destructive">{uploads.problem}</p>}
        <form.Field name="body">
          {(field) => (
            <field.Field>
              <field.Label className="sr-only" />
              <MarkdownEditor
                id={field.name}
                name={field.name}
                mode={mode}
                rows={2}
                features="message"
                placeholder={schemaMetaOf(field).placeholder}
                value={field.value}
                onValueChange={(next) => field.handleChange(next)}
                onBlur={field.handleBlur}
                aria-invalid={field.meta.isInvalid || undefined}
                trailing={<MarkdownModeSwitch mode={mode} onModeChange={setMode} />}
                onPaste={(event) => {
                  const pasted = [...event.clipboardData.files];
                  if (pasted.length) {
                    event.preventDefault();
                    uploads.add(pasted);
                    return;
                  }
                  const text = event.clipboardData.getData("text/plain");
                  if (text.length > LONG_PASTE) {
                    event.preventDefault();
                    uploads.addText(text);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void form.handleSubmit();
                  }
                }}
              />
              <field.Error />
            </field.Field>
          )}
        </form.Field>
        <form.FormAlert title={t("conv.sendFailed")} />
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  aria-label={t("conv.add")}
                  title={t("conv.addTitle")}
                />
              }
            >
              <IconPlus />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top">
              <DropdownMenuItem onClick={() => pick(files.current)}>
                <IconPaperclip />
                {t("conv.files")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => pick(pictures.current)}>
                <IconPhoto />
                {t("conv.pictures")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <input
            ref={files}
            type="file"
            multiple
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => {
              take(event.target.files);
              event.target.value = "";
            }}
          />
          <input
            ref={pictures}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => {
              take(event.target.files);
              event.target.value = "";
            }}
          />
          {controls}
          <span className="hidden flex-1 text-xs text-muted-fg sm:inline">{t("conv.hint")}</span>
          <span className="flex-1 sm:hidden" />
          <form.Subscribe selector={(state) => state.values.body.length}>
            {(length) => <CharacterCount length={length} max={MAX_MESSAGE_LENGTH} />}
          </form.Subscribe>
          <form.Submit size="sm" pending={t("onboarding.sending")} disabled={uploads.uploading}>
            <IconSend />
            {t("conv.send")}
          </form.Submit>
        </div>
      </form.Form>
    </form.AppForm>
  );
}

function CharacterCount({ length, max }: { length: number; max: number }) {
  const t = useT();
  const near = length > max * 0.9;
  return (
    <span
      className={cn(
        "shrink-0 text-xs tabular-nums",
        length > max ? "text-destructive" : near ? "text-warning" : "text-muted-fg",
      )}
      aria-live={near ? "polite" : "off"}
      title={t("conv.characters", { length, max })}
    >
      {length.toLocaleString()}/{max.toLocaleString()}
    </span>
  );
}
