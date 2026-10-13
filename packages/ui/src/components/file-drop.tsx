import { useId, useRef, useState, type DragEvent } from "react";
import { IconFile, IconUpload, IconX } from "@tabler/icons-react";
import { cn } from "@bogey/ui/lib/utils";
import { Button } from "./button.tsx";
import { Spinner } from "./spinner.tsx";
import { useUiText } from "../lib/ui-text.ts";

export interface DroppedFile {
  id: string;
  name: string;
  sizeBytes: number;
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function FileDrop({
  id,
  files,
  accept,
  maxMb,
  busy,
  disabled,
  invalid,
  multiple = true,
  onAdd,
  onRemove,
}: {
  id?: string;
  files: Tuple<DroppedFile>;
  accept?: string;
  maxMb?: number;
  busy?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  multiple?: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
}) {
  const t = useUiText();
  const fallbackId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const inputId = id ?? fallbackId;

  const take = (list: FileList | null) => {
    if (list?.length) onAdd([...list]);
  };
  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setOver(false);
    if (!disabled && !busy) take(event.dataTransfer.files);
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        aria-invalid={invalid || undefined}
        className={cn(
          "flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm transition-colors",
          over && "border-primary bg-primary/5",
          invalid && "border-destructive",
          disabled && "opacity-60",
        )}
      >
        {busy ? <Spinner /> : <IconUpload className="size-5 text-muted-fg" />}
        <p className="text-muted-fg">
          {busy ? t("ui.uploading") : multiple ? t("ui.dropFiles") : t("ui.dropFile")}{" "}
          {!busy && (
            <button
              type="button"
              className="link"
              disabled={disabled}
              onClick={() => input.current?.click()}
            >
              {multiple ? t("ui.chooseFiles") : t("ui.chooseFile")}
            </button>
          )}
        </p>
        {(accept || maxMb) && (
          <p className="text-xs text-muted-fg">
            {[accept?.split(",").join(", "), maxMb && t("ui.upToMb", { mb: maxMb })]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
        <input
          ref={input}
          id={inputId}
          type="file"
          multiple={multiple}
          accept={accept}
          className="sr-only"
          disabled={disabled || busy}
          onChange={(event) => {
            take(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      {files.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border">
          {files.map((file) => (
            <li key={file.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <IconFile className="size-4 shrink-0 text-muted-fg" />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="shrink-0 text-xs text-muted-fg tabular-nums">
                {size(file.sizeBytes)}
              </span>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label={t("ui.removeNamed", { name: file.name })}
                disabled={disabled}
                onClick={() => onRemove(file.id)}
              >
                <IconX />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
