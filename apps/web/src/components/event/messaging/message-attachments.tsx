import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  IconAlertTriangle,
  IconDownload,
  IconFile,
  IconFileText,
  IconPhoto,
  IconX,
} from "@tabler/icons-react";
import { browserClient } from "@bogey/db/browser";
import {
  ATTACHMENTS_BUCKET,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  type MessageAttachment,
} from "@bogey/db/queries/messages";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@bogey/ui/components/chat/attachment";
import {
  createDialogHandle,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@bogey/ui/components/dialog";
import { Markdown } from "@bogey/ui/components/markdown";
import { Spinner } from "@bogey/ui/components/spinner";
import { useT, type T } from "#/lib/translate.tsx";

export const LONG_PASTE = 2_000;
const PASTED_NAME = "Pasted text.md";

const isImage = (type: string) => type.startsWith("image/");
const isText = (attachment: Pick<MessageAttachment, "type" | "name">) =>
  attachment.type.startsWith("text/") || /\.(md|txt)$/i.test(attachment.name);

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function kind(attachment: Pick<MessageAttachment, "type" | "name">, t: T): string {
  if (attachment.name === PASTED_NAME) return t("attach.pasted");
  const extension = attachment.name.split(".").at(-1);
  return extension && extension !== attachment.name ? extension.toUpperCase() : t("attach.file");
}

export interface PendingAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  state: "uploading" | "done" | "error";
  path?: string;
  error?: string;
  text?: string;
}

export function useAttachmentUploads(eventId: string, conversationId: string) {
  const t = useT();
  const [items, setItems] = useState<Tuple<PendingAttachment>>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const storage = () => browserClient().storage.from(ATTACHMENTS_BUCKET);

  const update = (id: string, change: Partial<PendingAttachment>) =>
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...change } : item)));

  const upload = async (item: PendingAttachment, file: Blob) => {
    const safe = item.name.replace(/[^\w.-]+/g, "_").slice(-100) || "file";
    const path = `${eventId}/${conversationId}/${item.id}/${safe}`;
    const { error } = await storage().upload(path, file, {
      contentType: item.type || undefined,
    });
    update(item.id, error ? { state: "error", error: error.message } : { state: "done", path });
  };

  const add = (files: Tuple<File>) => {
    setProblem(null);
    const room = MAX_ATTACHMENTS - items.length;
    if (files.length > room) {
      setProblem(t("attach.tooMany", { max: MAX_ATTACHMENTS }));
    }
    for (const file of files.slice(0, Math.max(room, 0))) {
      const item: PendingAttachment = {
        id: crypto.randomUUID(),
        name: file.name || "file",
        size: file.size,
        type: file.type,
        state: "uploading",
      };
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setItems((current) => [
          ...current,
          {
            ...item,
            state: "error",
            error: t("attach.over", { size: size(MAX_ATTACHMENT_BYTES) }),
          },
        ]);
        continue;
      }
      setItems((current) => [...current, item]);
      void upload(item, file);
    }
  };

  const addText = (text: string) => {
    if (items.length >= MAX_ATTACHMENTS) {
      setProblem(t("attach.tooMany", { max: MAX_ATTACHMENTS }));
      return;
    }
    const blob = new Blob([text], { type: "text/markdown" });
    const item: PendingAttachment = {
      id: crypto.randomUUID(),
      name: PASTED_NAME,
      size: blob.size,
      type: "text/markdown",
      state: "uploading",
      text,
    };
    setItems((current) => [...current, item]);
    void upload(item, blob);
  };

  const remove = (id: string) => {
    const item = items.find((each) => each.id === id);
    setItems((current) => current.filter((each) => each.id !== id));
    if (item?.path) void storage().remove([item.path]);
  };

  const ready: MessageAttachment[] = items.flatMap((item) =>
    item.state === "done" && item.path
      ? [{ path: item.path, name: item.name, size: item.size, type: item.type }]
      : [],
  );

  return {
    items,
    problem,
    add,
    addText,
    remove,
    clear: () => setItems([]),
    ready,
    uploading: items.some((item) => item.state === "uploading"),
    failed: items.some((item) => item.state === "error"),
  };
}

const textPreview = createDialogHandle<{ name: string; text: string }>();

export function PendingAttachments({
  items,
  onRemove,
}: {
  items: Tuple<PendingAttachment>;
  onRemove: (id: string) => void;
}) {
  const t = useT();
  if (!items.length) return null;
  return (
    <>
      <AttachmentGroup aria-label={t("attach.label")}>
        {items.map((item) => (
          <Attachment key={item.id} size="sm" state={item.state === "error" ? "error" : item.state}>
            {item.text !== undefined && (
              <AttachmentTrigger
                aria-label={t("attach.read", { name: kind(item, t).toLowerCase() })}
                onClick={() =>
                  item.text !== undefined &&
                  textPreview.openWithPayload({ name: kind(item, t), text: item.text })
                }
              />
            )}
            <AttachmentMedia>
              {item.state === "uploading" ? (
                <Spinner />
              ) : item.state === "error" ? (
                <IconAlertTriangle />
              ) : (
                <AttachmentIcon attachment={item} />
              )}
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>
                {item.name === PASTED_NAME ? kind(item, t) : item.name}
              </AttachmentTitle>
              <AttachmentDescription>
                {item.state === "error"
                  ? (item.error ?? t("attach.uploadFailed"))
                  : item.text !== undefined
                    ? t("attach.characters", { count: item.text.length })
                    : `${kind(item, t)} · ${size(item.size)}`}
              </AttachmentDescription>
            </AttachmentContent>
            <AttachmentActions>
              <AttachmentAction
                aria-label={t("attach.remove", { name: item.name })}
                title={t("attach.removeTitle")}
                onClick={() => onRemove(item.id)}
              >
                <IconX />
              </AttachmentAction>
            </AttachmentActions>
          </Attachment>
        ))}
      </AttachmentGroup>
      <TextPreviewDialog />
    </>
  );
}

function AttachmentIcon({ attachment }: { attachment: Pick<MessageAttachment, "type" | "name"> }) {
  if (isImage(attachment.type)) return <IconPhoto />;
  if (isText(attachment)) return <IconFileText />;
  return <IconFile />;
}

function useSignedUrl(path: string, enabled: boolean) {
  return useQuery({
    queryKey: ["attachment-url", path] as const,
    queryFn: async () => {
      const { data, error } = await browserClient()
        .storage.from(ATTACHMENTS_BUCKET)
        .createSignedUrl(path, 60 * 60);
      if (error) throw error;
      return data.signedUrl;
    },
    enabled,
    staleTime: 50 * 60 * 1000,
  });
}

export function MessageAttachments({ attachments }: { attachments: Tuple<MessageAttachment> }) {
  const t = useT();
  if (!attachments.length) return null;
  return (
    <>
      <AttachmentGroup aria-label={t("attach.label")} className="max-w-full">
        {attachments.map((attachment) => (
          <SentAttachment key={attachment.path} attachment={attachment} />
        ))}
      </AttachmentGroup>
      <TextPreviewDialog />
    </>
  );
}

function SentAttachment({ attachment }: { attachment: MessageAttachment }) {
  const t = useT();
  const image = isImage(attachment.type);
  const text = isText(attachment);
  const thumbnail = useSignedUrl(attachment.path, image);
  const open = useMutation({
    mutationFn: async () => {
      const storage = browserClient().storage.from(ATTACHMENTS_BUCKET);
      if (text) {
        const { data, error } = await storage.download(attachment.path);
        if (error) throw error;
        textPreview.openWithPayload({ name: kind(attachment, t), text: await data.text() });
        return;
      }
      const { data, error } = await storage.createSignedUrl(attachment.path, 60, {
        download: image ? false : attachment.name,
      });
      if (error) throw error;
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    },
  });
  const title = attachment.name === PASTED_NAME ? kind(attachment, t) : attachment.name;

  return (
    <Attachment size="sm" state={open.isError ? "error" : open.isPending ? "processing" : "done"}>
      <AttachmentTrigger
        aria-label={
          text
            ? t("attach.read", { name: title })
            : image
              ? t("attach.open", { name: title })
              : t("attach.download", { name: title })
        }
        disabled={open.isPending}
        onClick={() => open.mutate()}
      />
      <AttachmentMedia variant={image && thumbnail.data ? "image" : "icon"}>
        {image && thumbnail.data ? (
          <img src={thumbnail.data} alt="" loading="lazy" />
        ) : (
          <AttachmentIcon attachment={attachment} />
        )}
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{title}</AttachmentTitle>
        <AttachmentDescription>
          {open.isError
            ? t("attach.openFailed")
            : `${kind(attachment, t)} · ${size(attachment.size)}`}
        </AttachmentDescription>
      </AttachmentContent>
      {!text && !image && (
        <AttachmentActions>
          <IconDownload className="mx-1 size-4 text-muted-fg" aria-hidden />
        </AttachmentActions>
      )}
    </Attachment>
  );
}

function TextPreviewDialog() {
  const t = useT();
  return (
    <Dialog handle={textPreview}>
      {({ payload }) => (
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{payload?.name ?? t("attach.text")}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[70dvh] overflow-y-auto scrollbar-thin">
            {payload && <Markdown>{payload.text}</Markdown>}
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
