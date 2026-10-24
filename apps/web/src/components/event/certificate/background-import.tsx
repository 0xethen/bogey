import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { IconCheck } from "@tabler/icons-react";
import type { CertificateImage, CertificateKind } from "@bogey/utils/certificate";
import { Button } from "@bogey/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bogey/ui/components/dialog";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { FileDrop } from "@bogey/ui/components/file-drop";
import { Label } from "@bogey/ui/components/label";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { Spinner } from "@bogey/ui/components/spinner";
import { cn } from "@bogey/ui/lib/utils";
import { IMAGE_ACCEPT, uploadImage } from "#/components/event/submission/image-input.tsx";
import { useT, type PlainKey, type T } from "#/lib/translate.tsx";
import { DECK_LIMITS, type DeckProblem } from "./slide-limits.ts";
import {
  DECK_ACCEPT,
  DeckError,
  isDeckFile,
  readDeck,
  type Deck,
  type DeckSlide,
} from "./slides.ts";

export interface PictureSize {
  width: number;
  height: number;
}

const PROBLEMS: Record<Exclude<DeckProblem, "tooBig">, PlainKey> = {
  empty: "certImport.empty",
  unreadable: "certImport.unreadable",
  timeout: "certImport.timeout",
  kind: "certImport.kind",
};

function explain(error: unknown, t: T): Error {
  if (!(error instanceof DeckError))
    return error instanceof Error ? error : new Error(String(error));
  return new Error(
    error.reason === "tooBig"
      ? t("certImport.tooBig", { mb: DECK_LIMITS.fileMb, slides: DECK_LIMITS.slides })
      : t(PROBLEMS[error.reason]),
  );
}

function naturalSize(file: File): Promise<PictureSize | null> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(
        image.naturalWidth > 0 && image.naturalHeight > 0
          ? { width: image.naturalWidth, height: image.naturalHeight }
          : null,
      );
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
}

/** A deck read in this tab, let go of when replaced or when the dialog closes. */
function useDeck() {
  const t = useT();
  const [deck, setDeck] = useState<Deck | null>(null);
  const held = useRef<Deck | null>(null);
  const hold = (next: Deck | null) => {
    held.current?.dispose();
    held.current = next;
    setDeck(next);
  };
  useEffect(() => () => held.current?.dispose(), []);
  const read = useMutation({
    mutationFn: async (file: File) => {
      try {
        return await readDeck(file);
      } catch (error) {
        throw explain(error, t);
      }
    },
    onSuccess: hold,
  });
  return { deck, read, clear: () => hold(null) };
}

function SlideCard({
  slide,
  picked,
  children,
}: {
  slide: DeckSlide;
  picked?: boolean;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <li
      className={cn(
        "flex flex-col gap-2 rounded-xl border border-border p-2",
        picked && "border-primary ring-1 ring-primary",
      )}
    >
      <div className="flex aspect-[4/3] items-center justify-center rounded-lg bg-muted/50 p-1">
        <img
          src={slide.preview}
          alt={t("certImport.slide", { number: slide.number })}
          className="max-h-full max-w-full shadow-sm"
          draggable={false}
        />
      </div>
      {children}
    </li>
  );
}

function SlideGrid({ children }: { children: ReactNode }) {
  return (
    <ul className="grid max-h-[55dvh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
      {children}
    </ul>
  );
}

function Reading() {
  const t = useT();
  return (
    <p className="flex items-center gap-2 text-sm text-muted-fg">
      <Spinner />
      {t("certImport.reading")}...
    </p>
  );
}

/** Picks one certificate's background: a picture as it is, or a slide from a .pptx or .pdf. */
export function BackgroundDialog({
  open,
  onOpenChange,
  folder,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folder: string;
  onPick: (image: CertificateImage, size: PictureSize | null) => void;
}) {
  const t = useT();
  const { deck, read, clear } = useDeck();
  const close = () => {
    clear();
    read.reset();
    use.reset();
    onOpenChange(false);
  };
  const use = useMutation({
    mutationFn: async (source: { file: File } | { slide: DeckSlide }) => {
      try {
        const file = "file" in source ? source.file : await source.slide.render();
        const size =
          "slide" in source
            ? { width: source.slide.width, height: source.slide.height }
            : await naturalSize(file);
        const stored = await uploadImage(folder, file, t);
        return { image: { url: stored.url, path: stored.path }, size };
      } catch (error) {
        throw explain(error, t);
      }
    },
    onSuccess: ({ image, size }) => {
      onPick(image, size);
      close();
    },
  });
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("certImport.title")}</DialogTitle>
          <DialogDescription>{t("certImport.intro")}</DialogDescription>
        </DialogHeader>
        {deck ? (
          <div className="flex flex-col gap-3">
            <SlideGrid>
              {deck.slides.map((slide) => (
                <SlideCard key={slide.number} slide={slide}>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={use.isPending}
                    onClick={() => use.mutate({ slide })}
                  >
                    {t("certImport.useSlide", { number: slide.number })}
                  </Button>
                </SlideCard>
              ))}
            </SlideGrid>
            {/\.pptx$/i.test(deck.name) && (
              <p className="text-xs text-muted-fg">{t("certImport.pptxNote")}</p>
            )}
          </div>
        ) : (
          <FileDrop
            files={[]}
            accept={`${IMAGE_ACCEPT},${DECK_ACCEPT}`}
            maxMb={DECK_LIMITS.fileMb}
            multiple={false}
            busy={use.isPending}
            disabled={read.isPending}
            onAdd={([file]) => {
              if (!file) return;
              if (isDeckFile(file)) read.mutate(file);
              else use.mutate({ file });
            }}
            onRemove={() => undefined}
          />
        )}
        {read.isPending && <Reading />}
        <ErrorAlert error={read.error} title={t("certImport.readFailed")} />
        <ErrorAlert error={use.error} title={t("image.failed")} />
        <DialogFooter>
          {use.isPending && deck && (
            <p className="flex items-center gap-2 text-sm text-muted-fg">
              <Spinner />
              {t("image.uploading")}...
            </p>
          )}
          {deck && (
            <Button variant="ghost" disabled={use.isPending} onClick={clear}>
              {t("certImport.another")}
            </Button>
          )}
          <Button variant="outline" onClick={close}>
            {t("common.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Reads one deck and gives slides to several kinds of certificate at once. */
export function AssignSlidesDialog({
  open,
  onOpenChange,
  kinds,
  kindName,
  apply,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kinds: Tuple<CertificateKind>;
  kindName: (kind: CertificateKind) => string;
  /** Saves `file` as `kind`'s background. */
  apply: (kind: CertificateKind, file: File, size: PictureSize) => Promise<void>;
  onApplied?: (count: number) => void;
}) {
  const t = useT();
  const id = useId();
  const { deck, read, clear } = useDeck();
  const [assigned, setAssigned] = useState<Partial<Record<CertificateKind, number>>>({});
  const [missing, setMissing] = useState(false);
  const close = () => {
    clear();
    read.reset();
    save.reset();
    setAssigned({});
    setMissing(false);
    onOpenChange(false);
  };
  const save = useMutation({
    mutationFn: async () => {
      if (!deck) return 0;
      let count = 0;
      for (const kind of kinds) {
        const slide = deck.slides.find((each) => each.number === assigned[kind]);
        if (!slide) continue;
        try {
          await apply(kind, await slide.render(), { width: slide.width, height: slide.height });
        } catch (error) {
          throw explain(error, t);
        }
        count += 1;
      }
      return count;
    },
    onSuccess: (count) => {
      onApplied?.(count);
      close();
    },
  });
  const usedFor = (number: number) =>
    kinds.filter((kind) => assigned[kind] === number).map(kindName);
  const pickedCount = kinds.filter((kind) => assigned[kind] !== undefined).length;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("certImport.assignTitle")}</DialogTitle>
          <DialogDescription>{t("certImport.assignIntro")}</DialogDescription>
        </DialogHeader>
        {deck ? (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {kinds.map((kind) => (
                <div key={kind} className="flex flex-col gap-1.5">
                  <Label htmlFor={`${id}-${kind}`}>{kindName(kind)}</Label>
                  <OptSelect<string>
                    id={`${id}-${kind}`}
                    size="sm"
                    value={String(assigned[kind] ?? "")}
                    options={[
                      { value: "", label: t("certImport.keep") },
                      ...deck.slides.map((slide) => ({
                        value: String(slide.number),
                        label: t("certImport.slide", { number: slide.number }),
                      })),
                    ]}
                    onChange={(value) => {
                      setMissing(false);
                      setAssigned((current) => ({
                        ...current,
                        [kind]: value ? Number(value) : undefined,
                      }));
                    }}
                  />
                </div>
              ))}
            </div>
            <SlideGrid>
              {deck.slides.map((slide) => {
                const kindsHere = usedFor(slide.number);
                return (
                  <SlideCard key={slide.number} slide={slide} picked={kindsHere.length > 0}>
                    <p className="flex items-center gap-1 text-xs text-muted-fg">
                      {kindsHere.length > 0 && <IconCheck className="size-3.5 text-primary" />}
                      {kindsHere.length > 0
                        ? t("certImport.usedFor", {
                            number: slide.number,
                            kinds: kindsHere.join(", "),
                          })
                        : t("certImport.slide", { number: slide.number })}
                    </p>
                  </SlideCard>
                );
              })}
            </SlideGrid>
            {/\.pptx$/i.test(deck.name) && (
              <p className="text-xs text-muted-fg">{t("certImport.pptxNote")}</p>
            )}
          </div>
        ) : (
          <FileDrop
            files={[]}
            accept={DECK_ACCEPT}
            maxMb={DECK_LIMITS.fileMb}
            multiple={false}
            disabled={read.isPending}
            onAdd={([file]) => {
              if (file) read.mutate(file);
            }}
            onRemove={() => undefined}
          />
        )}
        {read.isPending && <Reading />}
        <ErrorAlert error={read.error} title={t("certImport.readFailed")} />
        <ErrorAlert error={save.error} title={t("image.failed")} />
        {missing && <ErrorAlert error={t("certImport.noneAssigned")} />}
        <DialogFooter>
          {deck && (
            <Button variant="ghost" disabled={save.isPending} onClick={clear}>
              {t("certImport.another")}
            </Button>
          )}
          <Button variant="outline" onClick={close}>
            {t("common.cancel")}
          </Button>
          {deck && (
            <Button
              disabled={save.isPending}
              onClick={() => {
                if (pickedCount === 0) setMissing(true);
                else save.mutate();
              }}
            >
              {save.isPending ? `${t("certImport.applying")}...` : t("certImport.apply")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
