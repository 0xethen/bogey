import { useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { IconPhotoUp } from "@tabler/icons-react";
import { browserClient } from "@bogey/db/browser";
import { Button } from "@bogey/ui/components/button";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Input } from "@bogey/ui/components/input";
import { cn } from "@bogey/ui/lib/utils";
import { useT, type T } from "#/lib/translate.tsx";

export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";
export const IMAGE_MAX_MB = 5;

/** Uploads a picture into `folder` of the public event-assets bucket: `<event>/...`, or
 * `org/<org>/...` for what belongs to the organization. */
export async function uploadImage(
  folder: string,
  file: File,
  t: T,
): Promise<{ path: string; url: string }> {
  if (file.size > IMAGE_MAX_MB * 1024 * 1024) {
    throw new Error(t("onboarding.tooBig", { name: file.name, max: IMAGE_MAX_MB }));
  }
  const safe = file.name.replace(/[^\w.-]+/g, "_").slice(-80);
  const path = `${folder}/${crypto.randomUUID()}-${safe}`;
  const storage = browserClient().storage.from("event-assets");
  const { error } = await storage.upload(path, file, { contentType: file.type });
  if (error) {
    throw new Error(t("onboarding.uploadFailed", { name: file.name, error: error.message }));
  }
  return { path, url: storage.getPublicUrl(path).data.publicUrl };
}

export function ImageInput({
  id,
  eventId,
  value,
  onChange,
  invalid,
  placeholder = "https://...",
  compact = false,
}: {
  id: string;
  eventId: string;
  value: string;
  onChange: (url: string) => void;
  invalid?: boolean;
  placeholder?: string;
  compact?: boolean;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: async (file: File) => (await uploadImage(eventId, file, t)).url,
    onSuccess: onChange,
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-2">
        {value && (
          <img
            src={value}
            alt=""
            referrerPolicy="no-referrer"
            className={cn(
              "shrink-0 rounded-xl border border-border bg-white object-contain",
              compact ? "size-9" : "size-16",
            )}
          />
        )}
        <Input
          id={id}
          type="url"
          value={value}
          placeholder={placeholder}
          aria-invalid={invalid ? true : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          disabled={upload.isPending}
          onClick={() => input.current?.click()}
        >
          <IconPhotoUp />
          {upload.isPending ? `${t("image.uploading")}...` : t("image.upload")}
        </Button>
        <input
          ref={input}
          type="file"
          accept={IMAGE_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-label={t("image.choose")}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) upload.mutate(file);
          }}
        />
      </div>
      <ErrorAlert error={upload.error} title={t("image.failed")} />
    </div>
  );
}
